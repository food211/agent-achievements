#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  unlink,
  writeFile
} from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const VERSION = "agent-achievements/v1";

const DEFAULT_HEARTBEAT_MS = 5_000;
const DEFAULT_RECONNECT_MS = 500;
const MAX_RECONNECT_MS = 5_000;
const ACTIVITY_POLL_MS = 1_000;
const STATUS_REFRESH_MS = 5_000;
const MAX_LINE_BYTES = 1024 * 1024;
const LOCK_STALE_MS = 20_000;
const INBOX_ACTION_LIMIT = 100;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isoNow() {
  return new Date().toISOString();
}

function normalizedString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function validatedIdentity(value, field, maxLength) {
  const raw = String(value ?? "");
  const text = raw.trim();
  if (!text || text.length > maxLength || /[\u0000-\u001f\u007f-\u009f]/.test(raw)) {
    throw new Error(`${field} must be a non-empty string without control characters and at most ${maxLength} characters.`);
  }
  return text;
}

function safeJson(value) {
  if (Array.isArray(value)) return value.map(safeJson);
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (["token", "secret", "authorization"].includes(key.toLowerCase())) continue;
    result[key] = safeJson(item);
  }
  return result;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function contentKey(value) {
  const explicitId = value?.action_id || value?.id || value?.request_id;
  if (explicitId) return `id:${explicitId}`;
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

export function agentBridgeHash(agentId) {
  return createHash("sha256").update(String(agentId), "utf8").digest("hex").slice(0, 16);
}

export function resolveDataHome(environment = process.env) {
  return path.resolve(environment.AGENT_ACHIEVEMENTS_HOME || path.join(os.homedir(), ".agent-achievements"));
}

export function bridgePaths(dataHome, agentId) {
  const stem = agentBridgeHash(agentId);
  const directory = path.join(dataHome, "bridges");
  return {
    directory,
    lock: path.join(directory, `${stem}.lock`),
    status: path.join(directory, `${stem}.json`)
  };
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

export async function atomicWriteJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function acquireInboxLock(dataHome) {
  const lock = path.join(dataHome, ".agent-inbox.lock");
  await mkdir(dataHome, { recursive: true });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const handle = await open(lock, "wx");
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, observed_at: isoNow() })}\n`, "utf8");
      await handle.close();
      return async () => unlink(lock).catch(() => {});
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const details = await readJson(lock);
      const timestamp = Date.parse(details?.observed_at || "");
      if (!Number.isFinite(timestamp) || Date.now() - timestamp > LOCK_STALE_MS) {
        await unlink(lock).catch(() => {});
        continue;
      }
      await sleep(10);
    }
  }
  throw new Error("Timed out while waiting to update the Agent inbox.");
}

function extractInboxUpdate(message) {
  let context;
  const actions = [];
  let replaceActions = false;
  if (message?.context && typeof message.context === "object") context = safeJson(message.context);
  if (message?.type === "context" && context === undefined) {
    context = safeJson(message.payload && typeof message.payload === "object" ? message.payload : message);
  }
  if (message?.action && typeof message.action === "object") actions.push(safeJson(message.action));
  if (Array.isArray(message?.actions)) actions.push(...message.actions.filter((item) => item && typeof item === "object").map(safeJson));
  if (message?.type === "action" && actions.length === 0) {
    const payload = message.payload && typeof message.payload === "object" ? message.payload : message;
    actions.push(safeJson(payload));
  }
  if (message?.type === "actions" && Array.isArray(message.payload)) {
    actions.push(...message.payload.filter((item) => item && typeof item === "object").map(safeJson));
  }
  const contextActions = context?.agent_actions;
  if (Array.isArray(contextActions)) {
    replaceActions = true;
    actions.push(...contextActions.filter((item) => item && typeof item === "object").map(safeJson));
  }
  return { context, actions, replaceActions };
}

export async function updateAgentInbox(dataHome, identity, message) {
  const update = extractInboxUpdate(message);
  if (update.context === undefined && update.actions.length === 0) return false;
  const inboxPath = path.join(dataHome, "agent-inbox.json");
  const release = await acquireInboxLock(dataHome);
  try {
    const existing = await readJson(inboxPath, { schema_version: VERSION, updated_at: isoNow(), agents: [] });
    const agents = Array.isArray(existing?.agents) ? existing.agents.filter((item) => item && typeof item === "object") : [];
    let agent = agents.find((item) => item.agent_id === identity.agentId);
    if (!agent) {
      agent = { agent_id: identity.agentId, actions: [] };
      agents.push(agent);
    }
    agent.session_id = identity.sessionId;
    agent.runtime = { id: identity.runtimeId };
    agent.updated_at = isoNow();
    if (update.context !== undefined) agent.context = update.context;

    const knownActions = new Map();
    if (!update.replaceActions) {
      for (const entry of Array.isArray(agent.actions) ? agent.actions : []) {
        if (!entry?.payload || typeof entry.payload !== "object") continue;
        knownActions.set(contentKey(entry.payload), entry);
      }
    }
    for (const action of update.actions) {
      knownActions.set(contentKey(action), { received_at: isoNow(), payload: action });
    }
    agent.actions = [...knownActions.values()].slice(-INBOX_ACTION_LIMIT);

    await atomicWriteJson(inboxPath, {
      schema_version: VERSION,
      updated_at: isoNow(),
      agents
    });
    return true;
  } finally {
    await release();
  }
}

function endpointText(host, port) {
  return `tcp://${host.includes(":") ? `[${host}]` : host}:${port}`;
}

function isLoopback(host) {
  const normalized = String(host).trim().toLowerCase();
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1" || normalized === "[::1]";
}

export function parseEndpoint(input) {
  const raw = normalizedString(input);
  if (!raw) throw new Error("A local bridge endpoint is required.");
  let url;
  try {
    url = new URL(raw.includes("://") ? raw : `tcp://${raw}`);
  } catch {
    throw new Error("The bridge endpoint must be tcp://host:port or host:port.");
  }
  if (url.protocol !== "tcp:") throw new Error("Only the tcp transport is supported.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const port = Number(url.port);
  if (!isLoopback(host)) throw new Error("The Agent bridge only connects to a loopback endpoint.");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("The bridge endpoint has an invalid port.");
  return { host, port, endpoint: endpointText(host, port) };
}

export async function loadConnection(dataHome, overrides = {}) {
  const configured = await readJson(path.join(dataHome, "connection.json"));
  const parsed = overrides.endpoint
    ? parseEndpoint(overrides.endpoint)
    : (() => {
        if (!configured || configured.transport !== "tcp") throw new Error("The companion connection is not available yet.");
        return parseEndpoint(`tcp://${configured.host}:${configured.port}`);
      })();
  const token = normalizedString(overrides.token || configured?.token);
  if (!token) throw new Error("The companion connection token is unavailable.");
  return { ...parsed, token };
}

function isSessionCurrent(session, now = Date.now()) {
  if (!session || !["active", "idle"].includes(session.status)) return false;
  const expiresAt = Date.parse(session.expires_at || "");
  return !Number.isFinite(expiresAt) || expiresAt > now;
}

export function selectPresenceSession(document, agentId, sessionId, now = Date.now()) {
  const sessions = Array.isArray(document?.sessions) ? document.sessions : [];
  const eligible = sessions.filter((item) => item?.agent_id === agentId && isSessionCurrent(item, now));
  return eligible.sort((left, right) => {
    const leftActive = left.status === "active" ? 1 : 0;
    const rightActive = right.status === "active" ? 1 : 0;
    if (leftActive !== rightActive) return rightActive - leftActive;
    const leftHasTask = leftActive && left.current_task && typeof left.current_task === "object" ? 1 : 0;
    const rightHasTask = rightActive && right.current_task && typeof right.current_task === "object" ? 1 : 0;
    if (leftHasTask !== rightHasTask) return rightHasTask - leftHasTask;
    const observedDifference = (Date.parse(right.observed_at || "") || 0) - (Date.parse(left.observed_at || "") || 0);
    if (observedDifference) return observedDifference;
    return Number(right.session_id === sessionId) - Number(left.session_id === sessionId);
  })[0] || null;
}

async function readActivity(dataHome, identity) {
  const document = await readJson(path.join(dataHome, "presence.json"), { sessions: [] });
  const session = selectPresenceSession(document, identity.agentId, identity.sessionId);
  if (!session) {
    return {
      status: "idle",
      known: false,
      workspace: identity.workspace,
      observedAt: isoNow(),
      presenceSessionId: null,
      currentTask: null
    };
  }
  return {
    status: session.status,
    known: true,
    workspace: typeof session.workspace === "string" ? session.workspace : identity.workspace,
    observedAt: session.observed_at || isoNow(),
    presenceSessionId: session.session_id,
    currentTask: session.current_task && typeof session.current_task === "object" ? safeJson(session.current_task) : null
  };
}

function processIsAlive(pid) {
  const processId = Number(pid);
  if (!Number.isInteger(processId) || processId <= 0) return false;
  if (processId === process.pid) return true;
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function acquireAgentLock(paths, identity) {
  await mkdir(paths.directory, { recursive: true });
  const ownerId = randomUUID();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const handle = await open(paths.lock, "wx");
      await handle.writeFile(`${JSON.stringify({
        owner_id: ownerId,
        pid: process.pid,
        agent_id: identity.agentId,
        session_id: identity.sessionId,
        observed_at: isoNow()
      })}\n`, "utf8");
      await handle.close();
      return { acquired: true, ownerId };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const details = await readJson(paths.lock);
      const observedAt = Date.parse(details?.observed_at || "");
      const stale = !processIsAlive(details?.pid) || !Number.isFinite(observedAt) || Date.now() - observedAt > LOCK_STALE_MS;
      if (!stale) return { acquired: false, ownerId: null };
      await unlink(paths.lock).catch(() => {});
    }
  }
  return { acquired: false, ownerId: null };
}

async function refreshAgentLock(lockPath, ownerId, identity) {
  const existing = await readJson(lockPath);
  if (existing?.owner_id !== ownerId) throw new Error("Agent bridge lock ownership was lost.");
  await atomicWriteJson(lockPath, {
    owner_id: ownerId,
    pid: process.pid,
    agent_id: identity.agentId,
    session_id: identity.sessionId,
    observed_at: isoNow()
  });
}

async function releaseAgentLock(lockPath, ownerId) {
  const existing = await readJson(lockPath);
  if (existing?.owner_id === ownerId) await unlink(lockPath).catch(() => {});
}

function normalizeHeartbeat(value) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds)) return DEFAULT_HEARTBEAT_MS;
  return Math.max(250, Math.min(60_000, Math.round(milliseconds)));
}

function writeLine(socket, message) {
  if (!socket.destroyed && socket.writable) socket.write(`${JSON.stringify(message)}\n`, "utf8");
}

function activityFingerprint(activity) {
  return stableJson({ status: activity.status, known: activity.known, workspace: activity.workspace, current_task: activity.currentTask });
}

export class AgentBridge {
  constructor(options) {
    this.dataHome = path.resolve(options.dataHome);
    this.identity = {
      agentId: validatedIdentity(options.agentId, "agent_id", 128),
      runtimeId: validatedIdentity(options.runtimeId, "runtime_id", 80),
      sessionId: validatedIdentity(options.sessionId, "session_id", 128),
      workspace: path.resolve(options.workspace || process.cwd())
    };
    this.endpointOverride = options.endpoint || "";
    this.tokenOverride = options.token || "";
    this.once = Boolean(options.once);
    this.reconnectMs = Math.max(25, Number(options.reconnectMs) || DEFAULT_RECONNECT_MS);
    this.connectTimeoutMs = Math.max(250, Number(options.connectTimeoutMs) || 10_000);
    this.onceTimeoutMs = Math.max(500, Number(options.onceTimeoutMs) || 10_000);
    this.paths = bridgePaths(this.dataHome, this.identity.agentId);
    this.stopping = false;
    this.socket = null;
    this.currentEndpoint = "pending";
    this.lockOwnerId = null;
  }

  async writeBridgeStatus(status) {
    if (!this.lockOwnerId) return;
    await refreshAgentLock(this.paths.lock, this.lockOwnerId, this.identity);
    await atomicWriteJson(this.paths.status, {
      schema_version: VERSION,
      agent_id: this.identity.agentId,
      session_id: this.identity.sessionId,
      runtime: { id: this.identity.runtimeId },
      workspace: this.identity.workspace,
      status,
      observed_at: isoNow(),
      endpoint: this.currentEndpoint,
      pid: process.pid
    });
  }

  async stop() {
    if (this.stopping) return;
    this.stopping = true;
    if (this.socket && !this.socket.destroyed) this.socket.end();
  }

  async run() {
    await mkdir(this.dataHome, { recursive: true });
    const lock = await acquireAgentLock(this.paths, this.identity);
    if (!lock.acquired) return { status: "already_running", agent_id: this.identity.agentId };
    this.lockOwnerId = lock.ownerId;
    let reconnectDelay = this.reconnectMs;
    try {
      while (!this.stopping) {
        let connection;
        try {
          connection = await loadConnection(this.dataHome, { endpoint: this.endpointOverride, token: this.tokenOverride });
          this.currentEndpoint = connection.endpoint;
          await this.writeBridgeStatus("reconnecting");
        } catch (error) {
          await this.writeBridgeStatus("reconnecting");
          if (this.once) throw error;
          await sleep(Math.min(reconnectDelay, MAX_RECONNECT_MS));
          reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_MS);
          continue;
        }

        const outcome = await this.connect(connection);
        if (this.once && outcome.welcomed) break;
        if (this.once) throw outcome.error || new Error("The companion closed before authenticating the Agent bridge.");
        if (this.stopping) break;
        reconnectDelay = outcome.welcomed ? this.reconnectMs : Math.min(reconnectDelay * 2, MAX_RECONNECT_MS);
        await this.writeBridgeStatus("reconnecting");
        await sleep(Math.min(reconnectDelay, MAX_RECONNECT_MS));
      }
      return { status: "stopped", agent_id: this.identity.agentId, session_id: this.identity.sessionId };
    } finally {
      if (this.lockOwnerId) {
        await this.writeBridgeStatus("stopped").catch(() => {});
        await releaseAgentLock(this.paths.lock, this.lockOwnerId);
        this.lockOwnerId = null;
      }
    }
  }

  async connect(connection) {
    const identity = this.identity;
    const initialActivity = await readActivity(this.dataHome, identity);
    return new Promise((resolve) => {
      const socket = net.createConnection({ host: connection.host, port: connection.port });
      this.socket = socket;
      socket.setNoDelay(true);
      socket.setKeepAlive(true, DEFAULT_HEARTBEAT_MS);
      let buffer = "";
      let welcomed = false;
      let closed = false;
      let connectionError = null;
      let heartbeatMs = DEFAULT_HEARTBEAT_MS;
      let heartbeatTimer;
      let activityTimer;
      let statusTimer;
      let onceTimer;
      let lastInboundAt = Date.now();
      let lastActivityFingerprint = "";
      let lastTaskFingerprint = "";
      let lastActivitySentAt = 0;
      let processing = Promise.resolve();

      const clearTimers = () => {
        clearTimeout(onceTimer);
        clearInterval(heartbeatTimer);
        clearInterval(activityTimer);
        clearInterval(statusTimer);
      };

      const finish = () => {
        if (closed) return;
        closed = true;
        clearTimers();
        if (this.socket === socket) this.socket = null;
        processing.finally(() => resolve({ welcomed, error: connectionError }));
      };

      const resetHeartbeat = (requestedInterval) => {
        heartbeatMs = normalizeHeartbeat(requestedInterval);
        clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(() => {
          if (Date.now() - lastInboundAt > Math.max(heartbeatMs * 3, 15_000)) {
            socket.destroy(new Error("Companion heartbeat timed out."));
            return;
          }
          writeLine(socket, {
            type: "ping",
            schema_version: VERSION,
            agent_id: identity.agentId,
            session_id: identity.sessionId,
            workspace: identity.workspace,
            sent_at: isoNow()
          });
        }, heartbeatMs);
      };

      const sendActivity = async (activity, force = false) => {
        const now = Date.now();
        const fingerprint = activityFingerprint(activity);
        if (force || fingerprint !== lastActivityFingerprint || now - lastActivitySentAt >= 30_000) {
          writeLine(socket, {
            type: "status",
            schema_version: VERSION,
            agent_id: identity.agentId,
            session_id: identity.sessionId,
            workspace: activity.workspace || identity.workspace,
            status: activity.status,
            activity_known: activity.known,
            observed_at: activity.observedAt,
            ...(activity.presenceSessionId ? { presence_session_id: activity.presenceSessionId } : {}),
            ...(activity.currentTask ? { current_task: activity.currentTask } : {})
          });
          lastActivityFingerprint = fingerprint;
          lastActivitySentAt = now;
        }
        // A remembered task may remain in an idle presence record. Only an explicitly
        // active presence may turn a task message into active work on the server.
        const forwardedTask = activity.status === "active" ? activity.currentTask : null;
        const currentTaskFingerprint = stableJson(forwardedTask);
        const previouslyHadTask = lastTaskFingerprint && lastTaskFingerprint !== stableJson(null);
        const shouldSendTask = forwardedTask !== null || previouslyHadTask;
        if (shouldSendTask && (force || currentTaskFingerprint !== lastTaskFingerprint)) {
          writeLine(socket, {
            type: "task",
            schema_version: VERSION,
            agent_id: identity.agentId,
            session_id: identity.sessionId,
            workspace: activity.workspace || identity.workspace,
            current_task: forwardedTask,
            observed_at: activity.observedAt
          });
        }
        lastTaskFingerprint = currentTaskFingerprint;
      };

      const handleMessage = async (message) => {
        if (!message || typeof message !== "object") return;
        lastInboundAt = Date.now();
        if (message.type === "welcome") {
          welcomed = true;
          resetHeartbeat(message.heartbeat_interval_ms);
          await this.writeBridgeStatus("connected");
        }
        if (message.type === "ping") {
          writeLine(socket, { type: "pong", schema_version: VERSION, sent_at: isoNow() });
        }
        await updateAgentInbox(this.dataHome, identity, message);
        if (this.once && message.type === "welcome") socket.end();
        if (message.type === "error" && ["unauthorized", "invalid_token"].includes(message.code)) {
          connectionError = new Error("The companion rejected the bridge credentials.");
          socket.end();
        }
      };

      const processData = (chunk) => {
        buffer += chunk.toString("utf8");
        if (Buffer.byteLength(buffer, "utf8") > MAX_LINE_BYTES && !buffer.includes("\n")) {
          socket.destroy(new Error("Companion message exceeded the bridge size limit."));
          return;
        }
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;
          let message;
          try {
            message = JSON.parse(line);
          } catch {
            continue;
          }
          processing = processing.then(() => handleMessage(message));
        }
      };

      socket.once("connect", () => {
        clearTimeout(connectTimer);
        const hello = {
          type: "hello",
          schema_version: VERSION,
          token: connection.token,
          agent_id: identity.agentId,
          session_id: identity.sessionId,
          runtime: { id: identity.runtimeId },
          workspace: initialActivity.workspace || identity.workspace,
          ...(initialActivity.currentTask ? { current_task: initialActivity.currentTask } : {})
        };
        writeLine(socket, hello);
        void sendActivity(initialActivity, true);
        resetHeartbeat(DEFAULT_HEARTBEAT_MS);
        activityTimer = setInterval(() => {
          void readActivity(this.dataHome, identity).then((activity) => sendActivity(activity)).catch(() => {});
        }, ACTIVITY_POLL_MS);
        statusTimer = setInterval(() => {
          void this.writeBridgeStatus("connected").catch(() => socket.destroy());
        }, STATUS_REFRESH_MS);
        if (this.once) {
          onceTimer = setTimeout(() => socket.destroy(new Error("Timed out waiting for the companion welcome message.")), this.onceTimeoutMs);
        }
      });

      const connectTimer = setTimeout(() => {
        socket.destroy(new Error("Timed out connecting to the companion."));
      }, this.connectTimeoutMs);

      socket.on("data", processData);
      socket.once("error", (error) => {
        connectionError = error;
      });
      socket.once("close", () => {
        clearTimeout(connectTimer);
        finish();
      });
    });
  }
}

function parseArgs(argv) {
  const options = { once: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--once") {
      options.once = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`);
    const key = argument.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for --${key}.`);
    options[key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    index += 1;
  }
  return options;
}

function usage() {
  return [
    "Usage: node agent-bridge.mjs --agent <id> --runtime <id> --session <id> [options]",
    "",
    "Options:",
    "  --endpoint <tcp://127.0.0.1:port>  Override connection.json endpoint.",
    "  --token <token>                     Override connection.json token.",
    "  --data-home <absolute-path>          Override AGENT_ACHIEVEMENTS_HOME.",
    "  --once                              Exit after the authenticated welcome.",
    "  --reconnect-ms <milliseconds>        Initial reconnect delay.",
    "  --connect-timeout-ms <milliseconds>  Per-attempt connection timeout.",
    "  --once-timeout-ms <milliseconds>     Welcome timeout in --once mode."
  ].join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const bridge = new AgentBridge({
    dataHome: options.dataHome ? path.resolve(options.dataHome) : resolveDataHome(),
    agentId: options.agent,
    runtimeId: options.runtime,
    sessionId: options.session,
    workspace: options.workspace ? path.resolve(options.workspace) : process.cwd(),
    endpoint: options.endpoint,
    token: options.token,
    once: options.once,
    reconnectMs: options.reconnectMs,
    connectTimeoutMs: options.connectTimeoutMs,
    onceTimeoutMs: options.onceTimeoutMs
  });
  const stop = () => { void bridge.stop(); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const result = await bridge.run();
  if (options.once || result.status === "already_running") process.stdout.write(`${JSON.stringify(result)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
