import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const harnessCli = path.resolve("skills/wuxing-harness/scripts/harness-cli.mjs");
const achievementsCli = path.resolve("skills/use-agent-achievements/scripts/achievement-cli.mjs");

function run(cli, args, env) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("a verified Wuxing rule revision becomes a human-awarded achievement and returns to Agent context", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wuxing-achievement-loop-"));
  const workspace = path.join(root, "workspace");
  const harnessHome = path.join(root, "harness");
  const achievementsHome = path.join(root, "achievements");
  const env = { WUXING_HARNESS_HOME: harnessHome, AGENT_ACHIEVEMENTS_HOME: achievementsHome, AGENT_ACHIEVEMENTS_CLI: achievementsCli };

  run(harnessCli, ["init", "--workspace", workspace, "--agent", "codex-test"], env);
  const stateAfterInit = JSON.parse(await readFile(path.join(achievementsHome, "state.json"), "utf8"));
  assert.ok(stateAfterInit.achievements.some((item) => item.achievement_id === "wuxing-rule-gardener"));

  const fixture = JSON.parse(await readFile(path.resolve("examples/wuxing-harness/browser-rule.finding.json"), "utf8"));
  fixture.finding_id = "finding-loop-test";
  const findingFile = path.join(root, "finding.json");
  await writeFile(findingFile, JSON.stringify(fixture), "utf8");
  run(harnessCli, ["propose", "--workspace", workspace, "--input", findingFile, "--agent", "codex-test"], env);
  run(harnessCli, ["decide", "--workspace", workspace, "--finding", fixture.finding_id, "--decision", "approve", "--note", "同意修改"], env);

  const applicationFile = path.join(root, "application.json");
  await writeFile(applicationFile, JSON.stringify({
    path: fixture.rule.path,
    before: fixture.rule.text,
    after: fixture.proposal.replacement,
    validation: ["tests/browser-rule.test.ts"]
  }), "utf8");
  run(harnessCli, ["applied", "--workspace", workspace, "--finding", fixture.finding_id, "--input", applicationFile, "--agent", "codex-test"], env);

  const claims = run(achievementsCli, ["claim-list"], env).claims;
  assert.equal(claims.length, 1);
  assert.equal(claims[0].achievement_id, "wuxing-rule-gardener");
  assert.equal(claims[0].status, "pending_human_review");

  run(achievementsCli, ["review", "--claim", claims[0].claim_id, "--decision", "award", "--feedback", "这次修改让规则重新符合真实工作。"], env);
  const finalState = JSON.parse(await readFile(path.join(achievementsHome, "state.json"), "utf8"));
  assert.equal(finalState.awards.length, 1);
  assert.equal(finalState.awards[0].awarded_by, "human");
  assert.equal(finalState.awards[0].points, 30);

  const context = spawnSync(process.execPath, [achievementsCli, "context", "--agent", "codex-test", "--task-id", "next-task", "--task-type", "coding", "--summary", "继续工作", "--risk", "low", "--format", "markdown"], { encoding: "utf8", env: { ...process.env, ...env } });
  assert.equal(context.status, 0, context.stderr);
  assert.match(context.stdout, /规则园丁/);
  assert.match(context.stdout, /这次修改让规则重新符合真实工作/);
});
