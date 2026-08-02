import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createClaudeCodeClient } = require("../apps/companion/src/claude-code-client.cjs");

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

test("Claude Code sessions can be listed, loaded, resumed, and reset", async () => {
  const workspace = process.cwd();
  const queryOptions = [];
  const sdk = {
    listSessions: async () => [
      { sessionId: "claude-old", cwd: workspace, customTitle: "历史诊断", lastModified: Date.now() },
      { sessionId: "other", cwd: `${workspace}-other`, summary: "其他仓库", lastModified: Date.now() }
    ],
    getSessionMessages: async () => [
      { type: "user", message: { content: [{ type: "text", text: "检查规则" }] } },
      { type: "assistant", message: { content: [{ type: "text", text: "发现漂移" }] } }
    ],
    query({ options }) {
      queryOptions.push(options);
      return (async function* () {
        yield { type: "assistant", session_id: "claude-old", message: { content: [{ type: "text", text: "已完成诊断" }] } };
        yield { type: "result", session_id: "claude-old", result: "已完成诊断" };
      })();
    }
  };
  const client = createClaudeCodeClient({ loadSdk: async () => sdk, sessionStore: memoryStore() });
  assert.deepEqual((await client.listSessions(workspace)).map((item) => item.session_id), ["claude-old"]);
  const selected = await client.switchSession(workspace, "claude-old");
  assert.deepEqual(selected.messages.map((item) => [item.role, item.text]), [["user", "检查规则"], ["assistant", "发现漂移"]]);
  await client.runPrompt(workspace, "继续");
  const completed = await waitFor(() => client.stateFor(workspace)?.status === "completed" && client.stateFor(workspace));
  assert.equal(completed.output, "已完成诊断");
  assert.equal(queryOptions[0].resume, "claude-old");
  const reset = await client.resetSession(workspace);
  assert.equal(reset.session_id, null);
  assert.deepEqual(reset.messages, []);
});
