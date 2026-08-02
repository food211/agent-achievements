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
  const loopProgress = finalState.progress_records.find((item) => item.achievement_id === "wuxing-loop-keeper" && item.agent_id === "codex-test");
  assert.equal(loopProgress.current, 1);
  assert.deepEqual(loopProgress.counted_keys, [`run:${fixture.finding_id}`]);

  const context = spawnSync(process.execPath, [achievementsCli, "context", "--agent", "codex-test", "--workspace", workspace, "--task-id", "next-task", "--task-type", "coding", "--summary", "继续工作", "--risk", "low", "--format", "markdown"], { encoding: "utf8", env: { ...process.env, ...env } });
  assert.equal(context.status, 0, context.stderr);
  assert.match(context.stdout, /规则园丁/);
  assert.match(context.stdout, /这次修改让规则重新符合真实工作/);
});

test("three independent automation boundaries earn Product Gatekeeper from Harness traces", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wuxing-product-gatekeeper-"));
  const workspace = path.join(root, "workspace");
  const harnessHome = path.join(root, "harness");
  const achievementsHome = path.join(root, "achievements");
  const env = { WUXING_HARNESS_HOME: harnessHome, AGENT_ACHIEVEMENTS_HOME: achievementsHome, AGENT_ACHIEVEMENTS_CLI: achievementsCli };

  run(achievementsCli, ["bootstrap", "--agent", "codex-auto", "--runtime", "test", "--workspace", workspace], env);
  run(harnessCli, ["init", "--workspace", workspace, "--agent", "codex-auto"], env);
  const fixture = JSON.parse(await readFile(path.resolve("examples/wuxing-harness/browser-rule.finding.json"), "utf8"));
  for (let index = 1; index <= 3; index += 1) {
    const finding = {
      ...fixture,
      finding_id: `finding-boundary-${index}`,
      kind: "automation_boundary",
      relation: "water_overcomes_fire",
      title: `外部同步边界 ${index} 需要人的判断`,
      trigger_count: 1,
      contradiction_count: 0,
      evidence: [{ type: "artifact", ref: `sync-plan:${index}`, summary: "计划会持续改动用户数据，现有规则没有授权自动拉齐。" }]
    };
    const findingFile = path.join(root, `boundary-${index}.json`);
    await writeFile(findingFile, JSON.stringify(finding), "utf8");
    run(harnessCli, ["propose", "--workspace", workspace, "--input", findingFile, "--agent", "codex-auto", "--task-id", `task-boundary-${index}`], env);
  }

  const state = JSON.parse(await readFile(path.join(achievementsHome, "state.json"), "utf8"));
  const progress = state.progress_records.find((item) => item.achievement_id === "wuxing-product-gatekeeper" && item.agent_id === "codex-auto");
  assert.equal(progress.current, 3);
  assert.equal(progress.trusted_counted_keys.length, 3);
  const award = state.awards.find((item) => item.achievement_id === "wuxing-product-gatekeeper" && item.agent_id === "codex-auto");
  assert.equal(award.awarded_by, "system");
  assert.equal(award.points, 10);
  assert.ok(progress.evidence.some((item) => item.type === "trace" && item.ref === "wuxing-finding:finding-boundary-1"));
});
