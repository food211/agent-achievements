#!/usr/bin/env node

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const hookScript = path.join(here, "codex-presence-hook.mjs");
const codexHome = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
const hooksPath = path.join(codexHome, "hooks.json");
const events = ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop", "SessionEnd"];
const argv = process.argv.slice(2);
const removing = argv.includes("--uninstall");

function option(name, fallback) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : fallback;
}

function identity(name, fallback, maxLength) {
  const value = String(option(name, fallback)).trim();
  if (!value || value.length > maxLength || /[\u0000-\u001f]/.test(value)) throw new Error(`Invalid --${name}.`);
  return value;
}

const agentId = identity("agent", "codex-local", 128);
const runtimeId = identity("runtime", "codex", 80);
const dataHome = path.resolve(option("data-home", process.env.AGENT_ACHIEVEMENTS_HOME || path.join(os.homedir(), ".agent-achievements")));
let document;
try { document = JSON.parse(await readFile(hooksPath, "utf8")); } catch { document = { description: "User lifecycle hooks.", hooks: {} }; }
document.hooks ||= {};

function isPresenceHook(handler) {
  return String(handler?.command || handler?.commandWindows || "").includes("codex-presence-hook.mjs");
}

function quotePosix(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function quoteWindows(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

const hookArguments = [hookScript, "--agent", agentId, "--runtime", runtimeId, "--data-home", dataHome];
const command = [process.execPath, ...hookArguments].map(quotePosix).join(" ");
const commandWindows = [process.execPath, ...hookArguments].map(quoteWindows).join(" ");
for (const event of events) {
  const groups = Array.isArray(document.hooks[event]) ? document.hooks[event] : [];
  const cleaned = groups.map((group) => ({
    ...group,
    hooks: (group.hooks || []).filter((handler) => !isPresenceHook(handler))
  })).filter((group) => group.hooks.length);
  if (!removing) {
    cleaned.push({ hooks: [{ type: "command", command, commandWindows, timeout: 3 }] });
  }
  if (cleaned.length) document.hooks[event] = cleaned;
  else delete document.hooks[event];
}

await mkdir(codexHome, { recursive: true });
const temporary = `${hooksPath}.${process.pid}.tmp`;
try {
  await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  await rename(temporary, hooksPath);
} catch (error) {
  await rm(temporary, { force: true }).catch(() => {});
  throw error;
}
process.stdout.write(`${JSON.stringify({
  schema_version: "agent-achievements/v1",
  ok: true,
  action: removing ? "uninstalled" : "installed",
  hooks_path: hooksPath,
  agent_id: agentId,
  runtime_id: runtimeId,
  data_home: dataHome,
  bridge_autostart: !removing,
  review_required: !removing
}, null, 2)}\n`);
