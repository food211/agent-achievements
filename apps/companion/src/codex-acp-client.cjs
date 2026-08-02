const { spawn } = require("node:child_process");
const path = require("node:path");

const PROTOCOL_VERSION = 1;
const START_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_CHARS = 12_000;

function clipped(value, limit = MAX_OUTPUT_CHARS) {
  const text = String(value || "");
  return text.length > limit ? text.slice(-limit) : text;
}

function updateSummary(update) {
  if (!update || typeof update !== "object") return null;
  if (update.sessionUpdate === "agent_message_chunk" && update.content?.type === "text") {
    return { kind: "text", text: String(update.content.text || "") };
  }
  if (update.sessionUpdate === "tool_call") {
    return { kind: "activity", text: String(update.title || "Agent 正在检查仓库") };
  }
  if (update.sessionUpdate === "tool_call_update") {
    const label = update.title || update.content?.find?.((item) => item?.content?.type === "text")?.content?.text;
    return label ? { kind: "activity", text: String(label) } : null;
  }
  if (update.sessionUpdate === "plan") return { kind: "activity", text: "Agent 已经列出诊断步骤" };
  return null;
}

function createCodexAcpClient(options = {}) {
  const onChanged = options.onChanged || (() => {});
  const spawnProcess = options.spawnProcess || spawn;
  const resolveAgentPath = options.resolveAgentPath || (() => require.resolve("@agentclientprotocol/codex-acp"));
  const sessions = new Map();
  let stopped = false;

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
      messages: entry.messages.slice(-12)
    };
  }

  function setEntry(entry, patch) {
    Object.assign(entry, patch);
    notify();
  }

  function rejectPending(entry, error) {
    for (const pending of entry.pending.values()) pending.reject(error);
    entry.pending.clear();
  }

  function send(entry, message) {
    if (!entry.child || entry.child.killed || !entry.child.stdin?.writable) throw new Error("codex-acp-not-running");
    entry.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  function request(entry, method, params, timeoutMs = START_TIMEOUT_MS) {
    const id = ++entry.nextRequestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        entry.pending.delete(id);
        reject(new Error(`codex-acp-timeout:${method}`));
      }, timeoutMs);
      entry.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); }
      });
      try { send(entry, { jsonrpc: "2.0", id, method, params }); }
      catch (error) {
        clearTimeout(timer);
        entry.pending.delete(id);
        reject(error);
      }
    });
  }

  function respond(entry, id, result) {
    send(entry, { jsonrpc: "2.0", id, result });
  }

  function handleMessage(entry, message) {
    if (Object.prototype.hasOwnProperty.call(message, "id") && (message.result !== undefined || message.error)) {
      const pending = entry.pending.get(message.id);
      if (!pending) return;
      entry.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`codex-acp:${message.error.message || message.error.code || "request-failed"}`));
      else pending.resolve(message.result);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(message, "id") && message.method === "session/request_permission") {
      respond(entry, message.id, { outcome: { outcome: "cancelled" } });
      setEntry(entry, { activity: "只读诊断不会批准写入或高风险操作" });
      return;
    }
    if (message.method !== "session/update" || message.params?.sessionId !== entry.sessionId) return;
    const summary = updateSummary(message.params.update);
    if (!summary) return;
    if (summary.kind === "text") setEntry(entry, { output: clipped(`${entry.output}${summary.text}`), activity: "Agent 正在回复" });
    else setEntry(entry, { activity: clipped(summary.text, 300) });
  }

  function attachOutput(entry) {
    let buffer = "";
    entry.child.stdout.setEncoding("utf8");
    entry.child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try { handleMessage(entry, JSON.parse(line)); }
        catch { setEntry(entry, { activity: "收到一条无法解析的 Agent 消息" }); }
      }
    });
    entry.child.stderr.setEncoding("utf8");
    entry.child.stderr.on("data", (chunk) => { entry.stderr = clipped(`${entry.stderr}${chunk}`, 3000); });
  }

  async function startEntry(entry) {
    const agentPath = resolveAgentPath();
    entry.child = spawnProcess(process.execPath, [agentPath], {
      cwd: entry.workspace,
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        INITIAL_AGENT_MODE: "read-only",
        APP_SERVER_LOGS: path.join(options.dataHome || entry.workspace, "codex-acp-logs")
      }
    });
    attachOutput(entry);
    entry.child.once("error", (error) => {
      rejectPending(entry, error);
      setEntry(entry, { status: "failed", error: error.message, completedAt: new Date().toISOString() });
    });
    entry.child.once("exit", (code, signal) => {
      if (entry.closing) return;
      const detail = entry.stderr.trim().split(/\r?\n/).at(-1);
      const error = new Error(detail || `Codex ACP 已退出（${signal || code}）`);
      rejectPending(entry, error);
      setEntry(entry, { status: "failed", error: error.message, completedAt: new Date().toISOString() });
      sessions.delete(entry.workspace);
    });
    const initialized = await request(entry, "initialize", {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
      clientInfo: { name: "wuxing-harness-companion", version: "0.1.0" }
    });
    if (initialized?.protocolVersion !== PROTOCOL_VERSION) throw new Error("codex-acp-protocol-mismatch");
    const session = await request(entry, "session/new", { cwd: entry.workspace, mcpServers: [] });
    if (!session?.sessionId) throw new Error("codex-acp-session-missing");
    entry.sessionId = session.sessionId;
    setEntry(entry, { status: "ready", activity: "Codex 已连接，等待诊断" });
    return entry;
  }

  async function ensureSession(workspace) {
    const normalized = path.resolve(workspace);
    const existing = sessions.get(normalized);
    if (existing) {
      await existing.ready;
      return existing;
    }
    if (stopped) throw new Error("codex-acp-client-stopped");
    const entry = {
      workspace: normalized,
      status: "connecting",
      output: "",
      activity: "正在连接本机 Codex",
      error: "",
      sessionId: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
      nextRequestId: 0,
      pending: new Map(),
      stderr: "",
      messages: [],
      child: null,
      closing: false,
      running: null
    };
    sessions.set(normalized, entry);
    notify();
    entry.ready = startEntry(entry).catch((error) => {
      setEntry(entry, { status: "failed", error: error.message, completedAt: new Date().toISOString() });
      if (entry.child && !entry.child.killed) entry.child.kill();
      sessions.delete(normalized);
      throw error;
    });
    await entry.ready;
    return entry;
  }

  async function runPrompt(workspace, text, runOptions = {}) {
    const prompt = String(text || "").trim();
    if (!prompt || prompt.length > 8_000) throw new Error("codex-acp-prompt-invalid");
    const entry = await ensureSession(workspace);
    if (entry.running) throw new Error("codex-acp-prompt-in-progress");
    entry.messages.push({ role: "user", text: clipped(runOptions.displayText || prompt, 1000), at: new Date().toISOString() });
    if (entry.messages.length > 12) entry.messages.splice(0, entry.messages.length - 12);
    setEntry(entry, {
      status: "streaming",
      output: "",
      error: "",
      activity: "提示词已送达，Agent 正在读取仓库",
      startedAt: new Date().toISOString(),
      completedAt: null
    });
    entry.running = request(entry, "session/prompt", {
      sessionId: entry.sessionId,
      prompt: [{ type: "text", text: prompt }]
    }, 30 * 60_000).then((response) => {
      const status = response?.stopReason === "end_turn" ? "completed" : response?.stopReason === "cancelled" ? "cancelled" : "failed";
      if (entry.output.trim()) {
        entry.messages.push({ role: "assistant", text: entry.output.trim(), at: new Date().toISOString() });
        if (entry.messages.length > 12) entry.messages.splice(0, entry.messages.length - 12);
      }
      setEntry(entry, {
        status,
        activity: status === "completed" ? "本轮诊断已完成" : `本轮已停止：${response?.stopReason || "unknown"}`,
        error: status === "failed" ? `stop-reason:${response?.stopReason || "unknown"}` : "",
        completedAt: new Date().toISOString()
      });
      return response;
    }).catch((error) => {
      setEntry(entry, { status: "failed", activity: "诊断没有完成", error: error.message, completedAt: new Date().toISOString() });
      throw error;
    }).finally(() => { entry.running = null; });
    entry.running.catch(() => {});
    return { status: "delivered", session_id: entry.sessionId, workspace: entry.workspace };
  }

  function stateFor(workspace) {
    const entry = workspace ? sessions.get(path.resolve(workspace)) : null;
    return entry ? publicState(entry) : null;
  }

  function stop() {
    stopped = true;
    for (const entry of sessions.values()) {
      entry.closing = true;
      rejectPending(entry, new Error("codex-acp-client-stopped"));
      try { entry.child?.kill(); } catch { /* Process already exited. */ }
    }
    sessions.clear();
  }

  return { runPrompt, stateFor, stop };
}

module.exports = { MAX_OUTPUT_CHARS, PROTOCOL_VERSION, createCodexAcpClient, updateSummary };
