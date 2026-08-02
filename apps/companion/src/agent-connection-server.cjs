const { randomBytes, timingSafeEqual } = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const VERSION = "agent-achievements/v1";
const HOST = "127.0.0.1";
const HEARTBEAT_INTERVAL_MS = 5_000;
const CONNECTION_TTL_MS = 15_000;
const MAX_LINE_BYTES = 64 * 1024;

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
  try { fs.chmodSync(file, 0o600); } catch { /* Windows does not enforce POSIX permission bits. */ }
}

function safeTokenEqual(left, right) {
  const expected = Buffer.from(String(left || ""));
  const received = Buffer.from(String(right || ""));
  return expected.length === received.length && expected.length > 0 && timingSafeEqual(expected, received);
}

function normalizedTask(value) {
  if (!value || typeof value !== "object") return null;
  const id = String(value.id || "").trim().slice(0, 128);
  const summary = String(value.summary || "").trim().slice(0, 600);
  if (!id || !summary) return null;
  return { id, summary };
}

function validIdentity(message) {
  return message?.schema_version === VERSION
    && typeof message.agent_id === "string"
    && message.agent_id.trim()
    && message.agent_id.length <= 128
    && typeof message.session_id === "string"
    && message.session_id.trim()
    && message.session_id.length <= 128
    && typeof message.runtime?.id === "string"
    && message.runtime.id.trim()
    && message.runtime.id.length <= 80
    && typeof message.workspace === "string"
    && message.workspace.trim()
    && message.workspace.length <= 1000;
}

function createAgentConnectionServer(options) {
  const dataHome = path.resolve(options.dataHome);
  const endpointPath = path.join(dataHome, "connection.json");
  const token = randomBytes(32).toString("hex");
  const now = options.now || (() => Date.now());
  const connections = new Map();
  let server = null;
  let sweepTimer = null;
  let endpoint = null;

  function notifyChanged() {
    try { options.onChanged?.(); } catch { /* Rendering must not affect the socket lifecycle. */ }
  }

  function send(socket, message) {
    if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
  }

  function contextFor(agentId, workspace) {
    try { return options.getContext?.(agentId, workspace) || {}; }
    catch { return {}; }
  }

  function publicSession(connection) {
    const observedAt = new Date(connection.lastSeen).toISOString();
    return {
      schema_version: VERSION,
      session_id: connection.sessionId,
      agent_id: connection.agentId,
      runtime: { id: connection.runtimeId },
      workspace: connection.workspace,
      status: connection.status === "active" ? "active" : "idle",
      observed_at: observedAt,
      expires_at: new Date(connection.lastSeen + CONNECTION_TTL_MS).toISOString(),
      ...(connection.currentTask ? { current_task: connection.currentTask } : {}),
      extensions: { transport: "local_tcp", connected: true }
    };
  }

  function removeConnection(key, socket) {
    const current = connections.get(key);
    if (!current || (socket && current.socket !== socket)) return;
    connections.delete(key);
    notifyChanged();
  }

  function authenticate(socket, message) {
    if (message?.type !== "hello" || !safeTokenEqual(token, message.token) || !validIdentity(message)) {
      socket.destroy();
      return null;
    }
    const key = `${message.agent_id}\u0000${message.session_id}`;
    const prior = connections.get(key);
    if (prior && prior.socket !== socket) prior.socket.destroy();
    const connection = {
      key,
      socket,
      agentId: message.agent_id.trim(),
      sessionId: message.session_id.trim(),
      runtimeId: message.runtime.id.trim(),
      workspace: path.resolve(message.workspace.trim()),
      status: message.status === "active" ? "active" : "idle",
      currentTask: normalizedTask(message.current_task),
      lastSeen: now(),
      lastContext: ""
    };
    connections.set(key, connection);
    socket.connectionKey = key;
    const context = contextFor(connection.agentId, connection.workspace);
    connection.lastContext = JSON.stringify(context);
    send(socket, {
      type: "welcome",
      schema_version: VERSION,
      heartbeat_interval_ms: HEARTBEAT_INTERVAL_MS,
      connection_ttl_ms: CONNECTION_TTL_MS,
      context
    });
    notifyChanged();
    return connection;
  }

  function handleAuthenticated(connection, message) {
    if (message?.schema_version !== VERSION) return;
    connection.lastSeen = now();
    if (message.type === "ping") {
      send(connection.socket, { type: "pong", schema_version: VERSION, observed_at: new Date(connection.lastSeen).toISOString() });
    } else if (message.type === "status") {
      if (typeof message.workspace === "string" && message.workspace.trim()) connection.workspace = path.resolve(message.workspace.trim());
      if (new Set(["active", "idle", "stopped"]).has(message.status)) connection.status = message.status === "active" ? "active" : "idle";
      connection.currentTask = message.status === "stopped" ? null : normalizedTask(message.current_task);
    } else if (message.type === "task") {
      if (typeof message.workspace === "string" && message.workspace.trim()) connection.workspace = path.resolve(message.workspace.trim());
      connection.currentTask = normalizedTask(message.current_task);
      connection.status = connection.currentTask ? "active" : "idle";
    } else if (message.type === "context_request") {
      send(connection.socket, { type: "context", schema_version: VERSION, context: contextFor(connection.agentId) });
    }
    notifyChanged();
  }

  function handleSocket(socket) {
    socket.setNoDelay(true);
    socket.setTimeout(CONNECTION_TTL_MS);
    let buffer = "";
    let authenticated = false;
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (Buffer.byteLength(buffer, "utf8") > MAX_LINE_BYTES) {
        socket.destroy();
        return;
      }
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let message;
        try { message = JSON.parse(line); }
        catch { socket.destroy(); return; }
        if (!authenticated) {
          const connection = authenticate(socket, message);
          if (!connection) return;
          authenticated = true;
        } else {
          const connection = connections.get(socket.connectionKey);
          if (!connection) { socket.destroy(); return; }
          handleAuthenticated(connection, message);
        }
      }
    });
    socket.on("timeout", () => socket.destroy());
    socket.on("close", () => removeConnection(socket.connectionKey, socket));
    socket.on("error", () => {});
  }

  function sweepExpired() {
    const cutoff = now() - CONNECTION_TTL_MS;
    for (const connection of connections.values()) {
      if (connection.lastSeen < cutoff) connection.socket.destroy();
    }
  }

  function refreshContexts() {
    for (const connection of connections.values()) {
      const context = contextFor(connection.agentId, connection.workspace);
      const signature = JSON.stringify(context);
      if (signature === connection.lastContext) continue;
      connection.lastContext = signature;
      send(connection.socket, { type: "context", schema_version: VERSION, context });
    }
  }

  async function start() {
    if (server) return endpoint;
    server = net.createServer(handleSocket);
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, HOST, () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    endpoint = {
      schema_version: VERSION,
      transport: "tcp",
      host: HOST,
      port: address.port,
      token,
      observed_at: new Date(now()).toISOString(),
      pid: process.pid
    };
    writeJsonAtomic(endpointPath, endpoint);
    sweepTimer = setInterval(sweepExpired, Math.floor(HEARTBEAT_INTERVAL_MS / 2));
    sweepTimer.unref();
    return endpoint;
  }

  function stop() {
    if (sweepTimer) clearInterval(sweepTimer);
    sweepTimer = null;
    for (const connection of connections.values()) connection.socket.destroy();
    connections.clear();
    if (server) server.close();
    server = null;
    try {
      const current = JSON.parse(fs.readFileSync(endpointPath, "utf8"));
      if (current.token === token) fs.rmSync(endpointPath, { force: true });
    } catch { /* Missing or replaced endpoint belongs to no running instance here. */ }
  }

  return {
    start,
    stop,
    sessions: () => [...connections.values()].map(publicSession),
    refreshContexts,
    endpointPath
  };
}

module.exports = {
  CONNECTION_TTL_MS,
  HEARTBEAT_INTERVAL_MS,
  HOST,
  MAX_LINE_BYTES,
  createAgentConnectionServer,
  safeTokenEqual
};
