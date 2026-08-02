import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const cli = path.resolve("skills/use-agent-achievements/scripts/achievement-cli.mjs");
const version = "agent-achievements/v1";

function run(home, args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { ...process.env, AGENT_ACHIEVEMENTS_HOME: home } });
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
  return JSON.parse(expectedStatus === 0 ? result.stdout : result.stderr);
}

async function input(home, name, value) {
  const file = path.join(home, name);
  await writeFile(file, JSON.stringify(value), "utf8");
  return file;
}

function event(overrides = {}) {
  return {
    schema_version: version,
    event_id: "evt:test:001",
    event_type: "rule.revised",
    occurred_at: "2026-08-02T00:00:00.000Z",
    source: { system: "wuxing-harness", version: "0.1.0" },
    actor: { agent_id: "agent-a" },
    task: { id: "task-a", type: "rule-maintenance" },
    run: { id: "run-a" },
    outcome: { status: "completed", summary: "规则经人确认后完成修订并通过验证。" },
    evidence: [
      { type: "decision_record", ref: "decision:a" },
      { type: "test", ref: "test:a" }
    ],
    ...overrides
  };
}

async function validator(schemaName) {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const schema = JSON.parse(await readFile(path.resolve("packages/protocol/schemas", schemaName), "utf8"));
  return ajv.compile(schema);
}

test("bootstrap is idempotent, schema-valid, and keeps setup actions and tracking per Agent", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "achievement-bootstrap-"));
  const invalidRuntime = run(home, ["bootstrap", "--agent", "agent-a", "--runtime", "r".repeat(81), "--workspace", process.cwd()], 1);
  assert.equal(invalidRuntime.error.code, "RUNTIME_ID_INVALID");
  assert.equal(invalidRuntime.error.field, "runtime");
  const first = run(home, ["bootstrap", "--agent", "agent-a", "--runtime", "test", "--workspace", process.cwd(), "--capability", "skills", "--capability", "hooks"]);
  const validate = await validator("bootstrap-response.schema.json");
  assert.equal(validate(first), true, JSON.stringify(validate.errors, null, 2));
  assert.deepEqual(first.agent_next_actions.map((item) => item.action), ["ensure_companion_running", "ensure_agent_bridge", "run_wuxing_diagnostic", "diagnose_past_achievements"]);
  const companionAction = first.agent_next_actions.find((item) => item.action === "ensure_companion_running");
  assert.equal(companionAction.command.program, process.execPath);
  assert.match(companionAction.command.args[0], /apps[\\/]companion[\\/]scripts[\\/]start\.mjs$/);
  assert.deepEqual(companionAction.command.args.slice(1), ["--data-home", home]);
  assert.equal(companionAction.detection.require_live_pid, true);
  assert.ok(await readFile(companionAction.command.args[0], "utf8"));
  const bridgeAction = first.agent_next_actions.find((item) => item.action === "ensure_agent_bridge");
  assert.match(bridgeAction.bridge_command.args[0], /agent-bridge\.mjs$/);
  assert.deepEqual(bridgeAction.bridge_command.args.slice(-2), ["--data-home", home]);
  assert.equal(bridgeAction.detection.expected_status, "connected");
  assert.equal(bridgeAction.detection.require_live_pid, true);
  assert.deepEqual(first.data.tracked_achievements, ["wuxing-product-gatekeeper", "wuxing-rule-gardener", "wuxing-loop-keeper"]);

  const second = run(home, ["bootstrap", "--agent", "agent-a", "--runtime", "test", "--workspace", process.cwd(), "--capability", "skills"]);
  assert.equal(second.data.adapter.created, false);
  assert.deepEqual(second.data.seeded_achievements, []);
  assert.equal(second.data.diagnostic_request_id, first.data.diagnostic_request_id);
  const state = JSON.parse(await readFile(path.join(home, "state.json"), "utf8"));
  assert.equal(state.agent_actions.length, 4);
  assert.equal(state.adapters.length, 1);
  assert.deepEqual(state.adapters[0].bridge_command, bridgeAction.bridge_command);
  assert.equal(state.tracking_records.length, 1);
  const diagnostics = JSON.parse(await readFile(path.join(home, "achievement-diagnostics.json"), "utf8"));
  assert.equal(diagnostics.requests.length, 1);
  assert.equal(diagnostics.requests[0].scope, "past_achievements");

  run(home, ["bootstrap", "--agent", "agent-b", "--runtime", "test", "--workspace", process.cwd()]);
  const nextState = JSON.parse(await readFile(path.join(home, "state.json"), "utf8"));
  assert.equal(nextState.tracking_records.length, 2);
  assert.notEqual(nextState.tracking_records[0], nextState.tracking_records[1]);
});

test("bootstrap does not mistake a fresh companion heartbeat from a dead PID for liveness", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "achievement-dead-companion-"));
  const first = run(home, ["bootstrap", "--agent", "agent-a", "--runtime", "test", "--workspace", process.cwd()]);
  const companionAction = first.agent_next_actions.find((item) => item.action === "ensure_companion_running");
  run(home, ["action-complete", "--action", companionAction.action_id, "--summary", "simulated startup"]);
  await writeFile(path.join(home, "companion-status.json"), JSON.stringify({
    schema_version: version,
    status: "running",
    observed_at: new Date().toISOString(),
    pid: 2_147_483_647
  }), "utf8");

  const recovered = run(home, ["bootstrap", "--agent", "agent-a", "--runtime", "test", "--workspace", process.cwd()]);
  const pending = recovered.agent_next_actions.find((item) => item.action === "ensure_companion_running");
  assert.ok(pending);
  assert.equal(pending.status, "pending");
  assert.equal(pending.detection.require_live_pid, true);
});

test("report isolates Agents, deduplicates units, auto-creates claims, and only auto-awards trusted bronze or silver evidence", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "achievement-report-"));
  run(home, ["bootstrap", "--agent", "agent-a", "--runtime", "test", "--workspace", process.cwd()]);
  run(home, ["bootstrap", "--agent", "agent-b", "--runtime", "test", "--workspace", process.cwd()]);

  const noEvidence = event({ event_id: "evt:no-evidence", evidence: [] });
  const noEvidenceResult = run(home, ["report", "--input", await input(home, "no-evidence.json", noEvidence)]);
  assert.ok(noEvidenceResult.data.progress_updates.every((item) => item.state === "not_qualified"));

  const first = event();
  const firstResult = run(home, ["report", "--input", await input(home, "first.json", first)]);
  assert.ok(firstResult.data.awards_created.some((item) => item.achievement_id === "wuxing-rule-gardener"));
  assert.ok(firstResult.data.claims_created.some((item) => item.status === "awarded"));
  const duplicate = run(home, ["report", "--input", await input(home, "first-again.json", first)]);
  assert.equal(duplicate.data.duplicate, true);

  const sameRun = event({ event_id: "evt:same-run", task: { id: "task-b", type: "rule-maintenance" } });
  const sameRunResult = run(home, ["report", "--input", await input(home, "same-run.json", sameRun)]);
  const loopSameRun = sameRunResult.data.progress_updates.find((item) => item.achievement_id === "wuxing-loop-keeper");
  assert.equal(loopSameRun.state, "already_counted");
  assert.equal(loopSameRun.current, 1);

  for (const [suffix, runId] of [["two", "run-b"], ["three", "run-c"]]) {
    const next = event({ event_id: `evt:${suffix}`, task: { id: `task-${suffix}`, type: "rule-maintenance" }, run: { id: runId } });
    run(home, ["report", "--input", await input(home, `${suffix}.json`, next)]);
  }
  const claims = run(home, ["claim-list", "--status", "all"]).claims;
  assert.equal(claims.filter((item) => item.achievement_id === "wuxing-rule-gardener").length, 1);
  assert.equal(claims.find((item) => item.achievement_id === "wuxing-loop-keeper").status, "pending_human_review");

  const state = JSON.parse(await readFile(path.join(home, "state.json"), "utf8"));
  assert.equal(state.awards.filter((item) => item.achievement_id === "wuxing-rule-gardener" && item.agent_id === "agent-a").length, 1);
  assert.equal(state.awards.some((item) => item.agent_id === "agent-b"), false);
  const agentB = run(home, ["context", "--agent", "agent-b", "--task-id", "b", "--task-type", "rule-audit", "--summary", "审查规则", "--risk", "local_reversible"]);
  assert.equal(agentB.motivation.total_points, 0);
  assert.ok(agentB.tracked.every((item) => item.progress.current === 0));
});

test("qualified_tasks, human_only, and weak automatic evidence honor their protocol boundaries", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "achievement-modes-"));
  run(home, ["bootstrap", "--agent", "agent-a", "--runtime", "test", "--workspace", process.cwd()]);
  const humanOnly = {
    schema_version: version,
    achievement_id: "human-only-review",
    title: "人的特别认可",
    intent: "只允许人在可信界面中授予。",
    origin: "human_created",
    tier: "gold",
    points: 100,
    mode: "human_only",
    condition: { event_types: ["task.completed"], target: 1, unit: "events" },
    evidence_required: true,
    tracking: { allowed: true, encouragement: "完成本来的任务即可。", guardrails: ["不得为了成就改变任务"] }
  };
  run(home, ["define", "--input", await input(home, "human-only.json", humanOnly)]);
  const completed = event({ event_id: "evt:human-only", event_type: "task.completed", task: { id: "task-human", type: "coding" }, evidence: [{ type: "test", ref: "test:human" }] });
  const result = run(home, ["report", "--input", await input(home, "human-event.json", completed)]);
  assert.equal(result.data.progress_updates.find((item) => item.achievement_id === "human-only-review").state, "awaiting_human_action");
  assert.equal(run(home, ["claim-list", "--status", "all"]).claims.some((item) => item.achievement_id === "human-only-review"), false);

  const weak = event({ event_id: "evt:weak", task: { id: "task-weak", type: "rule-maintenance" }, run: { id: "run-weak" }, evidence: [{ type: "external", ref: "external:assertion" }] });
  const weakResult = run(home, ["report", "--input", await input(home, "weak.json", weak)]);
  assert.equal(weakResult.data.awards_created.length, 0);
  const weakRuleProgress = weakResult.data.progress_updates.find((item) => item.achievement_id === "wuxing-rule-gardener");
  assert.equal(weakRuleProgress.state, "not_qualified");
  assert.equal(weakRuleProgress.current, 0);

  const verifiedAfterWeak = event({ event_id: "evt:verified-after-weak", task: { id: "task-verified", type: "rule-maintenance" }, run: { id: "run-verified" } });
  const verifiedResult = run(home, ["report", "--input", await input(home, "verified-after-weak.json", verifiedAfterWeak)]);
  assert.ok(verifiedResult.data.awards_created.some((item) => item.achievement_id === "wuxing-rule-gardener"));

  const judgmentOne = event({ event_id: "evt:judgment-1", event_type: "judgment.requested", task: { id: "same-task", type: "external-sync" }, outcome: { status: "parked", summary: "等待人的产品判断。" }, evidence: [{ type: "decision_record", ref: "decision:one" }] });
  const judgmentTwo = event({ ...judgmentOne, event_id: "evt:judgment-2", evidence: [{ type: "decision_record", ref: "decision:two" }] });
  run(home, ["report", "--input", await input(home, "judgment-1.json", judgmentOne)]);
  const deduped = run(home, ["report", "--input", await input(home, "judgment-2.json", judgmentTwo)]);
  const product = deduped.data.progress_updates.find((item) => item.achievement_id === "wuxing-product-gatekeeper");
  assert.equal(product.state, "already_counted");
  assert.equal(product.current, 1);
});

test("score only changes the challenge tie-breaker while operating priority remains authoritative", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "achievement-motivation-"));
  run(home, ["bootstrap", "--agent", "agent-a", "--runtime", "test", "--workspace", process.cwd()]);
  const taskArgs = ["context", "--agent", "agent-a", "--task-id", "mixed", "--task-type", "rule-external-sync", "--summary", "审查外部同步规则", "--risk", "external_system"];
  const before = run(home, taskArgs);
  assert.equal(before.active_challenge.achievement_id, "wuxing-product-gatekeeper");

  const scoreSeed = {
    schema_version: version,
    achievement_id: "score-seed",
    title: "可靠交付",
    intent: "完成经过验证的任务。",
    origin: "system_discovered",
    tier: "silver",
    points: 30,
    mode: "automatic",
    condition: { event_types: ["task.completed"], target: 1, unit: "events" },
    evidence_required: true,
    tracking: { allowed: false, encouragement: "", guardrails: ["不得降低验证"] },
    extensions: { source_skill: "wuxing-harness", autopilot_managed: true }
  };
  run(home, ["define", "--input", await input(home, "score-seed.json", scoreSeed)]);
  const completed = event({ event_id: "evt:score", event_type: "task.completed", task: { id: "score-task", type: "coding" }, evidence: [{ type: "test", ref: "test:score" }] });
  run(home, ["report", "--input", await input(home, "score-event.json", completed)]);

  const after = run(home, taskArgs);
  const validateContext = await validator("context-response.schema.json");
  assert.equal(validateContext(after), true, JSON.stringify(validateContext.errors, null, 2));
  const withNextChallenge = { ...after, next_challenge: { ...after.active_challenge, achievement_id: "wuxing-loop-keeper", title: "闭环调律师", tier: "gold", points: 100, progress: { current: 0, target: 3, unit: "distinct_runs" } } };
  assert.equal(validateContext(withNextChallenge), true, JSON.stringify(validateContext.errors, null, 2));
  assert.equal(after.motivation.total_points, 30);
  assert.equal(after.motivation.recommended_challenge_tier, "silver");
  assert.equal(after.active_challenge.achievement_id, "wuxing-rule-gardener");
  assert.equal(after.active_challenge.behavior_prompt, after.tracked.find((item) => item.achievement_id === "wuxing-rule-gardener").encouragement);
  assert.deepEqual(after.operating_priority, ["current_user_instruction", "safety_and_project_rules", "task_correctness", "tracked_achievements"]);
  assert.equal(after.motivation.score_effect, "challenge_difficulty_and_encouragement_only");
});

test("a malformed claim without an evidence array returns a protocol error", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "achievement-claim-validation-"));
  run(home, ["bootstrap", "--agent", "agent-a", "--runtime", "test", "--workspace", process.cwd()]);
  const malformed = {
    schema_version: version,
    claim_id: "claim:missing-evidence",
    achievement_id: "wuxing-rule-gardener",
    agent_id: "agent-a",
    task_ids: ["task-a"],
    summary: "缺少 evidence 数组。"
  };
  const result = run(home, ["claim", "--input", await input(home, "malformed-claim.json", malformed)], 1);
  assert.equal(result.error.code, "CLAIM_INVALID");
});

test("trusted automatic progress requires an exact trusted Wuxing source match", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "achievement-source-trust-"));
  run(home, ["bootstrap", "--agent", "agent-a", "--runtime", "test", "--workspace", process.cwd()]);

  const spoofedWuxing = event({
    event_id: "evt:spoofed-wuxing",
    source: { system: "untrusted-plugin", version: "1.0.0" }
  });
  const spoofedResult = run(home, ["report", "--input", await input(home, "spoofed-wuxing.json", spoofedWuxing)]);
  const managedProgress = spoofedResult.data.progress_updates.find((item) => item.achievement_id === "wuxing-rule-gardener");
  assert.equal(managedProgress.state, "not_qualified");
  assert.match(managedProgress.reason, /matching trusted source/);

  const pluginAchievement = {
    schema_version: version,
    achievement_id: "plugin-self-award",
    title: "插件自证",
    intent: "不可信插件的直接证据仍需人工复核。",
    origin: "system_discovered",
    tier: "bronze",
    points: 10,
    mode: "automatic",
    condition: { event_types: ["task.completed"], target: 1, unit: "events" },
    evidence_required: true,
    tracking: { allowed: true, encouragement: "完成任务本身。", guardrails: ["不得为了积分扩大任务"] },
    extensions: { source_skill: "untrusted-plugin", autopilot_managed: true }
  };
  run(home, ["define", "--input", await input(home, "plugin-achievement.json", pluginAchievement)]);
  const pluginEvent = event({
    event_id: "evt:plugin-direct",
    event_type: "task.completed",
    source: { system: "untrusted-plugin", version: "1.0.0" },
    task: { id: "plugin-task", type: "coding" },
    run: { id: "plugin-run" },
    evidence: [{ type: "test", ref: "test:plugin" }]
  });
  const pluginResult = run(home, ["report", "--input", await input(home, "plugin-event.json", pluginEvent)]);
  assert.equal(pluginResult.data.awards_created.length, 0);
  assert.equal(pluginResult.data.progress_updates.find((item) => item.achievement_id === "plugin-self-award").state, "claim_created");
  const state = JSON.parse(await readFile(path.join(home, "state.json"), "utf8"));
  const pluginProgress = state.progress_records.find((item) => item.achievement_id === "plugin-self-award");
  assert.equal(pluginProgress.trusted_counted_keys.length, 0);
  assert.equal(pluginProgress.trusted_units.length, 0);
});

test("a rejected review claim reopens after a new qualifying distinct run", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "achievement-reopen-"));
  run(home, ["bootstrap", "--agent", "agent-a", "--runtime", "test", "--workspace", process.cwd()]);
  for (let index = 1; index <= 3; index += 1) {
    const next = event({
      event_id: `evt:reopen-${index}`,
      task: { id: `task-reopen-${index}`, type: "rule-maintenance" },
      run: { id: `run-reopen-${index}` },
      evidence: [
        { type: "decision_record", ref: `decision:reopen-${index}` },
        { type: "test", ref: `test:reopen-${index}` }
      ]
    });
    run(home, ["report", "--input", await input(home, `reopen-${index}.json`, next)]);
  }
  const original = run(home, ["claim-list", "--status", "all"]).claims.find((item) => item.achievement_id === "wuxing-loop-keeper");
  assert.equal(original.status, "pending_human_review");
  run(home, ["review", "--claim", original.claim_id, "--decision", "reject", "--feedback", "还需要一次独立闭环来证明稳定性。"]);

  const fourth = event({
    event_id: "evt:reopen-4",
    task: { id: "task-reopen-4", type: "rule-maintenance" },
    run: { id: "run-reopen-4" },
    outcome: { status: "completed", summary: "第四次独立闭环提供了新的复核证据。" },
    evidence: [
      { type: "decision_record", ref: "decision:reopen-4" },
      { type: "test", ref: "test:reopen-4" }
    ]
  });
  const reopenedResult = run(home, ["report", "--input", await input(home, "reopen-4.json", fourth)]);
  assert.equal(reopenedResult.data.progress_updates.find((item) => item.achievement_id === "wuxing-loop-keeper").state, "claim_reopened");
  const reopened = run(home, ["claim-list", "--status", "all"]).claims.find((item) => item.claim_id === original.claim_id);
  assert.equal(reopened.status, "pending_human_review");
  assert.equal(reopened.reopen_count, 1);
  assert.equal(reopened.review_history.at(-1).human_feedback, "还需要一次独立闭环来证明稳定性。");
  assert.ok(reopened.task_ids.includes("task-reopen-4"));
  assert.ok(reopened.evidence.some((item) => item.ref === "test:reopen-4"));
  const state = JSON.parse(await readFile(path.join(home, "state.json"), "utf8"));
  const progress = state.progress_records.find((item) => item.achievement_id === "wuxing-loop-keeper" && item.agent_id === "agent-a");
  assert.equal(progress.current, 3);
  assert.ok(progress.counted_keys.includes("run:run-reopen-4"));
});

test("per-Agent tracking opt-out survives bootstrap and award rotation", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "achievement-tracking-optout-"));
  run(home, ["bootstrap", "--agent", "agent-a", "--runtime", "test", "--workspace", process.cwd()]);
  run(home, ["bootstrap", "--agent", "agent-b", "--runtime", "test", "--workspace", process.cwd()]);
  run(home, ["track", "--agent", "agent-a", "--achievement", "wuxing-rule-gardener", "--enabled", "false"]);
  const bootstrappedAgain = run(home, ["bootstrap", "--agent", "agent-a", "--runtime", "test", "--workspace", process.cwd()]);
  assert.equal(bootstrappedAgain.data.tracked_achievements.includes("wuxing-rule-gardener"), false);

  const awarded = event({ event_id: "evt:optout-award", task: { id: "task-optout", type: "rule-maintenance" }, run: { id: "run-optout" } });
  run(home, ["report", "--input", await input(home, "optout-award.json", awarded)]);
  const state = JSON.parse(await readFile(path.join(home, "state.json"), "utf8"));
  const agentA = state.tracking_records.find((item) => item.agent_id === "agent-a");
  const agentB = state.tracking_records.find((item) => item.agent_id === "agent-b");
  const preferenceA = state.tracking_preferences.find((item) => item.agent_id === "agent-a");
  assert.deepEqual(preferenceA.blocked_achievement_ids, ["wuxing-rule-gardener"]);
  assert.equal(agentA.achievement_ids.includes("wuxing-rule-gardener"), false);
  assert.equal(agentB.achievement_ids.includes("wuxing-rule-gardener"), true);

  run(home, ["track", "--agent", "agent-a", "--achievement", "wuxing-rule-gardener", "--enabled", "true"]);
  const enabledState = JSON.parse(await readFile(path.join(home, "state.json"), "utf8"));
  assert.deepEqual(enabledState.tracking_preferences.find((item) => item.agent_id === "agent-a").blocked_achievement_ids, []);
  assert.ok(enabledState.tracking_records.find((item) => item.agent_id === "agent-a").achievement_ids.includes("wuxing-rule-gardener"));
});

test("manual protocol validation rejects unknown fields, invalid event types, and key overflows before storage", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "achievement-strict-validation-"));
  run(home, ["bootstrap", "--agent", "agent-a", "--runtime", "test", "--workspace", process.cwd()]);

  const unknownEvent = event({ event_id: "evt:unknown-field", surprise: true });
  assert.equal(run(home, ["report", "--input", await input(home, "unknown-event.json", unknownEvent)], 1).error.field, "event.surprise");
  const invalidType = event({ event_id: "evt:invalid-type", event_type: "custom:Bad" });
  assert.equal(run(home, ["report", "--input", await input(home, "invalid-type.json", invalidType)], 1).error.field, "event_type");
  const longSource = event({ event_id: "evt:long-source", source: { system: "x".repeat(81), version: "1" } });
  assert.equal(run(home, ["report", "--input", await input(home, "long-source.json", longSource)], 1).error.field, "source");

  const invalidAchievement = {
    schema_version: version,
    achievement_id: "invalid-extra",
    title: "不应入库",
    intent: "包含协议外字段。",
    mode: "claim_review",
    condition: { event_types: ["task.completed"], target: 1, unit: "events" },
    evidence_required: true,
    tracking: { allowed: true, encouragement: "", guardrails: [] },
    unknown: true
  };
  assert.equal(run(home, ["define", "--input", await input(home, "invalid-achievement.json", invalidAchievement)], 1).error.field, "achievement.unknown");
  const state = JSON.parse(await readFile(path.join(home, "state.json"), "utf8"));
  assert.equal(state.processed_event_ids.includes("evt:unknown-field"), false);
  assert.equal(state.processed_event_ids.includes("evt:invalid-type"), false);
  assert.equal(state.achievements.some((item) => item.achievement_id === "invalid-extra"), false);
  assert.equal((await readFile(path.join(home, "events.jsonl"), "utf8")).trim(), "");
});
