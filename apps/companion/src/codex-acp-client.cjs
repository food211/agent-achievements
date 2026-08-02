const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const PROTOCOL_VERSION = 1;
const START_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_CHARS = 12_000;
const SESSION_STORE_VERSION = "wuxing-companion-sessions/v1";

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

function childEnvironment(environment = process.env, versions = process.versions) {
  return {
    ...environment,
    ...(versions?.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {})
  };
}

function acpSpawnOptions(entry, launch = {}, options = {}) {
  return {
    cwd: entry.workspace,
    // VS Code and terminal hosts can terminate their shared Windows console
    // group during shutdown.  ACP is owned by the companion, so it needs its
    // own process group and must not inherit that Ctrl+C lifecycle.
    detached: process.platform === "win32",
    windowsHide: true,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...childEnvironment(),
      ...(launch.env || {}),
      INITIAL_AGENT_MODE: "read-only",
      APP_SERVER_LOGS: path.join(options.dataHome || entry.workspace, "codex-acp-logs")
    }
  };
}

function permissionOutcome(request, options = {}) {
  // A desktop conversation must not silently turn into a shell approval
  // surface.  ACP agents may ask for network or broader sandbox escalation as
  // part of an execute request, so accepting every `allow_once` is unsafe.
  if (options.allowCommands !== true || request?.toolCall?.kind !== "execute") {
    return { outcome: { outcome: "cancelled" } };
  }
  if (request.params?.networkApprovalContext || request.toolCall?.networkApprovalContext || request.toolCall?.rawInput?.networkApprovalContext) {
    return { outcome: { outcome: "cancelled" } };
  }
  const command = String(request.toolCall?.rawInput?.command || request.toolCall?.command || "").trim();
  const allowed = Array.isArray(options.allowedCommands) ? options.allowedCommands : [];
  if (!command || !allowed.some((pattern) => pattern instanceof RegExp ? pattern.test(command) : command === String(pattern))) {
    return { outcome: { outcome: "cancelled" } };
  }
  const allowOnce = request.options?.find((option) => option.kind === "allow_once");
  return allowOnce ? { outcome: { outcome: "selected", optionId: allowOnce.optionId } } : { outcome: { outcome: "cancelled" } };
}

function sameWorkspace(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function createSessionStore(dataHome, options = {}) {
  const schemaVersion = options.schemaVersion || SESSION_STORE_VERSION;
  const file = path.join(dataHome, options.fileName || "codex-acp-sessions.json");
  function read() {
    try {
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      return value?.schema_version === schemaVersion && Array.isArray(value.sessions)
        ? value
        : { schema_version: schemaVersion, sessions: [] };
    } catch {
      return { schema_version: schemaVersion, sessions: [] };
    }
  }
  function write(document) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, file);
  }
  return {
    get(workspace) {
      return read().sessions.find((item) => path.resolve(item.workspace) === path.resolve(workspace)) || null;
    },
    save(workspace, sessionId, messages = []) {
      const document = read();
      const normalized = path.resolve(workspace);
      const record = {
        workspace: normalized,
        session_id: sessionId,
        messages: messages.slice(-12),
        updated_at: new Date().toISOString()
      };
      const index = document.sessions.findIndex((item) => path.resolve(item.workspace) === normalized);
      if (index >= 0) document.sessions[index] = record;
      else document.sessions.push(record);
      write(document);
      return record;
    },
    remove(workspace) {
      const document = read();
      const normalized = path.resolve(workspace);
      const sessions = document.sessions.filter((item) => path.resolve(item.workspace) !== normalized);
      if (sessions.length !== document.sessions.length) write({ ...document, sessions });
    },
    file
  };
}

function createCodexAcpClient(options = {}) {
  const adapterName = options.adapterName || "Codex";
  const errorPrefix = options.errorPrefix || "codex-acp";
  const onChanged = options.onChanged || (() => {});
  const spawnProcess = options.spawnProcess || spawn;
  const resolveAgentPath = options.resolveAgentPath || (() => require.resolve("@agentclientprotocol/codex-acp"));
  const sessionStore = options.sessionStore || createSessionStore(path.resolve(options.dataHome || process.cwd()));
  const sessions = new Map();
  const pendingSessionSelections = new Map();
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

  function saveEntry(entry) {
    if (entry.sessionId) sessionStore.save(entry.workspace, entry.sessionId, entry.messages);
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
      const outcome = permissionOutcome(message.params, options.permissionPolicy);
      respond(entry, message.id, outcome);
      setEntry(entry, {
        activity: outcome.outcome.outcome === "selected"
          ? "已允许一条明确配置的检查命令"
          : "已拒绝需要额外权限的操作"
      });
      return;
    }
    if (message.method !== "session/update" || message.params?.sessionId !== entry.sessionId) return;
    if (entry.restoring) {
      if (entry.captureHistory) captureHistoryUpdate(entry, message.params.update);
      return;
    }
    const summary = updateSummary(message.params.update);
    if (!summary) return;
    if (summary.kind === "text") setEntry(entry, { output: clipped(`${entry.output}${summary.text}`), activity: "Agent 正在回复" });
    else setEntry(entry, { activity: clipped(summary.text, 300) });
  }

  function captureHistoryUpdate(entry, update) {
    const role = update?.sessionUpdate === "user_message_chunk"
      ? "user"
      : update?.sessionUpdate === "agent_message_chunk" ? "assistant" : null;
    if (!role || update.content?.type !== "text" || !update.content.text) return;
    const explicitKey = update.messageId ? `${role}:${update.messageId}` : null;
    const key = explicitKey || (entry.historyRole === role ? entry.historyKey : `${role}:${++entry.historySequence}`);
    const last = entry.messages.at(-1);
    if (last && entry.historyKey === key) last.text = clipped(`${last.text}${update.content.text}`, 1000);
    else entry.messages.push({ role, text: clipped(update.content.text, 1000), at: new Date().toISOString() });
    entry.historyRole = role;
    entry.historyKey = key;
    if (entry.messages.length > 12) entry.messages.splice(0, entry.messages.length - 12);
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
    const launch = options.launch
      ? options.launch(entry)
      : { program: process.execPath, args: [resolveAgentPath()], env: {} };
    if (!launch?.program || !Array.isArray(launch.args)) throw new Error(`${errorPrefix}-launch-invalid`);
    entry.child = spawnProcess(launch.program, launch.args, acpSpawnOptions(entry, launch, options));
    attachOutput(entry);
    entry.child.once("error", (error) => {
      rejectPending(entry, error);
      setEntry(entry, { status: "failed", error: error.message, completedAt: new Date().toISOString() });
    });
    entry.child.once("exit", (code, signal) => {
      if (entry.closing) return;
      const detail = entry.stderr.trim().split(/\r?\n/).at(-1);
      const reason = signal || `code ${code}`;
      const suffix = detail ? `：${clipped(detail, 500)}` : "";
      const error = new Error(`${adapterName} ACP process exited (${reason})${suffix}`);
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
    entry.capabilities = initialized?.agentCapabilities?.sessionCapabilities || {};
    const selection = pendingSessionSelections.get(entry.workspace) || null;
    pendingSessionSelections.delete(entry.workspace);
    const saved = selection
      ? { session_id: selection.sessionId, messages: [] }
      : sessionStore.get(entry.workspace);
    const canResume = entry.capabilities?.resume !== undefined;
    const canLoad = initialized?.agentCapabilities?.loadSession === true;
    const forceLoad = Boolean(selection);
    let resumed = false;
    let replacedUnrestorableSession = false;
    if (saved?.session_id && (canResume || canLoad)) {
      entry.sessionId = saved.session_id;
      entry.messages = Array.isArray(saved.messages) ? saved.messages.slice(-12) : [];
      entry.restoring = true;
      entry.captureHistory = forceLoad && canLoad;
      try {
        const params = { sessionId: saved.session_id, cwd: entry.workspace, mcpServers: [] };
        if (forceLoad && canLoad) {
          await request(entry, "session/load", params);
        } else if (canResume) {
          try {
            await request(entry, "session/resume", params);
          } catch (resumeError) {
            if (!canLoad) throw resumeError;
            await request(entry, "session/load", params);
          }
        } else {
          await request(entry, "session/load", params);
        }
        resumed = true;
      } catch (error) {
        if (forceLoad) throw new Error(`codex-acp-session-restore-failed:${saved.session_id}:${error.message}`);
        // A newly created ACP session may not exist on disk until its first
        // turn completes.  Persisting that empty id used to make every future
        // startup retry an impossible restore forever.  Keep the real Codex
        // history untouched, forget only the companion pointer, and continue
        // with a fresh local session.
        sessionStore.remove(entry.workspace);
        entry.sessionId = null;
        entry.messages = [];
        replacedUnrestorableSession = true;
      } finally {
        entry.restoring = false;
        entry.captureHistory = false;
        entry.historyKey = null;
        entry.historyRole = null;
      }
    }
    if (!entry.sessionId) {
      const session = await request(entry, "session/new", { cwd: entry.workspace, mcpServers: [] });
      if (!session?.sessionId) throw new Error("codex-acp-session-missing");
      entry.sessionId = session.sessionId;
    }
    if (resumed) saveEntry(entry);
    setEntry(entry, {
      status: "ready",
      activity: resumed
        ? `已恢复 ${adapterName} 助手对话，等待消息`
        : replacedUnrestorableSession
          ? `旧对话暂时无法恢复，已开始新的 ${adapterName} 助手对话`
          : `${adapterName} 已连接，等待消息`
    });
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
      activity: `正在连接本机 ${adapterName}`,
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
      restoring: false,
      captureHistory: false,
      historyKey: null,
      historyRole: null,
      historySequence: 0,
      running: null,
      capabilities: null
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
      activity: "消息已送达，Agent 正在处理",
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
      saveEntry(entry);
      setEntry(entry, {
        status,
        activity: status === "completed" ? "本轮对话已完成" : `本轮已停止：${response?.stopReason || "unknown"}`,
        error: status === "failed" ? `stop-reason:${response?.stopReason || "unknown"}` : "",
        completedAt: new Date().toISOString()
      });
      return response;
    }).catch((error) => {
      setEntry(entry, { status: "failed", activity: "消息处理没有完成", error: error.message, completedAt: new Date().toISOString() });
      throw error;
    }).finally(() => { entry.running = null; });
    entry.running.catch(() => {});
    return { status: "delivered", session_id: entry.sessionId, workspace: entry.workspace };
  }

  function stateFor(workspace) {
    if (!workspace) return null;
    const normalized = path.resolve(workspace);
    const entry = sessions.get(normalized);
    if (entry) return publicState(entry);
    const saved = sessionStore.get(normalized);
    if (!saved?.session_id) return null;
    return {
      workspace: normalized,
      status: "saved",
      output: "",
      activity: "正在恢复助手对话",
      error: "",
      session_id: saved.session_id,
      started_at: saved.updated_at || null,
      completed_at: saved.updated_at || null,
      messages: Array.isArray(saved.messages) ? saved.messages.slice(-12) : []
    };
  }

  async function connect(workspace) {
    return withReadableSession(workspace, async (entry) => publicState(entry));
  }

  async function resetSession(workspace) {
    const normalized = path.resolve(workspace);
    const existing = sessions.get(normalized);
    if (existing?.running && existing.status === "streaming") throw new Error("codex-acp-prompt-in-progress");
    if (existing?.running) {
      try { await existing.running; } catch { /* A completed failed turn may still be settling. */ }
    }
    if (existing) {
      existing.closing = true;
      rejectPending(existing, new Error("codex-acp-session-reset"));
      try { existing.child?.kill(); } catch { /* The ACP process has already exited. */ }
      sessions.delete(normalized);
    }
    sessionStore.remove(normalized);
    notify();
    const entry = await ensureSession(normalized);
    return publicState(entry);
  }

  async function listSessions(workspace) {
    const normalized = path.resolve(workspace);
    return withReadableSession(normalized, async (entry) => {
      if (entry.running && entry.status === "streaming") throw new Error("codex-acp-prompt-in-progress");
      if (entry.capabilities?.list === undefined) throw new Error(`${errorPrefix}-session-list-unsupported`);
      const listed = [];
      let cursor = null;
      do {
        const response = await request(entry, "session/list", { cwd: normalized, cursor });
        listed.push(...(response?.sessions || []));
        cursor = response?.nextCursor || null;
      } while (cursor && listed.length < 120);
      return listed
        .filter((item) => item?.sessionId && item?.cwd && sameWorkspace(item.cwd, normalized))
        .map((item) => ({
          session_id: String(item.sessionId),
          workspace: path.resolve(item.cwd),
          title: String(item.title || "未命名对话").replace(/\s+/g, " ").trim().slice(0, 80),
          updated_at: item.updatedAt || null
        }));
    });
  }

  async function withReadableSession(workspace, action) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await action(await ensureSession(workspace));
      } catch (error) {
        if (attempt > 0 || !/ACP process exited|codex-acp-not-running|codex-acp-timeout/.test(String(error?.message || error))) throw error;
      }
      // Retrying a read-only startup/list action is safe.  Do not apply this
      // to session/prompt: a server might have accepted the prompt before its
      // transport died, and retrying it could execute the user request twice.
    }
    throw new Error(`${errorPrefix}-read-session-retry-exhausted`);
  }

  async function switchSession(workspace, sessionId) {
    const normalized = path.resolve(workspace);
    const selectedId = String(sessionId || "").trim();
    if (!selectedId) throw new Error("codex-acp-session-id-invalid");
    const available = await listSessions(normalized);
    if (!available.some((item) => item.session_id === selectedId)) throw new Error("codex-acp-session-not-found");
    const existing = sessions.get(normalized);
    if (existing?.running && existing.status === "streaming") throw new Error("codex-acp-prompt-in-progress");
    if (existing?.running) {
      try { await existing.running; } catch { /* A completed failed turn may still be settling. */ }
    }
    if (existing) {
      existing.closing = true;
      rejectPending(existing, new Error("codex-acp-session-switch"));
      try { existing.child?.kill(); } catch { /* The ACP process has already exited. */ }
      sessions.delete(normalized);
    }
    pendingSessionSelections.set(normalized, { sessionId: selectedId });
    notify();
    const entry = await ensureSession(normalized);
    return publicState(entry);
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

  return { connect, listSessions, resetSession, runPrompt, stateFor, stop, switchSession };
}

module.exports = { MAX_OUTPUT_CHARS, PROTOCOL_VERSION, SESSION_STORE_VERSION, acpSpawnOptions, childEnvironment, createCodexAcpClient, createSessionStore, permissionOutcome, updateSummary };
