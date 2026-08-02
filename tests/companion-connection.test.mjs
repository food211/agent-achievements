import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { once } from "node:events";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { createAgentConnectionServer, HOST, MAX_LINE_BYTES } = require("../apps/companion/src/agent-connection-server.cjs");

function lines(socket) {
  let buffer = "";
  const queue = [];
  const waiting = [];
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const value = JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      const resolve = waiting.shift();
      if (resolve) resolve(value);
      else queue.push(value);
    }
  });
  return () => queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("socket-line-timeout")), 2_000);
    waiting.push((value) => { clearTimeout(timer); resolve(value); });
  });
}

function connect(endpoint) {
  return net.createConnection({ host: endpoint.host, port: endpoint.port });
}

function hello(endpoint, overrides = {}) {
  return {
    type: "hello",
    schema_version: "agent-achievements/v1",
    token: endpoint.token,
    agent_id: "agent-a",
    session_id: "session-a",
    runtime: { id: "test-agent" },
    workspace: process.cwd(),
    ...overrides
  };
}

test("the local Agent connection authenticates, exchanges context, and removes disconnected sessions", async (t) => {
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "companion-connection-"));
  let contextVersion = 1;
  const server = createAgentConnectionServer({ dataHome, getContext: () => ({ version: contextVersion }) });
  t.after(() => server.stop());
  const endpoint = await server.start();
  const stored = JSON.parse(await readFile(path.join(dataHome, "connection.json"), "utf8"));
  assert.equal(stored.host, HOST);
  assert.equal(stored.transport, "tcp");
  assert.equal(stored.token, endpoint.token);

  const rejected = connect(endpoint);
  await once(rejected, "connect");
  rejected.write(`${JSON.stringify(hello(endpoint, { token: "wrong-token" }))}\n`);
  await once(rejected, "close");
  assert.equal(server.sessions().length, 0);

  const client = connect(endpoint);
  await once(client, "connect");
  const nextLine = lines(client);
  client.write(`${JSON.stringify(hello(endpoint, { capabilities: { prompt_injection: "host_native" } }))}\n`);
  const welcome = await nextLine();
  assert.equal(welcome.type, "welcome");
  assert.deepEqual(welcome.context, { version: 1 });
  assert.equal(server.sessions()[0].status, "idle");
  assert.equal(server.sessions()[0].extensions.prompt_injection, "host_native");

  const promptDelivery = server.requestPrompt("agent-a", process.cwd(), { intent: "run_wuxing_diagnostic", text: "开始五行诊断" });
  const prompt = await nextLine();
  assert.equal(prompt.type, "prompt_request");
  assert.equal(prompt.workspace, process.cwd());
  client.write(`${JSON.stringify({ type: "prompt_ack", schema_version: "agent-achievements/v1", request_id: prompt.request_id, status: "accepted", observed_at: new Date().toISOString() })}\n`);
  assert.equal((await promptDelivery).status, "accepted");

  client.write(`${JSON.stringify({ type: "ping", schema_version: "agent-achievements/v1" })}\n`);
  assert.equal((await nextLine()).type, "pong");

  client.write(`${JSON.stringify({ type: "status", schema_version: "agent-achievements/v1", status: "active", current_task: { id: "task-a", summary: "正在测试长连接" } })}\n`);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(server.sessions()[0].status, "active");
  assert.equal(server.sessions()[0].current_task.id, "task-a");

  client.write(`${JSON.stringify({ type: "status", schema_version: "agent-achievements/v1", status: "stopped", current_task: { id: "stale-task", summary: "不应保留" } })}\n`);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(server.sessions().length, 1);
  assert.equal(server.sessions()[0].status, "idle");
  assert.equal("current_task" in server.sessions()[0], false);
  client.write(`${JSON.stringify({ type: "ping", schema_version: "agent-achievements/v1" })}\n`);
  assert.equal((await nextLine()).type, "pong");
  client.write(`${JSON.stringify({ type: "status", schema_version: "agent-achievements/v1", status: "active", current_task: { id: "task-b", summary: "继续使用同一连接" } })}\n`);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(server.sessions()[0].status, "active");
  assert.equal(server.sessions()[0].current_task.id, "task-b");

  contextVersion = 2;
  server.refreshContexts();
  const update = await nextLine();
  assert.equal(update.type, "context");
  assert.deepEqual(update.context, { version: 2 });

  client.end();
  await once(client, "close");
  assert.equal(server.sessions().length, 0);
});

test("the local server drops an unauthenticated oversized buffer", async (t) => {
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "companion-connection-limit-"));
  const server = createAgentConnectionServer({ dataHome, getContext: () => ({}) });
  t.after(() => server.stop());
  const endpoint = await server.start();
  const client = connect(endpoint);
  await once(client, "connect");
  client.write("x".repeat(MAX_LINE_BYTES + 1));
  await once(client, "close");
  assert.equal(server.sessions().length, 0);
});

test("another local Code Agent can send a message to the companion-owned session", async (t) => {
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "companion-assistant-client-"));
  const received = [];
  const server = createAgentConnectionServer({
    dataHome,
    getContext: () => ({}),
    onAssistantPrompt: async (request) => {
      received.push(request);
      return { status: "delivered", session_id: "assistant-session-1" };
    }
  });
  t.after(() => server.stop());
  const endpoint = await server.start();
  const client = connect(endpoint);
  await once(client, "connect");
  const nextLine = lines(client);
  client.write(`${JSON.stringify({ type: "assistant_client", schema_version: "agent-achievements/v1", token: endpoint.token, client_id: "other-thread" })}\n`);
  assert.equal((await nextLine()).type, "assistant_welcome");
  client.write(`${JSON.stringify({ type: "assistant_prompt", schema_version: "agent-achievements/v1", request_id: "request-1", workspace: process.cwd(), text: "请检查这条规则" })}\n`);
  const ack = await nextLine();
  assert.equal(ack.status, "accepted");
  assert.equal(ack.session_id, "assistant-session-1");
  assert.equal(received[0].text, "请检查这条规则");
  assert.equal(server.sessions().length, 0, "one-shot assistant clients must not appear as active Agent sessions");
  client.end();
});

test("the portable Agent bridge authenticates and persists pushed context without model heartbeats", async (t) => {
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "companion-bridge-e2e-"));
  const server = createAgentConnectionServer({
    dataHome,
    getContext: (agentId) => ({ schema_version: "agent-achievements/v1", agent_id: agentId, tracked: [], recently_awarded: [], agent_actions: [], operating_priority: ["current_user_instruction", "safety_and_project_rules", "task_correctness", "tracked_achievements"] })
  });
  t.after(() => server.stop());
  await server.start();
  const { AgentBridge } = await import("../skills/use-agent-achievements/scripts/agent-bridge.mjs");
  const bridge = new AgentBridge({
    dataHome,
    agentId: "agent-e2e",
    runtimeId: "test-agent",
    sessionId: "session-e2e",
    once: true,
    onceTimeoutMs: 2_000,
    connectTimeoutMs: 2_000,
    reconnectMs: 25
  });
  const result = await bridge.run();
  assert.equal(result.status, "stopped");
  const inbox = JSON.parse(await readFile(path.join(dataHome, "agent-inbox.json"), "utf8"));
  assert.equal(inbox.agents[0].agent_id, "agent-e2e");
  assert.equal(inbox.agents[0].context.agent_id, "agent-e2e");
  assert.equal("token" in inbox.agents[0].context, false);
});
