const path = require("node:path");
const { createSessionStore } = require("./codex-acp-client.cjs");

const STORE_VERSION = "wuxing-companion-claude-sessions/v1";
const MAX_MESSAGES = 12;

function clip(value, limit = 12_000) {
  const text = String(value || "");
  return text.length > limit ? text.slice(-limit) : text;
}

function textFromContent(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textFromContent).filter(Boolean).join("\n");
  if (!value || typeof value !== "object") return "";
  if (value.type === "text" && typeof value.text === "string") return value.text;
  if (value.content !== undefined) return textFromContent(value.content);
  return "";
}

function createClaudeCodeClient(options = {}) {
  const onChanged = options.onChanged || (() => {});
  const loadSdk = options.loadSdk || (() => import("@anthropic-ai/claude-agent-sdk"));
  const sessionStore = options.sessionStore || createSessionStore(path.resolve(options.dataHome || process.cwd()), {
    fileName: "claude-agent-sessions.json",
    schemaVersion: STORE_VERSION
  });
  const states = new Map();
  let stopped = false;
  let sdkPromise = null;

  function sdk() {
    sdkPromise ||= loadSdk();
    return sdkPromise;
  }

  function notify() {
    try { onChanged(); } catch { /* UI updates must not interrupt an Agent turn. */ }
  }

  function publicState(entry) {
    return {
      workspace: entry.workspace,
      status: entry.status,
      output: entry.output,
      activity: entry.activity,
      error: entry.error,
      session_id: entry.sessionId,
      started_at: entry.startedAt,
      completed_at: entry.completedAt,
      messages: entry.messages.slice(-MAX_MESSAGES)
    };
  }

  function save(entry) {
    if (entry.sessionId) sessionStore.save(entry.workspace, entry.sessionId, entry.messages);
  }

  function entryFor(workspace) {
    const normalized = path.resolve(workspace);
    let entry = states.get(normalized);
    if (entry) return entry;
    const saved = sessionStore.get(normalized);
    entry = {
      workspace: normalized,
      status: "ready",
      output: "",
      activity: saved?.session_id ? "已恢复 Claude Code 对话" : "Claude Code 已准备好",
      error: "",
      sessionId: saved?.session_id || null,
      startedAt: saved?.updated_at || null,
      completedAt: saved?.updated_at || null,
      messages: Array.isArray(saved?.messages) ? saved.messages.slice(-MAX_MESSAGES) : [],
      running: null,
      abortController: null
    };
    states.set(normalized, entry);
    return entry;
  }

  async function connect(workspace) {
    if (stopped) throw new Error("agent-adapter-stopped:claude-code");
    await sdk();
    const entry = entryFor(workspace);
    notify();
    return publicState(entry);
  }

  function stateFor(workspace) {
    if (!workspace) return null;
    const normalized = path.resolve(workspace);
    const entry = states.get(normalized);
    if (entry) return publicState(entry);
    const saved = sessionStore.get(normalized);
    if (!saved?.session_id) return null;
    return {
      workspace: normalized,
      status: "saved",
      output: "",
      activity: "正在恢复 Claude Code 对话",
      error: "",
      session_id: saved.session_id,
      started_at: saved.updated_at || null,
      completed_at: saved.updated_at || null,
      messages: Array.isArray(saved.messages) ? saved.messages.slice(-MAX_MESSAGES) : []
    };
  }

  async function listSessions(workspace) {
    const normalized = path.resolve(workspace);
    const { listSessions: list } = await sdk();
    const sessions = await list({ dir: normalized, limit: 30, includeWorktrees: false, includeProgrammatic: true });
    return sessions
      .filter((item) => item?.sessionId && (!item.cwd || path.resolve(item.cwd).toLowerCase() === normalized.toLowerCase()))
      .map((item) => ({
        session_id: String(item.sessionId),
        workspace: normalized,
        title: String(item.customTitle || item.summary || item.firstPrompt || "未命名对话").replace(/\s+/g, " ").trim().slice(0, 80),
        updated_at: Number.isFinite(item.lastModified) ? new Date(item.lastModified).toISOString() : null
      }));
  }

  async function switchSession(workspace, sessionId) {
    const normalized = path.resolve(workspace);
    const entry = entryFor(normalized);
    if (entry.running) throw new Error("agent-prompt-in-progress");
    const available = await listSessions(normalized);
    if (!available.some((item) => item.session_id === sessionId)) throw new Error("agent-session-not-found");
    const { getSessionMessages } = await sdk();
    const history = await getSessionMessages(sessionId, { dir: normalized, limit: 100 });
    entry.sessionId = sessionId;
    entry.messages = history.map((item) => ({
      role: item.type === "assistant" ? "assistant" : "user",
      text: clip(textFromContent(item.message), 1000),
      at: new Date().toISOString()
    })).filter((item) => item.text).slice(-MAX_MESSAGES);
    entry.status = "ready";
    entry.output = "";
    entry.error = "";
    entry.activity = "已切换 Claude Code 对话";
    save(entry);
    notify();
    return publicState(entry);
  }

  async function resetSession(workspace) {
    const entry = entryFor(workspace);
    if (entry.running) throw new Error("agent-prompt-in-progress");
    sessionStore.remove(entry.workspace);
    Object.assign(entry, {
      status: "ready",
      output: "",
      activity: "Claude Code 新对话已准备好",
      error: "",
      sessionId: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
      messages: []
    });
    notify();
    return publicState(entry);
  }

  async function runPrompt(workspace, text, runOptions = {}) {
    const prompt = String(text || "").trim();
    if (!prompt || prompt.length > 8_000) throw new Error("agent-prompt-invalid");
    const entry = entryFor(workspace);
    if (entry.running) throw new Error("agent-prompt-in-progress");
    const api = await sdk();
    entry.messages.push({ role: "user", text: clip(runOptions.displayText || prompt, 1000), at: new Date().toISOString() });
    entry.messages = entry.messages.slice(-MAX_MESSAGES);
    entry.status = "streaming";
    entry.output = "";
    entry.error = "";
    entry.activity = "消息已送达，Claude Code 正在处理";
    entry.startedAt = new Date().toISOString();
    entry.completedAt = null;
    entry.abortController = new AbortController();
    notify();
    const query = api.query({
      prompt,
      options: {
        cwd: entry.workspace,
        ...(entry.sessionId ? { resume: entry.sessionId } : {}),
        abortController: entry.abortController,
        allowedTools: ["Read", "Glob", "Grep"],
        disallowedTools: ["Edit", "Write", "NotebookEdit"],
        permissionMode: "plan",
        settingSources: ["user", "project", "local"],
        includePartialMessages: false,
        persistSession: true
      }
    });
    entry.running = (async () => {
      let finalResult = "";
      for await (const message of query) {
        if (message?.session_id) entry.sessionId = message.session_id;
        if (message?.type === "assistant") {
          const chunk = textFromContent(message.message);
          if (chunk) {
            entry.output = clip(`${entry.output}${entry.output ? "\n" : ""}${chunk}`);
            entry.activity = "Claude Code 正在回复";
            notify();
          }
        }
        if (message?.type === "result") finalResult = message.result || "";
      }
      if (!entry.output.trim() && finalResult) entry.output = clip(finalResult);
      if (entry.output.trim()) entry.messages.push({ role: "assistant", text: entry.output.trim(), at: new Date().toISOString() });
      entry.messages = entry.messages.slice(-MAX_MESSAGES);
      entry.status = "completed";
      entry.activity = "本轮对话已完成";
      entry.completedAt = new Date().toISOString();
      save(entry);
      notify();
    })().catch((error) => {
      entry.status = "failed";
      entry.activity = "消息处理没有完成";
      entry.error = String(error?.message || error);
      entry.completedAt = new Date().toISOString();
      notify();
      throw error;
    }).finally(() => {
      entry.running = null;
      entry.abortController = null;
    });
    entry.running.catch(() => {});
    return { status: "delivered", session_id: entry.sessionId, workspace: entry.workspace };
  }

  function stop() {
    stopped = true;
    for (const entry of states.values()) entry.abortController?.abort();
    states.clear();
  }

  return { connect, listSessions, resetSession, runPrompt, stateFor, stop, switchSession };
}

module.exports = { STORE_VERSION, createClaudeCodeClient, textFromContent };
