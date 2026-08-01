import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const cli = path.resolve("skills/use-agent-achievements/scripts/achievement-cli.mjs");

function run(home, args) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { ...process.env, AGENT_ACHIEVEMENTS_HOME: home } });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("a human request can receive an Agent-designed achievement proposal", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "agent-achievements-design-"));
  run(home, ["init"]);
  const requested = run(home, ["design-request", "--brief", "鼓励 Agent 在关键判断前收集证据"]);
  assert.equal(run(home, ["design-list"]).requests.length, 1);
  const proposalPath = path.join(home, "proposal.json");
  await writeFile(proposalPath, JSON.stringify({
    schema_version: "agent-achievements/v1",
    request_id: requested.data.request_id,
    agent_id: "codex-test",
    proposed_at: "2026-08-01T00:00:00.000Z",
    achievement: {
      title: "证据工匠", intent: "先收集证据再判断。", tier: "silver",
      event_type: "evidence.collected", target: 3,
      encouragement: "用证据降低猜测。", guardrails: ["不得扩大任务范围"]
    }
  }), "utf8");
  run(home, ["design-submit", "--input", proposalPath]);
  const document = JSON.parse(await readFile(path.join(home, "achievement-design-requests.json"), "utf8"));
  assert.equal(document.requests[0].status, "proposed");
  assert.equal(document.requests[0].proposal.achievement.tier, "silver");
});
