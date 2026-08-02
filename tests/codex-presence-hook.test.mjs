import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const VERSION = "agent-achievements/v1";
const hook = path.resolve("skills/use-agent-achievements/scripts/codex-presence-hook.mjs");
const bridge = path.resolve("skills/use-agent-achievements/scripts/agent-bridge.mjs");
const installer = path.resolve("skills/use-agent-achievements/scripts/install-codex-hooks.mjs");
const agentId = "codex-local";
const bridgeDigest = createHash("sha256").update(agentId, "utf8").digest("hex").slice(0, 16);

function runHook(home, hookEventName, overrides = {}, hookArguments = [], environmentHome = home) {
  const result = spawnSync(process.execPath, [hook, ...hookArguments], {
    input: JSON.stringify({
      session_id: "thr_test",
      turn_id: "turn_test",
      cwd: process.cwd(),
      hook_event_name: hookEventName,
      ...overrides
    }),
    encoding: "utf8",
    env: { ...process.env, AGENT_ACHIEVEMENTS_HOME: environmentHome }
  });
  assert.equal(result.status, 0, result.stderr);
  return result;
}

async function readPresence(home) {
  return JSON.parse(await readFile(path.join(home, "presence.json"), "utf8"));
}

async function seedFreshBridgeStatus(home, identity = agentId) {
  const directory = path.join(home, "bridges");
  await mkdir(directory, { recursive: true });
  const digest = createHash("sha256").update(identity, "utf8").digest("hex").slice(0, 16);
  await writeFile(path.join(directory, `${digest}.json`), `${JSON.stringify({
    schema_version: VERSION,
    agent_id: identity,
    session_id: "already-running",
    runtime: { id: "codex" },
    status: "connected",
    observed_at: new Date().toISOString(),
    endpoint: "tcp://127.0.0.1:1",
    pid: process.pid
  })}\n`, "utf8");
}

async function waitFor(predicate, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw lastError || new Error("Timed out waiting for the Codex bridge.");
}

function attachLineReader(socket, onMessage) {
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onMessage(JSON.parse(line), socket);
    }
  });
}

test("Codex lifecycle hooks drive active, idle, and stopped presence", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "agent-achievements-presence-"));
  await seedFreshBridgeStatus(home);
  runHook(home, "UserPromptSubmit");
  const active = await readPresence(home);
  assert.equal(active.sessions[0].status, "active");
  runHook(home, "Stop");
  const idle = await readPresence(home);
  assert.equal(idle.sessions[0].status, "idle");
  runHook(home, "SessionEnd");
  const stopped = await readPresence(home);
  assert.deepEqual(stopped.sessions, []);
});

test("a queued companion prompt becomes a Codex Stop continuation for the matching repository", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "agent-achievements-prompt-hook-"));
  await seedFreshBridgeStatus(home);
  await writeFile(path.join(home, "prompt-requests.json"), `${JSON.stringify({
    schema_version: VERSION,
    requests: [{
      schema_version: VERSION,
      request_id: "prompt-hook-test",
      agent_id: agentId,
      workspace: process.cwd(),
      intent: "run_wuxing_diagnostic",
      text: "请开始当前仓库的五行诊断。",
      status: "accepted",
      created_at: new Date().toISOString()
    }]
  })}\n`, "utf8");

  const result = runHook(home, "Stop");
  assert.deepEqual(JSON.parse(result.stdout), { decision: "block", reason: "请开始当前仓库的五行诊断。" });
  const requests = JSON.parse(await readFile(path.join(home, "prompt-requests.json"), "utf8"));
  assert.equal(requests.requests[0].status, "delivered");
  assert.equal((await readPresence(home)).sessions[0].status, "active");
});

test("the Codex hook shares the CLI lock without deleting a live owner", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "agent-achievements-hook-lock-"));
  await seedFreshBridgeStatus(home);
  const lock = path.join(home, ".achievement-cli.lock");
  const marker = path.join(lock, "cli-owner");
  await mkdir(lock);
  await writeFile(marker, "still-running", "utf8");

  runHook(home, "UserPromptSubmit");
  assert.equal(await readFile(marker, "utf8"), "still-running");
  await assert.rejects(readFile(path.join(home, "presence.json"), "utf8"), { code: "ENOENT" });

  await rm(lock, { recursive: true, force: true });
  await mkdir(lock);
  await writeFile(marker, "crashed-owner", "utf8");
  const staleTime = new Date(Date.now() - 31_000);
  await utimes(lock, staleTime, staleTime);
  runHook(home, "UserPromptSubmit");
  assert.equal((await readPresence(home)).sessions[0].status, "active");
  await assert.rejects(stat(lock), { code: "ENOENT" });
});

test("the Codex hook installer is idempotent and uses absolute executables", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "agent-achievements-codex-hooks-"));
  const env = { ...process.env, CODEX_HOME: codexHome };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = spawnSync(process.execPath, [installer], { encoding: "utf8", env });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).bridge_autostart, true);
  }

  const installed = JSON.parse(await readFile(path.join(codexHome, "hooks.json"), "utf8"));
  for (const event of ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop", "SessionEnd"]) {
    const handlers = installed.hooks[event].flatMap((group) => group.hooks);
    assert.equal(handlers.length, 1, `${event} should contain exactly one achievement hook`);
    assert.equal(handlers[0].command.includes(process.execPath), true);
    assert.equal(handlers[0].command.includes(hook), true);
    assert.equal(handlers[0].commandWindows.includes(process.execPath), true);
    assert.equal(handlers[0].commandWindows.includes(hook), true);
  }

  const customDataHome = await mkdtemp(path.join(os.tmpdir(), "agent-achievements-custom-home-"));
  const custom = spawnSync(process.execPath, [installer,
    "--agent", "custom-codex-agent",
    "--runtime", "custom-codex-runtime",
    "--data-home", customDataHome
  ], { encoding: "utf8", env });
  assert.equal(custom.status, 0, custom.stderr);
  const output = JSON.parse(custom.stdout);
  assert.equal(output.agent_id, "custom-codex-agent");
  assert.equal(output.runtime_id, "custom-codex-runtime");
  assert.equal(output.data_home, customDataHome);
  const customized = JSON.parse(await readFile(path.join(codexHome, "hooks.json"), "utf8"));
  const customHandler = customized.hooks.SessionStart.flatMap((group) => group.hooks)[0];
  for (const value of ["--agent", "custom-codex-agent", "--runtime", "custom-codex-runtime", "--data-home", customDataHome]) {
    assert.equal(customHandler.commandWindows.includes(value), true);
  }
});

test("any Codex lifecycle event starts one persistent bridge without producing achievement evidence", async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "agent-achievements-codex-bridge-"));
  const decoyHome = await mkdtemp(path.join(os.tmpdir(), "agent-achievements-codex-decoy-"));
  const customAgentId = "custom-codex-agent";
  const customRuntimeId = "custom-codex-runtime";
  const customBridgeDigest = createHash("sha256").update(customAgentId, "utf8").digest("hex").slice(0, 16);
  const hookArguments = ["--agent", customAgentId, "--runtime", customRuntimeId, "--data-home", home];
  const token = "codex-hook-test-token";
  const messages = [];
  const sockets = new Set();
  let connectionCount = 0;
  let bridgePid = null;

  const server = net.createServer((socket) => {
    connectionCount += 1;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    attachLineReader(socket, (message) => {
      messages.push(message);
      if (message.type === "hello") {
        assert.equal(message.token, token);
        assert.equal(message.agent_id, customAgentId);
        assert.deepEqual(message.runtime, { id: customRuntimeId });
        socket.write(`${JSON.stringify({
          type: "welcome",
          schema_version: VERSION,
          heartbeat_interval_ms: 250,
          context: { motivation: "Codex bridge is connected", agent_actions: [] }
        })}\n`);
      } else if (message.type === "ping") {
        socket.write(`${JSON.stringify({ type: "pong", schema_version: VERSION, observed_at: new Date().toISOString() })}\n`);
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  t.after(async () => {
    if (bridgePid) {
      try { process.kill(bridgePid, "SIGTERM"); } catch { /* It already stopped. */ }
    }
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });

  const address = server.address();
  await writeFile(path.join(home, "connection.json"), `${JSON.stringify({
    schema_version: VERSION,
    transport: "tcp",
    host: "127.0.0.1",
    port: address.port,
    token,
    observed_at: new Date().toISOString()
  })}\n`, "utf8");
  const companionRoot = path.join(home, "companion-fixture");
  const companionStart = path.join(companionRoot, "apps", "companion", "scripts", "start.mjs");
  await mkdir(path.dirname(companionStart), { recursive: true });
  await writeFile(companionStart, [
    'import { appendFileSync } from "node:fs";',
    'import path from "node:path";',
    'const index = process.argv.indexOf("--data-home");',
    'appendFileSync(path.join(path.resolve(process.argv[index + 1]), "companion-launches.log"), "launch\\n", "utf8");'
  ].join("\n"), "utf8");
  await writeFile(path.join(home, "state.json"), `${JSON.stringify({
    agent_actions: [{
      action_id: "ensure-companion-test",
      agent_id: customAgentId,
      action: "ensure_companion_running",
      status: "completed",
      command: {
        program: process.execPath,
        args: [companionStart, "--data-home", home],
        cwd: companionRoot
      }
    }],
    adapters: [{
      agent_id: customAgentId,
      runtime: customRuntimeId,
      workspace: process.cwd(),
      last_bootstrapped_at: new Date().toISOString(),
      bridge_command: {
        program: process.execPath,
        args: [bridge, "--agent", customAgentId, "--runtime", customRuntimeId, "--session", "state-defined-session", "--data-home", home],
        cwd: process.cwd()
      }
    }]
  })}\n`, "utf8");

  const bridgeDirectory = path.join(home, "bridges");
  await mkdir(bridgeDirectory, { recursive: true });
  await writeFile(path.join(bridgeDirectory, `${customBridgeDigest}.json`), `${JSON.stringify({
    schema_version: VERSION,
    agent_id: customAgentId,
    session_id: "dead-session",
    runtime: { id: customRuntimeId },
    status: "connected",
    observed_at: new Date().toISOString(),
    endpoint: `tcp://127.0.0.1:${address.port}`,
    pid: 2_147_483_647
  })}\n`, "utf8");
  await writeFile(path.join(home, "companion-status.json"), `${JSON.stringify({
    schema_version: VERSION,
    status: "running",
    observed_at: new Date(Date.now() - 60_000).toISOString(),
    pid: 2_147_483_647
  })}\n`, "utf8");

  runHook(home, "SessionStart", {}, hookArguments, decoyHome);
  await waitFor(() => messages.some((message) => message.type === "hello"));
  await waitFor(async () => (await readFile(path.join(home, "companion-launches.log"), "utf8")).trim() === "launch");
  const hello = messages.find((message) => message.type === "hello");
  assert.equal(hello.session_id, "state-defined-session", "the hook should prefer the bootstrapped adapter command");
  await waitFor(async () => {
    const status = JSON.parse(await readFile(path.join(home, "bridges", `${customBridgeDigest}.json`), "utf8"));
    return status.status === "connected";
  });
  const lock = JSON.parse(await readFile(path.join(home, "bridges", `${customBridgeDigest}.lock`), "utf8"));
  bridgePid = lock.pid;
  const customPresence = await readPresence(home);
  assert.equal(customPresence.sessions[0].agent_id, customAgentId);
  assert.deepEqual(customPresence.sessions[0].runtime, { id: customRuntimeId });
  await assert.rejects(readFile(path.join(decoyHome, "presence.json"), "utf8"), { code: "ENOENT" });

  await writeFile(path.join(home, "companion-status.json"), `${JSON.stringify({
    schema_version: VERSION,
    status: "running",
    observed_at: new Date().toISOString(),
    pid: process.pid
  })}\n`, "utf8");
  runHook(home, "PostToolUse", {}, hookArguments, decoyHome);
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(connectionCount, 1, "fresh hooks must not establish duplicate connections");
  assert.equal((await readFile(path.join(home, "companion-launches.log"), "utf8")).trim(), "launch", "fresh companion status must not relaunch the desktop process");

  const pingsBeforeEnd = messages.filter((message) => message.type === "ping").length;
  runHook(home, "SessionEnd", {}, hookArguments, decoyHome);
  assert.deepEqual((await readPresence(home)).sessions, []);
  await waitFor(() => messages.some((message) => message.type === "status" && message.status === "idle" && message.activity_known === false), 4_000);
  await waitFor(() => messages.filter((message) => message.type === "ping").length > pingsBeforeEnd, 4_000);
  assert.equal(sockets.size, 1, "SessionEnd must not stop the persistent bridge");
  assert.equal(messages.some((message) => ["event", "claim", "award"].includes(message.type)), false);
  await assert.rejects(readFile(path.join(home, "events.jsonl"), "utf8"), { code: "ENOENT" });
});
