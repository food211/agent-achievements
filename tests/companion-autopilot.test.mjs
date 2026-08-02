import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  agentBlockedAchievementIds,
  alignAutopilotTracking,
  buildAgentConnectionContext,
  buildAutopilotView,
  calculateAgentScore,
  ensureDefaultWuxingChallenges,
  reviewPendingClaim,
  scoreLevel,
  setAgentAchievementBlocked,
  settleTrustedAutomaticClaims
} = require("../apps/companion/src/achievement-factory.cjs");

function emptyState() {
  return {
    schema_version: "agent-achievements/v1",
    achievements: [],
    progress: {},
    progress_records: [],
    tracked: [],
    tracking_records: [],
    tracking_preferences: [],
    awards: []
  };
}

function claim(overrides = {}) {
  return {
    schema_version: "agent-achievements/v1",
    claim_id: "claim-a-001",
    achievement_id: "wuxing-product-gatekeeper",
    agent_id: "agent-a",
    task_ids: ["task-a"],
    summary: "在高影响数据同步策略缺失时挂起该分支，并给出方案和影响。",
    evidence: [{ type: "decision_record", ref: "decision:sync-policy", summary: "用户确认了判断边界。" }],
    status: "pending_human_review",
    ...overrides
  };
}

test("bootstrap prepares default Wuxing challenges and tracks them per Agent", () => {
  const state = ensureDefaultWuxingChallenges(emptyState()).state;
  assert.deepEqual(state.achievements.map((item) => item.achievement_id), [
    "wuxing-product-gatekeeper",
    "wuxing-rule-gardener",
    "wuxing-loop-keeper"
  ]);
  alignAutopilotTracking(state, { agentId: "agent-a" });
  alignAutopilotTracking(state, { agentId: "agent-b" });
  assert.deepEqual(state.tracking_records, [
    { agent_id: "agent-a", achievement_ids: ["wuxing-product-gatekeeper"] },
    { agent_id: "agent-b", achievement_ids: ["wuxing-product-gatekeeper"] }
  ]);
});

test("score, progress, challenge and completed work stay scoped to the active Agent", () => {
  const state = ensureDefaultWuxingChallenges(emptyState()).state;
  state.progress_records.push(
    { achievement_id: "wuxing-product-gatekeeper", agent_id: "agent-a", current: 3 },
    { achievement_id: "wuxing-product-gatekeeper", agent_id: "agent-b", current: 1 }
  );
  state.awards.push({ achievement_id: "wuxing-product-gatekeeper", agent_id: "agent-a" });
  const events = [
    { event_type: "task.completed", occurred_at: "2026-08-02T01:00:00.000Z", actor: { agent_id: "agent-a" }, task: { id: "a", type: "coding" }, outcome: { status: "completed", summary: "A 完成" }, evidence: [] },
    { event_type: "task.completed", occurred_at: "2026-08-02T02:00:00.000Z", actor: { agent_id: "agent-b" }, task: { id: "b", type: "coding" }, outcome: { status: "completed", summary: "B 完成" }, evidence: [] }
  ];
  const agentA = buildAutopilotView(state, events, { agentId: "agent-a" });
  const agentB = buildAutopilotView(state, events, { agentId: "agent-b" });
  assert.equal(calculateAgentScore(state.achievements, state.awards, "agent-a"), 10);
  assert.equal(calculateAgentScore(state.achievements, state.awards, "agent-b"), 0);
  assert.equal(agentA.current_challenge.id, "wuxing-rule-gardener");
  assert.equal(agentB.current_challenge.id, "wuxing-product-gatekeeper");
  assert.equal(agentB.current_challenge.current, 1);
  assert.deepEqual(agentA.completed_tasks.map((item) => item.task_id), ["a"]);
  assert.deepEqual(agentB.completed_tasks.map((item) => item.task_id), ["b"]);
});

test("Agent behavior context only includes explicitly tracked, unblocked achievements", () => {
  const state = ensureDefaultWuxingChallenges(emptyState()).state;
  state.tracked = ["wuxing-product-gatekeeper"];
  assert.equal(buildAutopilotView(state, [], { agentId: "agent-a" }).current_challenge.id, "wuxing-product-gatekeeper");
  const untrackedContext = buildAgentConnectionContext(state, [], "agent-a");
  assert.equal("active_challenge" in untrackedContext, false);
  assert.deepEqual(untrackedContext.tracked, []);

  alignAutopilotTracking(state, { agentId: "agent-a" });
  assert.equal(buildAgentConnectionContext(state, [], "agent-a").active_challenge.achievement_id, "wuxing-product-gatekeeper");
  setAgentAchievementBlocked(state, "agent-a", "wuxing-product-gatekeeper", true);
  const blockedContext = buildAgentConnectionContext(state, [], "agent-a");
  assert.equal("active_challenge" in blockedContext, false);
  assert.equal("next_challenge" in blockedContext, false);
  assert.deepEqual(blockedContext.tracked, []);
  assert.equal(buildAutopilotView(state, [], { agentId: "agent-a" }).current_challenge.id, "wuxing-rule-gardener");
});

test("blocked automatic challenges are isolated per Agent during preparation and rotation", () => {
  const state = ensureDefaultWuxingChallenges(emptyState()).state;
  alignAutopilotTracking(state, { agentId: "agent-a" });
  alignAutopilotTracking(state, { agentId: "agent-b" });
  setAgentAchievementBlocked(state, "agent-a", "wuxing-product-gatekeeper", true);
  alignAutopilotTracking(state, { agentId: "agent-a" });
  alignAutopilotTracking(state, { agentId: "agent-b" });

  assert.deepEqual(agentBlockedAchievementIds(state, "agent-a"), ["wuxing-product-gatekeeper"]);
  assert.deepEqual(agentBlockedAchievementIds(state, "agent-b"), []);
  assert.deepEqual(state.tracking_records, [
    { agent_id: "agent-a", achievement_ids: ["wuxing-rule-gardener"] },
    { agent_id: "agent-b", achievement_ids: ["wuxing-product-gatekeeper"] }
  ]);
  assert.equal(buildAgentConnectionContext(state, [], "agent-a").active_challenge.achievement_id, "wuxing-rule-gardener");
  assert.equal(buildAgentConnectionContext(state, [], "agent-b").active_challenge.achievement_id, "wuxing-product-gatekeeper");
});

test("score levels use the canonical 30 and 100 point boundaries", () => {
  assert.deepEqual(scoreLevel(0), {
    id: "observe",
    label: "见微",
    preferred_tier: "bronze",
    next_score: 30,
    description: "先从低风险、结果清楚的小闭环开始积累。"
  });
  assert.equal(scoreLevel(29).id, "observe");
  assert.deepEqual(scoreLevel(30), {
    id: "momentum",
    label: "成势",
    preferred_tier: "silver",
    next_score: 100,
    description: "推荐需要连续判断与验证的挑战，但不会增加 Agent 的权限。"
  });
  assert.equal(scoreLevel(99).id, "momentum");
  assert.deepEqual(scoreLevel(100), {
    id: "balance",
    label: "守衡",
    preferred_tier: "gold",
    next_score: null,
    description: "更适合跨任务的完整闭环；验证与人的判断仍然保持原标准。"
  });
});

test("trusted automatic awards require an autopilot bronze or silver, target progress and direct evidence", () => {
  const state = ensureDefaultWuxingChallenges(emptyState()).state;
  state.progress_records.push({ achievement_id: "wuxing-product-gatekeeper", agent_id: "agent-a", current: 3 });
  const weakClaim = claim({ claim_id: "claim-weak", evidence: [{ type: "external", ref: "some-text" }] });
  const strongClaim = claim({ claim_id: "claim-strong" });
  const result = settleTrustedAutomaticClaims(state, [weakClaim, strongClaim], { now: new Date("2026-08-02T00:00:00.000Z") });
  assert.equal(weakClaim.status, "pending_human_review");
  assert.equal(strongClaim.status, "awarded");
  assert.equal(result.awarded.length, 1);
  assert.equal(result.awarded[0].agent_id, "agent-a");
  assert.equal(result.awarded[0].awarded_by, "system");
});

test("rule revision auto-awards need both a decision record and verification evidence", () => {
  const state = ensureDefaultWuxingChallenges(emptyState()).state;
  state.progress_records.push({ achievement_id: "wuxing-rule-gardener", agent_id: "agent-a", current: 1 });
  const decisionOnly = claim({ claim_id: "claim-rule-weak", achievement_id: "wuxing-rule-gardener" });
  const verified = claim({
    claim_id: "claim-rule-strong",
    achievement_id: "wuxing-rule-gardener",
    evidence: [
      { type: "decision_record", ref: "decision:rule-change" },
      { type: "test", ref: "test:rule-suite" }
    ]
  });
  settleTrustedAutomaticClaims(state, [decisionOnly, verified]);
  assert.equal(decisionOnly.status, "pending_human_review");
  assert.equal(verified.status, "awarded");
});

test("human review cannot award before the target and preserves specific feedback", () => {
  const state = ensureDefaultWuxingChallenges(emptyState()).state;
  state.progress_records.push({ achievement_id: "wuxing-loop-keeper", agent_id: "agent-a", current: 2 });
  const pending = claim({ claim_id: "claim-gold", achievement_id: "wuxing-loop-keeper" });
  assert.throws(() => reviewPendingClaim(state, [pending], pending.claim_id, "award", "做得很好"), /achievement-not-earned/);
  state.progress_records[0].current = 3;
  const reviewed = reviewPendingClaim(state, [pending], pending.claim_id, "award", "三次规则修订都先经过判断并完成验证。", { now: new Date("2026-08-02T00:00:00.000Z") });
  assert.equal(reviewed.award.awarded_by, "human");
  assert.equal(reviewed.award.human_feedback, "三次规则修订都先经过判断并完成验证。");
});

test("the desktop companion publishes a vendor-neutral liveness heartbeat", async () => {
  const source = await readFile(new URL("../apps/companion/src/main.cjs", import.meta.url), "utf8");
  const policySource = await readFile(new URL("../apps/companion/src/achievement-factory.cjs", import.meta.url), "utf8");
  assert.match(source, /companion-status\.json/);
  assert.match(source, /writeCompanionStatus\("running"\)/);
  assert.match(source, /writeCompanionStatus\("stopped", true\)/);
  assert.match(source, /status,\s*observed_at:[\s\S]*pid: process\.pid/);
  assert.match(source, /safeBridgeCommand/);
  assert.match(source, /bridgeStatusIsFresh/);
  assert.match(source, /windowsHide: true,[\s\S]*shell: false/);
  assert.match(policySource, /tracking_preferences/);
  assert.match(source, /AGENT_ACHIEVEMENTS_HOME: DATA_HOME/);
});

test("the companion start script validates a custom data home without launching Electron", async (t) => {
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "companion-start-check-"));
  t.after(() => rm(dataHome, { recursive: true, force: true }));
  const startScript = fileURLToPath(new URL("../apps/companion/scripts/start.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [startScript, "--check", "--data-home", dataHome], {
    encoding: "utf8",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    shell: false,
    windowsHide: true
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout.trim());
  assert.equal(report.ok, true);
  assert.equal(report.data_home, path.resolve(dataHome));
  assert.equal(path.isAbsolute(report.electron), true);
  assert.deepEqual(report.forwarded_args, []);
});

test("long-connection context uses the canonical Agent motivation and challenge shape", () => {
  const state = ensureDefaultWuxingChallenges(emptyState()).state;
  alignAutopilotTracking(state, { agentId: "agent-a" });
  state.agent_actions = [
    { action_id: "action-a", agent_id: "agent-a", action: "run_wuxing_diagnostic", status: "pending", reason: "first_install", instructions: "回顾已有结果", guardrails: ["不阻塞当前任务"] },
    {
      action_id: "action-bridge",
      agent_id: "agent-a",
      action: "ensure_agent_bridge",
      status: "pending",
      reason: "first_install",
      instructions: "保持本机连接",
      guardrails: ["连接状态不能作为成就证据"],
      bridge_command: { program: process.execPath, args: ["agent-bridge.mjs", "--agent", "agent-a"], cwd: process.cwd() },
      detection: { type: "file_freshness", path: "bridge.json", expected_status: "connected", max_age_seconds: 15 }
    }
  ];
  const context = buildAgentConnectionContext(state, [], "agent-a");
  assert.equal(context.schema_version, "agent-achievements/v1");
  assert.equal(context.motivation.level, "starter");
  assert.equal(context.motivation.recommended_challenge_tier, "bronze");
  assert.equal(context.motivation.score_effect, "challenge_difficulty_and_encouragement_only");
  assert.equal(context.active_challenge.achievement_id, "wuxing-product-gatekeeper");
  assert.deepEqual(context.active_challenge.progress, { current: 0, target: 3, unit: "qualified_tasks" });
  assert.equal(context.agent_actions[0].action_id, "action-a");
  assert.deepEqual(context.agent_actions[1].bridge_command, state.agent_actions[1].bridge_command);
  assert.deepEqual(context.operating_priority, ["current_user_instruction", "safety_and_project_rules", "task_correctness", "tracked_achievements"]);
});
