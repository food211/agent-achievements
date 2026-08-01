#!/usr/bin/env node

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const VERSION = "agent-achievements/v1";
const dataHome = path.resolve(process.env.AGENT_ACHIEVEMENTS_HOME || path.join(os.homedir(), ".agent-achievements"));
const presencePath = path.join(dataHome, "presence.json");
const lockPath = path.join(dataHome, ".presence-lock");

function readInput() {
  try { return JSON.parse(readFileSync(0, "utf8")); } catch { return {}; }
}

function acquireLock() {
  mkdirSync(dataHome, { recursive: true });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { mkdirSync(lockPath); return true; } catch (error) {
      if (error.code !== "EEXIST") return false;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
    }
  }
  return false;
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
  let document;
  try { document = JSON.parse(readFileSync(presencePath, "utf8")); } catch { document = { schema_version: VERSION, sessions: [] }; }
  const sessions = (document.sessions || []).filter((item) =>
    item.session_id !== sessionId && item.status !== "stopped" && new Date(item.expires_at).getTime() > now.getTime()
  );
  if (status !== "stopped") {
    const workspace = path.basename(String(input.cwd || "")) || "当前工作区";
    sessions.push({
      schema_version: VERSION,
      session_id: sessionId,
      agent_id: "codex-local",
      runtime: { id: "codex" },
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

const locked = acquireLock();
try {
  if (locked) updatePresence(readInput());
} catch {
  // Presence is advisory and must never interrupt the Agent's primary task.
} finally {
  if (locked) rmSync(lockPath, { recursive: true, force: true });
}
