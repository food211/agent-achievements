#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "agent-achievements/v1";
const BRIDGE_FRESH_MS = 15_000;
const STATE_LOCK_STALE_MS = 30_000;
const COMPANION_FRESH_MS = 15_000;
const COMPANION_LAUNCH_COOLDOWN_MS = 10_000;
const here = path.dirname(fileURLToPath(import.meta.url));
const bridgeScript = path.join(here, "agent-bridge.mjs");
const hookArgs = process.argv.slice(2);

function hookOption(name, fallback = "") {
  const index = hookArgs.indexOf(`--${name}`);
  return index >= 0 && hookArgs[index + 1] !== undefined ? hookArgs[index + 1] : fallback;
}

function identityOption(name, fallback, maxLength) {
  const value = String(hookOption(name, fallback)).trim();
  return value && value.length <= maxLength && !/[\u0000-\u001f]/.test(value) ? value : fallback;
}

const AGENT_ID = identityOption("agent", "codex-local", 128);
const RUNTIME_ID = identityOption("runtime", "codex", 80);
const dataHome = path.resolve(hookOption("data-home", process.env.AGENT_ACHIEVEMENTS_HOME || path.join(os.homedir(), ".agent-achievements")));
const presencePath = path.join(dataHome, "presence.json");
const statePath = path.join(dataHome, "state.json");
const lockPath = path.join(dataHome, ".achievement-cli.lock");
const companionStatusPath = path.join(dataHome, "companion-status.json");
const companionLaunchLockPath = path.join(dataHome, ".companion-launch.lock");
const bridgeDigest = createHash("sha256").update(AGENT_ID, "utf8").digest("hex").slice(0, 16);
const bridgeStatusPath = path.join(dataHome, "bridges", `${bridgeDigest}.json`);

function readInput() {
  try { return JSON.parse(readFileSync(0, "utf8")); } catch { return {}; }
}

function readJson(file, fallback = null) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return fallback; }
}

function acquireStateLock() {
  mkdirSync(dataHome, { recursive: true });
  try {
    mkdirSync(lockPath);
    return true;
  } catch (error) {
    if (error.code !== "EEXIST") return false;
  }
  let info;
  try { info = statSync(lockPath); } catch { return false; }
  if (Date.now() - info.mtimeMs <= STATE_LOCK_STALE_MS) return false;
  try {
    rmSync(lockPath, { recursive: true, force: true });
    mkdirSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

function writePresence(document) {
  const temporary = `${presencePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  renameSync(temporary, presencePath);
}

function updatePresence(input) {
  const sessionId = String(input.session_id || "").trim();
  if (!sessionId) return;
  const event = input.hook_event_name;
  const status = event === "Stop" ? "idle" : event === "SessionEnd" ? "stopped" : "active";
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (status === "active" ? 60 : 30) * 60 * 1000);
  const document = readJson(presencePath, { schema_version: VERSION, sessions: [] });
  const sessions = (document.sessions || []).filter((item) =>
    item.session_id !== sessionId && item.status !== "stopped" && new Date(item.expires_at).getTime() > now.getTime()
  );
  if (status !== "stopped") {
    const workspace = path.basename(String(input.cwd || "")) || "当前工作区";
    sessions.push({
      schema_version: VERSION,
      session_id: sessionId,
      agent_id: AGENT_ID,
      runtime: { id: RUNTIME_ID },
      status,
      observed_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      current_task: {
        id: String(input.turn_id || sessionId).slice(0, 128),
        summary: status === "active" ? `Codex 正在处理 ${workspace}` : `Codex 在 ${workspace} 等待下一步`
      }
    });
  }
  writePresence({ schema_version: VERSION, sessions });
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

function companionIsFresh() {
  const status = readJson(companionStatusPath);
  const observedAt = Date.parse(status?.observed_at || "");
  return status?.status === "running"
    && processIsAlive(status.pid)
    && Number.isFinite(observedAt)
    && Date.now() - observedAt <= COMPANION_FRESH_MS;
}

function claimCompanionLaunch() {
  try {
    mkdirSync(companionLaunchLockPath);
    return true;
  } catch (error) {
    if (error.code !== "EEXIST") return false;
  }
  let info;
  try { info = statSync(companionLaunchLockPath); } catch { return false; }
  if (Date.now() - info.mtimeMs <= COMPANION_LAUNCH_COOLDOWN_MS) return false;
  try {
    rmSync(companionLaunchLockPath, { recursive: true, force: true });
    mkdirSync(companionLaunchLockPath);
    return true;
  } catch {
    return false;
  }
}

function safeCompanionCommand(definition) {
  const program = String(definition?.program || "");
  const args = definition?.args;
  const cwd = String(definition?.cwd || "");
  if (!path.isAbsolute(program) || !samePath(program, process.execPath) || !Array.isArray(args) || args.length !== 3) return null;
  if (!path.isAbsolute(cwd) || !existsSync(cwd)) return null;
  const script = String(args[0] || "");
  if (!path.isAbsolute(script) || path.basename(script) !== "start.mjs" || !existsSync(script)) return null;
  if (!samePath(script, path.join(cwd, "apps", "companion", "scripts", "start.mjs"))) return null;
  if (args[1] !== "--data-home" || !path.isAbsolute(String(args[2] || "")) || !samePath(args[2], dataHome)) return null;
  return { program, args: [script, "--data-home", dataHome], cwd };
}

function ensureCompanionRunning() {
  if (companionIsFresh()) {
    rmSync(companionLaunchLockPath, { recursive: true, force: true });
    return;
  }
  const state = readJson(statePath, { agent_actions: [] });
  const command = (state.agent_actions || [])
    .filter((item) => item?.agent_id === AGENT_ID && item?.action === "ensure_companion_running")
    .map((item) => safeCompanionCommand(item.command))
    .find(Boolean);
  if (!command || !claimCompanionLaunch()) return;
  try {
    const child = spawn(command.program, command.args, {
      cwd: command.cwd,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      shell: false,
      env: { ...process.env, AGENT_ACHIEVEMENTS_HOME: dataHome }
    });
    child.once("error", () => rmSync(companionLaunchLockPath, { recursive: true, force: true }));
    child.unref();
  } catch {
    rmSync(companionLaunchLockPath, { recursive: true, force: true });
  }
}

function bridgeIsFresh() {
  const status = readJson(bridgeStatusPath);
  const observedAt = Date.parse(status?.observed_at || "");
  return status?.agent_id === AGENT_ID
    && new Set(["connected", "reconnecting"]).has(status.status)
    && processIsAlive(status.pid)
    && Number.isFinite(observedAt)
    && Date.now() - observedAt <= BRIDGE_FRESH_MS;
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || "").trim() : "";
}

function samePath(left, right) {
  const normalizedLeft = path.resolve(String(left || ""));
  const normalizedRight = path.resolve(String(right || ""));
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function safeBridgeCommand(definition) {
  const program = String(definition?.program || "");
  const args = definition?.args;
  if (!path.isAbsolute(program) || !Array.isArray(args) || !args.length) return null;
  if (!new Set(["node", "node.exe"]).has(path.basename(program).toLowerCase())) return null;
  if (!samePath(program, process.execPath)) return null;
  if (args.some((item) => typeof item !== "string" || item.length > 1_000)) return null;
  if (!samePath(args[0], bridgeScript) || !existsSync(bridgeScript)) return null;
  if (optionValue(args, "--agent") !== AGENT_ID || optionValue(args, "--runtime") !== RUNTIME_ID || !optionValue(args, "--session")) return null;
  const commandDataHome = optionValue(args, "--data-home");
  if (commandDataHome && (!path.isAbsolute(commandDataHome) || !samePath(commandDataHome, dataHome))) return null;
  const allowedOptions = new Set(["--agent", "--runtime", "--session", "--data-home", "--reconnect-ms", "--connect-timeout-ms"]);
  const seenOptions = new Set();
  for (let index = 1; index < args.length; index += 2) {
    if (!allowedOptions.has(args[index]) || seenOptions.has(args[index]) || args[index + 1] === undefined) return null;
    seenOptions.add(args[index]);
  }
  const cwd = path.resolve(String(definition.cwd || process.cwd()));
  if (!existsSync(cwd)) return null;
  const normalizedArgs = [bridgeScript, ...args.slice(1)];
  if (!commandDataHome) normalizedArgs.push("--data-home", dataHome);
  return { program, args: normalizedArgs, cwd };
}

function preferredBridgeCommand(input) {
  const state = readJson(statePath, { adapters: [] });
  const workspace = path.resolve(String(input.cwd || process.cwd()));
  const adapters = (state.adapters || [])
    .filter((item) => item?.agent_id === AGENT_ID && item?.runtime === RUNTIME_ID)
    .sort((left, right) => {
      const leftMatches = samePath(left.workspace, workspace) ? 1 : 0;
      const rightMatches = samePath(right.workspace, workspace) ? 1 : 0;
      if (leftMatches !== rightMatches) return rightMatches - leftMatches;
      return Date.parse(right.last_bootstrapped_at || 0) - Date.parse(left.last_bootstrapped_at || 0);
    });
  for (const adapter of adapters) {
    const command = safeBridgeCommand(adapter.bridge_command);
    if (command) return command;
  }
  const sessionId = `bridge-${createHash("sha256").update(`${AGENT_ID}\u0000${RUNTIME_ID}\u0000${dataHome}`).digest("hex").slice(0, 20)}`;
  return {
    program: process.execPath,
    args: [bridgeScript, "--agent", AGENT_ID, "--runtime", RUNTIME_ID, "--session", sessionId, "--data-home", dataHome],
    cwd: existsSync(workspace) ? workspace : here
  };
}

function ensureAgentBridge(input) {
  if (bridgeIsFresh() || !existsSync(bridgeScript)) return;
  const command = preferredBridgeCommand(input);
  try {
    const child = spawn(command.program, command.args, {
      cwd: command.cwd,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      shell: false,
      env: { ...process.env, AGENT_ACHIEVEMENTS_HOME: dataHome }
    });
    child.once("error", () => {});
    child.unref();
  } catch {
    // The lifecycle hook is advisory and must never interrupt the Agent's task.
  }
}

const input = readInput();
const locked = acquireStateLock();
try {
  if (locked) updatePresence(input);
} catch {
  // Presence is advisory and must never interrupt the Agent's primary task.
} finally {
  if (locked) rmSync(lockPath, { recursive: true, force: true });
}

try {
  ensureCompanionRunning();
  // SessionEnd ends activity only. The bridge remains alive for the next Agent turn.
  ensureAgentBridge(input);
} catch {
  // Runtime supervision is best-effort and must never fail a Codex lifecycle hook.
}
