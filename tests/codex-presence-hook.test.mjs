import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const hook = path.resolve("skills/use-agent-achievements/scripts/codex-presence-hook.mjs");

async function runHook(home, hookEventName) {
  const result = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ session_id: "thr_test", turn_id: "turn_test", cwd: process.cwd(), hook_event_name: hookEventName }),
    encoding: "utf8",
    env: { ...process.env, AGENT_ACHIEVEMENTS_HOME: home }
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(await readFile(path.join(home, "presence.json"), "utf8"));
}

test("Codex lifecycle hooks drive active, idle, and stopped presence", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "agent-achievements-presence-"));
  const active = await runHook(home, "UserPromptSubmit");
  assert.equal(active.sessions[0].status, "active");
  const idle = await runHook(home, "Stop");
  assert.equal(idle.sessions[0].status, "idle");
  const stopped = await runHook(home, "SessionEnd");
  assert.deepEqual(stopped.sessions, []);
});
