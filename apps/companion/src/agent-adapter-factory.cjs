const { createClaudeCodeClient } = require("./claude-code-client.cjs");
const { createCodexAcpClient } = require("./codex-acp-client.cjs");
const { createWorkBuddyClient } = require("./workbuddy-client.cjs");
const { createHash } = require("node:crypto");
const path = require("node:path");

const ADAPTERS = {
  codex: { id: "codex", label: "Codex" },
  "claude-code": { id: "claude-code", label: "Claude Code" },
  workbuddy: { id: "workbuddy", label: "WorkBuddy" }
};

function adapterIdForRuntime(runtimeId) {
  const value = String(runtimeId || "").toLowerCase();
  if (value.includes("claude")) return "claude-code";
  if (value.includes("workbuddy") || value.includes("codebuddy") || value === "cbc") return "workbuddy";
  if (value.includes("codex")) return "codex";
  return null;
}

// A companion conversation belongs to a concrete Agent process in a concrete
// repository.  Runtime alone is deliberately not enough: two Codex (or two
// Claude) Agents can work in the same checkout at the same time.
function targetKey(target) {
  if (!target?.workspace) throw new Error("workspace-not-detected");
  const agentId = String(target.agent_id || "agent-local").trim() || "agent-local";
  const runtimeId = String(target.runtime_id || target.runtime?.id || "unknown").trim() || "unknown";
  const workspace = path.resolve(target.workspace);
  return `${agentId}\u0000${runtimeId}\u0000${workspace}`;
}

function scopedDataHome(dataHome, key) {
  const digest = createHash("sha256").update(key).digest("hex");
  return path.join(path.resolve(dataHome || process.cwd()), "agent-adapter-sessions", digest);
}

function createAgentAdapterFactory(options = {}) {
  const clients = new Map();
  const constructors = {
    codex: options.createCodex || createCodexAcpClient,
    "claude-code": options.createClaudeCode || createClaudeCodeClient,
    workbuddy: options.createWorkBuddy || createWorkBuddyClient
  };

  function descriptor(target) {
    const adapterId = adapterIdForRuntime(target?.runtime_id || target?.runtime?.id);
    return adapterId ? ADAPTERS[adapterId] : null;
  }

  function clientFor(target) {
    const info = descriptor(target);
    if (!info) throw new Error(`agent-adapter-unsupported:${target?.runtime_id || target?.runtime?.id || "unknown"}`);
    const key = targetKey(target);
    if (!clients.has(key)) clients.set(key, constructors[info.id]({
      dataHome: scopedDataHome(options.dataHome, key),
      onChanged: options.onChanged,
      ...(options.adapterOptions?.[info.id] || {})
    }));
    return { client: clients.get(key), info };
  }

  function annotate(value, info) {
    return value ? { ...value, adapter_id: info.id, adapter_label: info.label } : null;
  }

  async function invoke(method, target, ...args) {
    if (!target?.workspace) throw new Error("workspace-not-detected");
    const { client, info } = clientFor(target);
    return annotate(await client[method](target.workspace, ...args), info);
  }

  return {
    adapterIdForRuntime,
    descriptor,
    connect: (target) => invoke("connect", target),
    listSessions: async (target) => {
      const { client, info } = clientFor(target);
      const sessions = await client.listSessions(target.workspace);
      return sessions.map((item) => annotate(item, info));
    },
    resetSession: (target) => invoke("resetSession", target),
    runPrompt: (target, text, runOptions) => invoke("runPrompt", target, text, runOptions),
    stateFor(target) {
      if (!target?.workspace) return null;
      const info = descriptor(target);
      if (!info) return null;
      const client = clients.get(targetKey(target));
      return client ? annotate(client.stateFor(target.workspace), info) : null;
    },
    switchSession: (target, sessionId) => invoke("switchSession", target, sessionId),
    stop() { for (const client of clients.values()) client.stop(); clients.clear(); }
  };
}

module.exports = { ADAPTERS, adapterIdForRuntime, createAgentAdapterFactory, scopedDataHome, targetKey };
