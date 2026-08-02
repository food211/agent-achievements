import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createCodexAcpClient, updateSummary } = require("../apps/companion/src/codex-acp-client.cjs");

function fakeCodexAcp() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => { child.killed = true; child.emit("exit", 0, null); };
  let buffer = "";
  child.stdin.setEncoding("utf8");
  child.stdin.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const request = JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      if (request.method === "initialize") child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] } })}\n`);
      if (request.method === "session/new") child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { sessionId: "session-local" } })}\n`);
      if (request.method === "session/prompt") {
        child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "session-local", update: { sessionUpdate: "tool_call", title: "正在读取规则" } } })}\n`);
        child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "session-local", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "请先确认这条规则。" } } } })}\n`);
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

test("the companion owns a real ACP session and receives the Agent response", async (t) => {
  const client = createCodexAcpClient({
    dataHome: process.cwd(),
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
