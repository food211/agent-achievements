const fs = require("node:fs");
const path = require("node:path");

const BRIDGE_STATUS_MAX_AGE_MS = 15_000;
const BRIDGE_SWEEP_INTERVAL_MS = 1_000;
const BRIDGE_RESTART_COOLDOWN_MS = 2_000;

function processIsAlive(pid, signalProcess = process.kill) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    signalProcess(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function bridgeStatusIsFresh(status, options = {}) {
  if (!status || status.agent_id !== options.agentId) return false;
  if (!new Set(["connected", "reconnecting"]).has(status.status)) return false;
  const observedAt = Date.parse(status.observed_at);
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const maxAgeMs = Number.isFinite(options.maxAgeMs) ? options.maxAgeMs : BRIDGE_STATUS_MAX_AGE_MS;
  if (!Number.isFinite(observedAt) || now - observedAt > maxAgeMs) return false;
  const alive = options.processIsAlive || processIsAlive;
  return alive(status.pid);
}

function samePath(left, right) {
  if (!left || !right) return false;
  return path.relative(path.resolve(left), path.resolve(right)) === "";
}

function dataHomeArgument(args) {
  const values = [];
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--data-home") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) return { valid: false, value: null };
      values.push(value);
      index += 1;
    } else if (argument.startsWith("--data-home=")) {
      const value = argument.slice("--data-home=".length);
      if (!value) return { valid: false, value: null };
      values.push(value);
    }
  }
  if (values.length > 1) return { valid: false, value: null };
  return { valid: true, value: values[0] || null };
}

function safeBridgeCommand(adapter, options = {}) {
  const definition = adapter?.bridge_command;
  const program = definition?.program || definition?.command;
  const args = definition?.args;
  if (!path.isAbsolute(String(program || "")) || !Array.isArray(args) || !args.length) return null;
  if (args.some((item) => typeof item !== "string" || item.length > 1000)) return null;
  const executable = path.basename(program).toLowerCase();
  const script = path.resolve(args[0]);
  const fileExists = options.fileExists || fs.existsSync;
  if (!new Set(["node", "node.exe"]).has(executable) || path.basename(script) !== "agent-bridge.mjs" || !fileExists(script)) return null;
  const cwd = definition.cwd ? path.resolve(definition.cwd) : path.dirname(script);
  if (!fileExists(cwd)) return null;
  const dataHome = dataHomeArgument(args);
  if (!dataHome.valid) return null;
  const commandDataHome = dataHome.value ? path.resolve(cwd, dataHome.value) : null;
  if (commandDataHome && (!options.dataHome || !samePath(commandDataHome, options.dataHome))) return null;
  return { program, args: [script, ...args.slice(1)], cwd };
}

function stopSupervisedBridges(supervised) {
  if (!supervised) return;
  for (const record of supervised.values()) {
    record.running = false;
    try {
      if (record.child && !record.child.killed) record.child.kill();
    } catch { /* The bridge has already exited. */ }
  }
  supervised.clear();
}

module.exports = {
  BRIDGE_RESTART_COOLDOWN_MS,
  BRIDGE_STATUS_MAX_AGE_MS,
  BRIDGE_SWEEP_INTERVAL_MS,
  bridgeStatusIsFresh,
  processIsAlive,
  safeBridgeCommand,
  stopSupervisedBridges
};
