import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { adapterIdForRuntime, createAgentAdapterFactory } = require("../apps/companion/src/agent-adapter-factory.cjs");

test("runtime ids select the matching Code Agent adapter", () => {
  assert.equal(adapterIdForRuntime("codex-app"), "codex");
  assert.equal(adapterIdForRuntime("claude-code"), "claude-code");
  assert.equal(adapterIdForRuntime("workbuddy-desktop"), "workbuddy");
  assert.equal(adapterIdForRuntime("codebuddy-cli"), "workbuddy");
  assert.equal(adapterIdForRuntime("unknown-agent"), null);
});

test("the adapter factory constructs vendors lazily and exposes one interface", async () => {
  const created = [];
  const make = (id) => () => {
    created.push(id);
    return {
      connect: async (workspace) => ({ workspace, status: "ready" }),
      listSessions: async (workspace) => [{ workspace, session_id: `${id}-1` }],
      resetSession: async (workspace) => ({ workspace, status: "ready" }),
      runPrompt: async (workspace) => ({ workspace, status: "delivered" }),
      stateFor: (workspace) => ({ workspace, status: "ready" }),
      switchSession: async (workspace, sessionId) => ({ workspace, session_id: sessionId }),
      stop() {}
    };
  };
  const factory = createAgentAdapterFactory({
    createCodex: make("codex"),
    createClaudeCode: make("claude-code"),
    createWorkBuddy: make("workbuddy")
  });
  const target = { runtime_id: "claude-code", workspace: "C:/demo" };
  const state = await factory.connect(target);
  assert.equal(state.adapter_id, "claude-code");
  assert.equal(state.adapter_label, "Claude Code");
  assert.deepEqual(created, ["claude-code"]);
  assert.equal((await factory.listSessions(target))[0].session_id, "claude-code-1");
  assert.deepEqual(created, ["claude-code"]);
  await assert.rejects(factory.connect({ runtime_id: "other", workspace: "C:/demo" }), /agent-adapter-unsupported/);
});
