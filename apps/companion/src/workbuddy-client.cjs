const { randomUUID } = require("node:crypto");
const path = require("node:path");
const { createSessionStore } = require("./codex-acp-client.cjs");

const STORE_VERSION = "wuxing-companion-workbuddy-sessions/v1";
const DEFAULT_ENDPOINT = "http://127.0.0.1:8080";
const MAX_MESSAGES = 12;

function clip(value, limit = 12_000) {
  const text = String(value || "");
  return text.length > limit ? text.slice(-limit) : text;
}

function extractText(value, depth = 0) {
  if (depth > 6 || value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => extractText(item, depth + 1)).filter(Boolean).join("\n");
  if (typeof value !== "object") return "";
  if (typeof value.text === "string") return value.text;
  for (const key of ["result", "response", "message", "content", "payload", "data"]) {
    const text = extractText(value[key], depth + 1);
    if (text) return text;
  }
  return "";
}

function createWorkBuddyClient(options = {}) {
  const onChanged = options.onChanged || (() => {});
  const request = options.fetch || globalThis.fetch;
  const endpoint = String(options.endpoint || process.env.WORKBUDDY_URL || process.env.CODEBUDDY_URL || DEFAULT_ENDPOINT).replace(/\/$/, "");
  const sessionStore = options.sessionStore || createSessionStore(path.resolve(options.dataHome || process.cwd()), {
    fileName: "workbuddy-agent-sessions.json",
    schemaVersion: STORE_VERSION
  });
  const states = new Map();
  let stopped = false;

  function notify() { try { onChanged(); } catch { /* UI updates must not interrupt a run. */ } }
  function headers(extra = {}) { return { "X-CodeBuddy-Request": "1", ...extra }; }
  async function api(route, init = {}) {
    const response = await request(`${endpoint}${route}`, { ...init, headers: headers(init.headers) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.error) throw new Error(`workbuddy-http:${body?.error?.message || response.status}`);
    return body?.data ?? body;
  }
  function publicState(entry) {
    return { workspace: entry.workspace, status: entry.status, output: entry.output, activity: entry.activity, error: entry.error, session_id: entry.sessionId, started_at: entry.startedAt, completed_at: entry.completedAt, messages: entry.messages.slice(-MAX_MESSAGES) };
  }
  function save(entry) { if (entry.sessionId) sessionStore.save(entry.workspace, entry.sessionId, entry.messages); }
  function entryFor(workspace) {
    const normalized = path.resolve(workspace);
    let entry = states.get(normalized);
    if (entry) return entry;
    const saved = sessionStore.get(normalized);
    entry = { workspace: normalized, status: "ready", output: "", activity: saved?.session_id ? "已恢复 WorkBuddy 对话" : "WorkBuddy 已准备好", error: "", sessionId: saved?.session_id || null, startedAt: saved?.updated_at || null, completedAt: saved?.updated_at || null, messages: Array.isArray(saved?.messages) ? saved.messages.slice(-MAX_MESSAGES) : [], running: null };
    states.set(normalized, entry);
    return entry;
  }
  async function connect(workspace) {
    if (stopped) throw new Error("agent-adapter-stopped:workbuddy");
    await api("/api/v1/health");
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
    return saved?.session_id ? { workspace: normalized, status: "saved", output: "", activity: "正在连接 WorkBuddy", error: "", session_id: saved.session_id, started_at: saved.updated_at || null, completed_at: saved.updated_at || null, messages: Array.isArray(saved.messages) ? saved.messages.slice(-MAX_MESSAGES) : [] } : null;
  }
  async function listSessions(workspace) {
    const normalized = path.resolve(workspace);
    const data = await api(`/api/v1/sessions?cwd=${encodeURIComponent(normalized)}`);
    const list = Array.isArray(data) ? data : data?.sessions || data?.items || [];
    return list.map((item) => ({
      session_id: String(item.sessionId || item.session_id || item.id || ""),
      workspace: normalized,
      title: String(item.name || item.title || item.summary || item.firstPrompt || "未命名对话").replace(/\s+/g, " ").trim().slice(0, 80),
      updated_at: item.updatedAt || item.updated_at || item.lastModified || null
    })).filter((item) => item.session_id);
  }
  async function switchSession(workspace, sessionId) {
    const entry = entryFor(workspace);
    if (entry.running) throw new Error("agent-prompt-in-progress");
    const available = await listSessions(entry.workspace);
    if (!available.some((item) => item.session_id === sessionId)) throw new Error("agent-session-not-found");
    entry.sessionId = sessionId;
    entry.messages = [];
    entry.output = "";
    entry.error = "";
    entry.status = "ready";
    entry.activity = "已切换 WorkBuddy 对话；历史上下文将在下一条消息中恢复";
    save(entry);
    notify();
    return publicState(entry);
  }
  async function resetSession(workspace) {
    const entry = entryFor(workspace);
    if (entry.running) throw new Error("agent-prompt-in-progress");
    sessionStore.remove(entry.workspace);
    Object.assign(entry, { sessionId: null, messages: [], output: "", error: "", status: "ready", activity: "WorkBuddy 新对话已准备好", startedAt: new Date().toISOString(), completedAt: null });
    notify();
    return publicState(entry);
  }
  async function runPrompt(workspace, text, runOptions = {}) {
    const prompt = String(text || "").trim();
    if (!prompt || prompt.length > 8_000) throw new Error("agent-prompt-invalid");
    const entry = entryFor(workspace);
    if (entry.running) throw new Error("agent-prompt-in-progress");
    entry.sessionId ||= randomUUID();
    entry.messages.push({ role: "user", text: clip(runOptions.displayText || prompt, 1000), at: new Date().toISOString() });
    entry.messages = entry.messages.slice(-MAX_MESSAGES);
    entry.status = "streaming";
    entry.output = "";
    entry.error = "";
    entry.activity = "消息已送达，WorkBuddy 正在处理";
    entry.startedAt = new Date().toISOString();
    entry.completedAt = null;
    save(entry);
    notify();
    const runId = `wuxing-${randomUUID()}`;
    entry.running = (async () => {
      const accepted = await api("/api/v1/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: runId,
          type: "message",
          source: { platform: "generic", sender: { id: "wuxing-companion", name: "五行助手" }, conversation: { id: entry.sessionId, type: "direct" } },
          payload: { text: prompt },
          timeoutMs: 30 * 60_000
        })
      });
      const acceptedRunId = accepted?.runId || accepted?.run_id || runId;
      const response = await request(`${endpoint}/api/v1/runs/${encodeURIComponent(acceptedRunId)}/stream`, { headers: headers() });
      if (!response.ok || !response.body) throw new Error(`workbuddy-stream:${response.status}`);
      const decoder = new TextDecoder();
      let buffer = "";
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const event = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const payload = event.split(/\r?\n/).filter((line) => line.startsWith("data:" )).map((line) => line.slice(5).trim()).join("\n");
          if (!payload || payload === "[DONE]") continue;
          try {
            const text = extractText(JSON.parse(payload));
            if (text) { entry.output = clip(text); entry.activity = "WorkBuddy 正在回复"; notify(); }
          } catch { /* Ignore non-JSON keepalive events. */ }
        }
      }
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
    }).finally(() => { entry.running = null; });
    entry.running.catch(() => {});
    return { status: "delivered", session_id: entry.sessionId, workspace: entry.workspace };
  }
  function stop() { stopped = true; states.clear(); }
  return { connect, listSessions, resetSession, runPrompt, stateFor, stop, switchSession };
}

module.exports = { DEFAULT_ENDPOINT, STORE_VERSION, createWorkBuddyClient, extractText };
