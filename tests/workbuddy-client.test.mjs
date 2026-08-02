import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createWorkBuddyClient } = require("../apps/companion/src/workbuddy-client.cjs");

function memoryStore() {
  const records = new Map();
  return {
    get: (workspace) => records.get(workspace) || null,
    save: (workspace, session_id, messages) => records.set(workspace, { session_id, messages, updated_at: new Date().toISOString() }),
    remove: (workspace) => records.delete(workspace)
  };
}

function fakeWorkBuddyAcp() {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.killed = false;
  child.kill = () => { child.killed = true; child.emit("exit", 0, null); };
  let buffer = "";
  child.stdin.setEncoding("utf8");
  child.stdin.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const request = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1);
      if (request.method === "initialize") child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: 1, agentCapabilities: { sessionCapabilities: { list: {} } } } })}\n`);
      if (request.method === "session/new") child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { sessionId: "workbuddy-acp" } })}\n`);
      if (request.method === "session/prompt") {
        child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "workbuddy-acp", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "ACP 回复" } } } })}\n`);
        child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { stopReason: "end_turn" } })}\n`);
      }
    }
  });
  return child;
}

async function waitFor(predicate) {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    const result = predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out");
}

test("WorkBuddy uses its returned run id and streams the reply", async () => {
  const requested = [];
  const fetch = async (url, init = {}) => {
    requested.push({ url, init });
    if (url.endsWith("/api/v1/health")) return Response.json({ data: { ok: true } });
    if (url.includes("/api/v1/sessions?")) return Response.json({ data: [{ id: "wb-old", title: "历史对话" }] });
    if (url.endsWith("/api/v1/runs") && init.method === "POST") return Response.json({ data: { runId: "server-run-id" } });
    if (url.endsWith("/api/v1/runs/server-run-id/stream")) return new Response('data: {"message":{"text":"WorkBuddy 已回复"}}\n\n');
    return new Response("not found", { status: 404 });
  };
  const workspace = process.cwd();
  const client = createWorkBuddyClient({ transport: "rest", endpoint: "http://127.0.0.1:8080", fetch, sessionStore: memoryStore() });
  await client.connect(workspace);
  assert.deepEqual((await client.listSessions(workspace)).map((item) => item.session_id), ["wb-old"]);
  await client.switchSession(workspace, "wb-old");
  await client.runPrompt(workspace, "继续诊断");
  const completed = await waitFor(() => client.stateFor(workspace)?.status === "completed" && client.stateFor(workspace));
  assert.equal(completed.output, "WorkBuddy 已回复");
  assert.ok(requested.some((item) => item.url.endsWith("/api/v1/runs/server-run-id/stream")));
});

test("WorkBuddy uses the documented local ACP command by default", async () => {
  let launch;
  const client = createWorkBuddyClient({
    command: "codebuddy-test",
    spawnProcess: (program, args) => { launch = { program, args }; return fakeWorkBuddyAcp(); },
    sessionStore: memoryStore()
  });
  await client.runPrompt(process.cwd(), "开始诊断");
  const completed = await waitFor(() => client.stateFor(process.cwd())?.status === "completed" && client.stateFor(process.cwd()));
  assert.deepEqual(launch, { program: "codebuddy-test", args: ["--acp"] });
  assert.equal(completed.output, "ACP 回复");
  client.stop();
});
