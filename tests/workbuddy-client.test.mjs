import assert from "node:assert/strict";
import { createRequire } from "node:module";
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
  const client = createWorkBuddyClient({ endpoint: "http://127.0.0.1:8080", fetch, sessionStore: memoryStore() });
  await client.connect(workspace);
  assert.deepEqual((await client.listSessions(workspace)).map((item) => item.session_id), ["wb-old"]);
  await client.switchSession(workspace, "wb-old");
  await client.runPrompt(workspace, "继续诊断");
  const completed = await waitFor(() => client.stateFor(workspace)?.status === "completed" && client.stateFor(workspace));
  assert.equal(completed.output, "WorkBuddy 已回复");
  assert.ok(requested.some((item) => item.url.endsWith("/api/v1/runs/server-run-id/stream")));
});
