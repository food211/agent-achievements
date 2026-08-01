#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const hookScript = path.join(here, "codex-presence-hook.mjs");
const codexHome = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
const hooksPath = path.join(codexHome, "hooks.json");
const events = ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop", "SessionEnd"];
const removing = process.argv.includes("--uninstall");
let document;
try { document = JSON.parse(await readFile(hooksPath, "utf8")); } catch { document = { description: "User lifecycle hooks.", hooks: {} }; }
document.hooks ||= {};

function isPresenceHook(handler) {
  return String(handler?.command || handler?.commandWindows || "").includes("codex-presence-hook.mjs");
}

const quotedScript = `"${hookScript.replaceAll('"', '\\"')}"`;
for (const event of events) {
  const groups = Array.isArray(document.hooks[event]) ? document.hooks[event] : [];
  const cleaned = groups.map((group) => ({
    ...group,
    hooks: (group.hooks || []).filter((handler) => !isPresenceHook(handler))
  })).filter((group) => group.hooks.length);
  if (!removing) {
    cleaned.push({ hooks: [{ type: "command", command: `node ${quotedScript}`, commandWindows: `node ${quotedScript}`, timeout: 3 }] });
  }
  if (cleaned.length) document.hooks[event] = cleaned;
  else delete document.hooks[event];
}

await mkdir(codexHome, { recursive: true });
await writeFile(hooksPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ schema_version: "agent-achievements/v1", ok: true, action: removing ? "uninstalled" : "installed", hooks_path: hooksPath, review_required: !removing }, null, 2)}\n`);
