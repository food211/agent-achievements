import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { AgentBridge, selectPresenceSession, updateAgentInbox } from "../skills/use-agent-achievements/scripts/agent-bridge.mjs";

const VERSION = "agent-achievements/v1";
const bridgeScript = path.resolve("skills/use-agent-achievements/scripts/agent-bridge.mjs");
const require = createRequire(import.meta.url);
const { createAgentConnectionServer } = require("../apps/companion/src/agent-connection-server.cjs");

function bridgeHash(agentId) {
  return createHash("sha256").update(agentId, "utf8").digest("hex").slice(0, 16);
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

async function listen(handler) {
  const server = net.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}

async function closeServer(server) {
  for (const socket of server._connections ? [] : []) socket.destroy();
  await new Promise((resolve) => server.close(resolve));
}

function startBridge(home, args) {
  const child = spawn(process.execPath, [bridgeScript, ...args], {
    env: { ...process.env, AGENT_ACHIEVEMENTS_HOME: home },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  return { child, output: () => ({ stdout, stderr }) };
}

function waitForExit(running, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      running.child.kill();
      reject(new Error(`Bridge did not exit. ${running.output().stderr}`));
    }, timeoutMs);
    running.child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, ...running.output() });
    });
  });
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
  throw lastError || new Error("Timed out waiting for bridge state.");
}

async function writeConnection(home, server, token) {
  const address = server.address();
  await writeFile(path.join(home, "connection.json"), `${JSON.stringify({
    schema_version: VERSION,
    transport: "tcp",
    host: "127.0.0.1",
    port: address.port,
    token,
    observed_at: new Date().toISOString()
  })}\n`, "utf8");
}

test("the bridge authenticates, forwards real activity, and atomically stores context", async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "agent-achievements-bridge-once-"));
  const token = "test-only-secret";
  const received = [];
  const sockets = new Set();
  const server = await listen((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    attachLineReader(socket, (message) => {
      received.push(message);
      if (message.type === "hello") {
        socket.write(`${JSON.stringify({
          type: "welcome",
          schema_version: VERSION,
          heartbeat_interval_ms: 250,
          context: {
            motivation: "Keep the user's outcome first.",
            agent_actions: [{ action_id: "diagnose-rules", action: "run_wuxing_diagnostic" }]
          }
        })}\n${JSON.stringify({
          type: "action",
          schema_version: VERSION,
          action: { action_id: "record-task", action: "record_completed_task" }
        })}\n`);
      }
    });
  });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await closeServer(server);
  });

  const observedAt = Date.now();
  await writeFile(path.join(home, "presence.json"), `${JSON.stringify({
    schema_version: VERSION,
    sessions: [
      {
        schema_version: VERSION,
        agent_id: "agent-a",
        session_id: "host-session",
        runtime: { id: "test-runtime" },
        status: "active",
        observed_at: new Date(observedAt - 2_000).toISOString(),
        expires_at: new Date(observedAt + 60_000).toISOString(),
        current_task: { id: "task-1", summary: "Audit accumulated rules" }
      },
      {
        agent_id: "agent-a",
        session_id: "newer-idle-session",
        status: "idle",
        observed_at: new Date(observedAt - 1_000).toISOString(),
        expires_at: new Date(observedAt + 60_000).toISOString()
      },
      {
        agent_id: "agent-a",
        session_id: "bridge-session",
        status: "stopped",
        observed_at: new Date(observedAt).toISOString(),
        expires_at: new Date(observedAt + 60_000).toISOString()
      }
    ]
  })}\n`, "utf8");

  const bridgeDirectory = path.join(home, "bridges");
  await mkdir(bridgeDirectory, { recursive: true });
  await writeFile(path.join(bridgeDirectory, `${bridgeHash("agent-a")}.lock`), `${JSON.stringify({
    owner_id: "crashed-owner",
    pid: 2_147_483_647,
    agent_id: "agent-a",
    session_id: "crashed-session",
    observed_at: new Date().toISOString()
  })}\n`, "utf8");

  const address = server.address();
  const running = startBridge(home, [
    "--agent", "agent-a",
    "--runtime", "test-runtime",
    "--session", "bridge-session",
    "--data-home", home,
    "--endpoint", `tcp://127.0.0.1:${address.port}`,
    "--token", token,
    "--once",
    "--once-timeout-ms", "3000"
  ]);
  const result = await waitForExit(running);
  assert.equal(result.code, 0, result.stderr);

  assert.equal(received[0].type, "hello");
  assert.equal(received[0].token, token);
  assert.deepEqual(received[0].runtime, { id: "test-runtime" });
  assert.equal(received[0].current_task.id, "task-1");
  assert.equal(received.some((message) => message.type === "status" && message.status === "active"), true);
  assert.equal(received.some((message) => message.type === "task" && message.current_task?.id === "task-1"), true);
  assert.equal(received.some((message) => ["event", "claim", "award"].includes(message.type)), false);

  const inboxText = await readFile(path.join(home, "agent-inbox.json"), "utf8");
  const inbox = JSON.parse(inboxText);
  const agentInbox = inbox.agents.find((item) => item.agent_id === "agent-a");
  assert.equal(agentInbox.context.motivation, "Keep the user's outcome first.");
  assert.deepEqual(agentInbox.actions.map((entry) => entry.payload.action_id).sort(), ["diagnose-rules", "record-task"]);
  assert.equal(inboxText.includes(token), false, "connection credentials must never enter the Agent inbox");

  const status = JSON.parse(await readFile(path.join(home, "bridges", `${bridgeHash("agent-a")}.json`), "utf8"));
  assert.equal(status.status, "stopped");
  assert.equal(status.endpoint, `tcp://127.0.0.1:${address.port}`);
  assert.equal(status.pid, running.child.pid);
  await assert.rejects(readFile(path.join(home, "events.jsonl"), "utf8"));
  await assert.rejects(readFile(path.join(home, "bridges", `${bridgeHash("agent-a")}.lock`), "utf8"));
});

test("the persistent bridge rotates endpoints, pings, and refuses a duplicate instance", async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "agent-achievements-bridge-reconnect-"));
  const token1 = "first-secret";
  const token2 = "second-secret";
  const firstSockets = new Set();
  const secondSockets = new Set();
  const firstMessages = [];
  const secondMessages = [];
  let switched = false;

  const secondServer = await listen((socket) => {
    secondSockets.add(socket);
    socket.on("close", () => secondSockets.delete(socket));
    socket.on("error", () => {});
    attachLineReader(socket, (message) => {
      secondMessages.push(message);
      if (message.type === "hello") {
        assert.equal(message.token, token2);
        socket.write(`${JSON.stringify({
          type: "welcome",
          schema_version: VERSION,
          heartbeat_interval_ms: 250,
          context: { motivation: "Connection restored", agent_actions: [] }
        })}\n`);
      } else if (message.type === "ping") {
        socket.write(`${JSON.stringify({ type: "pong", schema_version: VERSION, observed_at: new Date().toISOString() })}\n`);
      }
    });
  });
  const firstServer = await listen((socket) => {
    firstSockets.add(socket);
    socket.on("close", () => firstSockets.delete(socket));
    socket.on("error", () => {});
    attachLineReader(socket, (message) => {
      firstMessages.push(message);
      if (message.type === "hello") {
        assert.equal(message.token, token1);
        socket.write(`${JSON.stringify({
          type: "welcome",
          schema_version: VERSION,
          heartbeat_interval_ms: 250,
          context: { motivation: "First connection", agent_actions: [] }
        })}\n`);
        if (!switched) {
          switched = true;
          setTimeout(() => {
            void writeConnection(home, secondServer, token2).then(() => socket.destroy());
          }, 100);
        }
      }
    });
  });
  t.after(async () => {
    for (const socket of firstSockets) socket.destroy();
    for (const socket of secondSockets) socket.destroy();
    await Promise.all([closeServer(firstServer), closeServer(secondServer)]);
  });

  await writeConnection(home, firstServer, token1);
  await writeFile(path.join(home, "presence.json"), `${JSON.stringify({
    schema_version: VERSION,
    sessions: [{
      agent_id: "agent-reconnect",
      session_id: "persistent-session",
      status: "stopped",
      observed_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString()
    }]
  })}\n`, "utf8");
  const running = startBridge(home, [
    "--agent", "agent-reconnect",
    "--runtime", "test-runtime",
    "--session", "persistent-session",
    "--reconnect-ms", "50",
    "--connect-timeout-ms", "1000"
  ]);
  t.after(() => { if (running.child.exitCode === null) running.child.kill(); });

  await waitFor(() => firstMessages.some((message) => message.type === "hello"), 12_000).catch((error) => {
    const output = running.output();
    throw new Error(`${error.message}\nbridge stdout: ${output.stdout}\nbridge stderr: ${output.stderr}`);
  });

  const duplicate = startBridge(home, [
    "--agent", "agent-reconnect",
    "--runtime", "test-runtime",
    "--session", "duplicate-session",
    "--once"
  ]);
  const duplicateResult = await waitForExit(duplicate, 3_000);
  assert.equal(duplicateResult.code, 0, duplicateResult.stderr);
  assert.equal(JSON.parse(duplicateResult.stdout).status, "already_running");

  await waitFor(() => secondMessages.some((message) => message.type === "ping"), 6_000).catch((error) => {
    const output = running.output();
    throw new Error(`${error.message}\nsecond messages: ${JSON.stringify(secondMessages)}\nbridge stdout: ${output.stdout}\nbridge stderr: ${output.stderr}`);
  });
  assert.equal(secondMessages.some((message) => message.type === "hello"), true);
  const connectedStatus = JSON.parse(await readFile(path.join(home, "bridges", `${bridgeHash("agent-reconnect")}.json`), "utf8"));
  assert.equal(connectedStatus.status, "connected");
  assert.equal(connectedStatus.endpoint, `tcp://127.0.0.1:${secondServer.address().port}`);
  assert.equal(secondMessages.some((message) => message.type === "status" && message.status === "idle" && message.activity_known === false), true);
  assert.equal(secondMessages.some((message) => message.type === "status" && message.status === "stopped"), false);
  assert.equal(secondMessages.some((message) => message.type === "task"), false, "an offline presence must not fabricate an active task");
  assert.equal(secondMessages.some((message) => ["event", "claim", "award"].includes(message.type)), false);

  const inbox = JSON.parse(await readFile(path.join(home, "agent-inbox.json"), "utf8"));
  const agentInbox = inbox.agents.find((item) => item.agent_id === "agent-reconnect");
  assert.equal(agentInbox.context.motivation, "Connection restored");

  running.child.kill();
  await waitForExit(running, 3_000);
});

test("the bridge interoperates with the companion connection server", async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "agent-achievements-bridge-e2e-"));
  const server = createAgentConnectionServer({
    dataHome: home,
    getContext: (agentId) => ({
      motivation: `Welcome ${agentId}`,
      current_challenge: { achievement_id: "loop-keeper", title: "闭环守护者" },
      agent_actions: [{ action_id: "continue-diagnostic", action: "run_wuxing_diagnostic" }]
    })
  });
  await server.start();
  t.after(() => server.stop());

  const running = startBridge(home, [
    "--agent", "companion-agent",
    "--runtime", "portable-agent",
    "--session", "e2e-session",
    "--once",
    "--once-timeout-ms", "3000"
  ]);
  const result = await waitForExit(running);
  assert.equal(result.code, 0, result.stderr);

  const inbox = JSON.parse(await readFile(path.join(home, "agent-inbox.json"), "utf8"));
  const agentInbox = inbox.agents.find((item) => item.agent_id === "companion-agent");
  assert.equal(agentInbox.context.motivation, "Welcome companion-agent");
  assert.equal(agentInbox.context.current_challenge.achievement_id, "loop-keeper");
  assert.equal(agentInbox.actions[0].payload.action_id, "continue-diagnostic");
});

test("a pushed context replaces the prior pending action snapshot", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "agent-achievements-inbox-actions-"));
  const identity = { agentId: "snapshot-agent", runtimeId: "test", sessionId: "snapshot-session" };
  await updateAgentInbox(home, identity, {
    type: "welcome",
    context: { agent_actions: [{ action_id: "old-action", action: "run_wuxing_diagnostic" }] }
  });
  await updateAgentInbox(home, identity, {
    type: "context",
    context: { agent_actions: [] }
  });
  const inbox = JSON.parse(await readFile(path.join(home, "agent-inbox.json"), "utf8"));
  assert.deepEqual(inbox.agents[0].actions, []);
});

test("presence aggregation ignores stopped sessions and prioritizes an active task", () => {
  const now = Date.now();
  const selected = selectPresenceSession({
    sessions: [
      { agent_id: "agent", session_id: "idle", status: "idle", observed_at: new Date(now).toISOString(), expires_at: new Date(now + 60_000).toISOString() },
      { agent_id: "agent", session_id: "active", status: "active", observed_at: new Date(now - 2_000).toISOString(), expires_at: new Date(now + 60_000).toISOString(), current_task: { id: "task", summary: "Still working" } },
      { agent_id: "agent", session_id: "bridge", status: "stopped", observed_at: new Date(now + 1_000).toISOString(), expires_at: new Date(now + 60_000).toISOString() }
    ]
  }, "agent", "bridge", now);
  assert.equal(selected.session_id, "active");
  assert.equal(selected.current_task.id, "task");
  assert.equal(selectPresenceSession({ sessions: [{ agent_id: "agent", session_id: "bridge", status: "stopped" }] }, "agent", "bridge", now), null);
});

test("bridge identities fail before connecting when empty, oversized, or controlled", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "agent-achievements-invalid-identity-"));
  const base = { dataHome: home, agentId: "agent", runtimeId: "runtime", sessionId: "session" };
  for (const [field, value, expected] of [
    ["agentId", "", /agent_id/],
    ["agentId", "a".repeat(129), /agent_id/],
    ["runtimeId", "r".repeat(81), /runtime_id/],
    ["sessionId", "session\ncontrol", /session_id/],
    ["sessionId", "s".repeat(129), /session_id/]
  ]) {
    assert.throws(() => new AgentBridge({ ...base, [field]: value }), expected);
  }

  const result = spawnSync(process.execPath, [bridgeScript,
    "--agent", "a".repeat(129),
    "--runtime", "runtime",
    "--session", "session",
    "--data-home", home,
    "--endpoint", "tcp://127.0.0.1:1",
    "--token", "unused",
    "--once"
  ], { encoding: "utf8", env: { ...process.env, AGENT_ACHIEVEMENTS_HOME: home } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /agent_id/);
  await assert.rejects(readFile(path.join(home, "bridges", `${bridgeHash("a".repeat(129))}.json`), "utf8"), { code: "ENOENT" });
});
