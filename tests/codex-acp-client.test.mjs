import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { acpSpawnOptions, childEnvironment, createCodexAcpClient, permissionOutcome, updateSummary } = require("../apps/companion/src/codex-acp-client.cjs");

function fakeCodexAcp(options = {}) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.requests = [];
  child.kill = () => { child.killed = true; child.emit("exit", 0, null); };
  let buffer = "";
  child.stdin.setEncoding("utf8");
  child.stdin.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const request = JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      child.requests.push(request);
      if (request.method === "initialize") child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: 1, agentCapabilities: { sessionCapabilities: { ...(options.resume ? { resume: {} } : {}), ...(options.list ? { list: {} } : {}) }, ...(options.load ? { loadSession: true } : {}) }, authMethods: [] } })}\n`);
      if (request.method === "session/new") child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { sessionId: options.sessionId || "session-local" } })}\n`);
      if (request.method === "session/list") child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { sessions: options.sessions || [], nextCursor: null } })}\n`);
      if (request.method === "session/resume") child.stdout.write(`${JSON.stringify(options.resumeFailure ? { jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "resume failed" } } : { jsonrpc: "2.0", id: request.id, result: {} })}\n`);
      if (request.method === "session/load") {
        if (!options.loadFailure) {
          for (const [index, item] of (options.history || []).entries()) {
            child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId: request.params.sessionId, update: { sessionUpdate: item.role === "user" ? "user_message_chunk" : "agent_message_chunk", messageId: `history-${index}`, content: { type: "text", text: item.text } } } })}\n`);
          }
        }
        child.stdout.write(`${JSON.stringify(options.loadFailure ? { jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "load failed" } } : { jsonrpc: "2.0", id: request.id, result: {} })}\n`);
      }
      if (request.method === "session/prompt") {
        const sessionId = request.params.sessionId;
        child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: { sessionUpdate: "tool_call", title: "正在读取规则" } } })}\n`);
        child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "请先确认这条规则。" } } } })}\n`);
        child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { stopReason: "end_turn" } })}\n`);
      }
    }
  });
  return child;
}

async function waitFor(predicate) {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out");
}

test("ACP updates become human-readable companion activity", () => {
  assert.deepEqual(updateSummary({ sessionUpdate: "tool_call", title: "扫描规则" }), { kind: "activity", text: "扫描规则" });
  assert.deepEqual(updateSummary({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "发现一处漂移" } }), { kind: "text", text: "发现一处漂移" });
});

test("Electron launches the ACP adapter in Node mode", () => {
  assert.equal(childEnvironment({ PATH: "test" }, { electron: "43.2.0" }).ELECTRON_RUN_AS_NODE, "1");
  assert.equal(childEnvironment({ PATH: "test" }, { node: "22.0.0" }).ELECTRON_RUN_AS_NODE, undefined);
});

test("the companion launches ACP in a separate hidden Windows process group", () => {
  const launch = acpSpawnOptions({ workspace: process.cwd() }, {}, { dataHome: "C:/companion" });
  assert.equal(launch.windowsHide, true);
  assert.equal(launch.detached, process.platform === "win32");
  assert.equal(launch.shell, false);
});

test("read-only sessions reject commands unless a narrow explicit policy permits one", () => {
  assert.deepEqual(permissionOutcome({
    toolCall: { kind: "execute", rawInput: { command: "git status" } },
    options: [{ optionId: "allow-once", kind: "allow_once" }, { optionId: "deny", kind: "reject_once" }]
  }), { outcome: { outcome: "cancelled" } });
  assert.deepEqual(permissionOutcome({
    toolCall: { kind: "execute", rawInput: { command: "git status" } },
    options: [{ optionId: "allow-once", kind: "allow_once" }]
  }, { allowCommands: true, allowedCommands: ["git status"] }), { outcome: { outcome: "selected", optionId: "allow-once" } });
  assert.deepEqual(permissionOutcome({
    toolCall: { kind: "edit" },
    options: [{ optionId: "allow-once", kind: "allow_once" }]
  }), { outcome: { outcome: "cancelled" } });
});

test("the companion owns a real ACP session and receives the Agent response", async (t) => {
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "companion-acp-test-"));
  t.after(() => rm(dataHome, { recursive: true, force: true }));
  const client = createCodexAcpClient({
    dataHome,
    resolveAgentPath: () => "fake-codex-acp.js",
    spawnProcess: () => fakeCodexAcp()
  });
  t.after(() => client.stop());
  const workspace = process.cwd();
  const delivery = await client.runPrompt(workspace, "开始诊断", { displayText: "诊断当前仓库" });
  assert.equal(delivery.status, "delivered");
  const state = await waitFor(() => client.stateFor(workspace)?.status === "completed" && client.stateFor(workspace));
  assert.equal(state.output, "请先确认这条规则。");
  assert.deepEqual(state.messages.map((item) => [item.role, item.text]), [
    ["user", "诊断当前仓库"],
    ["assistant", "请先确认这条规则。"]
  ]);
});

test("the companion resumes one persisted ACP session per workspace after restart", async (t) => {
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "companion-acp-resume-"));
  t.after(() => rm(dataHome, { recursive: true, force: true }));
  const children = [];
  const makeClient = () => createCodexAcpClient({
    dataHome,
    resolveAgentPath: () => "fake-codex-acp.js",
    spawnProcess: () => {
      const child = fakeCodexAcp({ resume: true, sessionId: "durable-session" });
      children.push(child);
      return child;
    }
  });
  const workspace = process.cwd();
  const first = makeClient();
  await first.runPrompt(workspace, "第一轮");
  await waitFor(() => first.stateFor(workspace)?.status === "completed");
  first.stop();

  const second = makeClient();
  t.after(() => second.stop());
  assert.equal(second.stateFor(workspace).session_id, "durable-session");
  assert.ok(second.stateFor(workspace).messages.some((item) => item.text === "第一轮"));
  await second.connect(workspace);
  const delivery = await second.runPrompt(workspace, "第二轮");
  assert.equal(delivery.session_id, "durable-session");
  assert.ok(children[1].requests.some((item) => item.method === "session/resume" && item.params.sessionId === "durable-session"));
  assert.equal(children[1].requests.some((item) => item.method === "session/new"), false);
  const state = await waitFor(() => second.stateFor(workspace)?.status === "completed" && second.stateFor(workspace));
  assert.ok(state.messages.some((item) => item.text === "第一轮"));
});

test("a failed resume falls back to load without creating a new session", async (t) => {
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "companion-acp-load-"));
  t.after(() => rm(dataHome, { recursive: true, force: true }));
  const workspace = process.cwd();
  const first = createCodexAcpClient({
    dataHome,
    resolveAgentPath: () => "fake-codex-acp.js",
    spawnProcess: () => fakeCodexAcp({ sessionId: "loadable-session" })
  });
  await first.runPrompt(workspace, "第一轮");
  await waitFor(() => first.stateFor(workspace)?.status === "completed");
  first.stop();

  let child;
  const second = createCodexAcpClient({
    dataHome,
    resolveAgentPath: () => "fake-codex-acp.js",
    spawnProcess: () => (child = fakeCodexAcp({ resume: true, resumeFailure: true, load: true }))
  });
  t.after(() => second.stop());
  const state = await second.connect(workspace);
  assert.equal(state.session_id, "loadable-session");
  assert.ok(child.requests.some((item) => item.method === "session/resume"));
  assert.ok(child.requests.some((item) => item.method === "session/load"));
  assert.equal(child.requests.some((item) => item.method === "session/new"), false);
});

test("an automatically restored stale session falls back once to a fresh conversation", async (t) => {
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "companion-acp-preserve-"));
  t.after(() => rm(dataHome, { recursive: true, force: true }));
  const workspace = process.cwd();
  const first = createCodexAcpClient({
    dataHome,
    resolveAgentPath: () => "fake-codex-acp.js",
    spawnProcess: () => fakeCodexAcp({ sessionId: "preserved-session" })
  });
  await first.runPrompt(workspace, "第一轮");
  await waitFor(() => first.stateFor(workspace)?.status === "completed");
  first.stop();

  let child;
  const second = createCodexAcpClient({
    dataHome,
    resolveAgentPath: () => "fake-codex-acp.js",
    spawnProcess: () => (child = fakeCodexAcp({ resume: true, resumeFailure: true, load: true, loadFailure: true }))
  });
  t.after(() => second.stop());
  const state = await second.connect(workspace);
  assert.equal(child.requests.some((item) => item.method === "session/new"), true);
  assert.equal(state.session_id, "session-local");
  assert.deepEqual(state.messages, []);
  assert.match(state.activity, /旧对话暂时无法恢复/);
});

test("resetting a workspace starts a clean session and leaves the old Codex thread untouched", async (t) => {
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "companion-acp-reset-"));
  t.after(() => rm(dataHome, { recursive: true, force: true }));
  const children = [];
  let launch = 0;
  const client = createCodexAcpClient({
    dataHome,
    resolveAgentPath: () => "fake-codex-acp.js",
    spawnProcess: () => {
      launch += 1;
      const child = fakeCodexAcp({ sessionId: `session-${launch}` });
      children.push(child);
      return child;
    }
  });
  t.after(() => client.stop());
  const workspace = process.cwd();
  await client.runPrompt(workspace, "旧对话");
  await waitFor(() => client.stateFor(workspace)?.status === "completed");

  const replacement = await client.resetSession(workspace);
  assert.equal(replacement.session_id, "session-2");
  assert.deepEqual(replacement.messages, []);
  assert.equal(children[0].killed, true);
  assert.equal(children[1].requests.some((item) => item.method === "session/new"), true);
  assert.equal(client.stateFor(workspace).session_id, "session-2");
});

test("the companion lists repository history and switches to a selected Codex session", async (t) => {
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "companion-acp-switch-"));
  t.after(() => rm(dataHome, { recursive: true, force: true }));
  const workspace = process.cwd();
  const sessions = [
    { sessionId: "current-session", cwd: workspace, title: "当前对话", updatedAt: "2026-08-02T08:00:00.000Z" },
    { sessionId: "history-session", cwd: workspace, title: "修复历史问题", updatedAt: "2026-08-01T08:00:00.000Z" },
    { sessionId: "other-repository", cwd: path.dirname(workspace), title: "其他仓库", updatedAt: "2026-08-01T07:00:00.000Z" }
  ];
  const children = [];
  let launch = 0;
  const client = createCodexAcpClient({
    dataHome,
    resolveAgentPath: () => "fake-codex-acp.js",
    spawnProcess: () => {
      launch += 1;
      const child = fakeCodexAcp({
        sessionId: "current-session",
        list: true,
        load: true,
        sessions,
        history: launch > 1 ? [
          { role: "user", text: "帮我修复历史问题" },
          { role: "assistant", text: "历史问题已经修复" }
        ] : []
      });
      children.push(child);
      return child;
    }
  });
  t.after(() => client.stop());
  await client.connect(workspace);

  const history = await client.listSessions(workspace);
  assert.deepEqual(history.map((item) => item.session_id), ["current-session", "history-session"]);
  const selected = await client.switchSession(workspace, "history-session");
  assert.equal(selected.session_id, "history-session");
  assert.deepEqual(selected.messages.map((item) => [item.role, item.text]), [
    ["user", "帮我修复历史问题"],
    ["assistant", "历史问题已经修复"]
  ]);
  assert.equal(children[0].killed, true);
  assert.ok(children[1].requests.some((item) => item.method === "session/load" && item.params.sessionId === "history-session"));
});
