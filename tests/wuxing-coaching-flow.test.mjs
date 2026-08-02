import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import Ajv2020 from "ajv/dist/2020.js";

const cli = path.resolve("skills/wuxing-harness/scripts/harness-cli.mjs");

function run(workspace, args) {
  const result = spawnSync(process.execPath, [cli, ...args, "--workspace", workspace], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

async function answerFile(workspace, value) {
  const file = path.join(workspace, `answer-${Math.random().toString(36).slice(2)}.json`);
  await writeFile(file, JSON.stringify(value), "utf8");
  return file;
}

test("coaching asks one saved question at a time and does not advance vague answers", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "wuxing-coach-"));
  run(workspace, ["init"]);

  const started = run(workspace, ["coach-start"]);
  assert.equal(started.phase, "creator");
  assert.equal(started.current_question.step_id, "creator_inventory");
  assert.equal(Object.keys(started.current_question).sort().join(","), "prompt,step_id");

  const vague = run(workspace, ["coach-answer", "--input", await answerFile(workspace, {
    step_id: "creator_inventory",
    answer: "应该有一些规则。",
    quality: "needs_followup"
  })]);
  assert.equal(vague.current_question.step_id, "creator_inventory");
  assert.equal(vague.step_index, 0);

  const concrete = run(workspace, ["coach-answer", "--input", await answerFile(workspace, {
    step_id: "creator_inventory",
    answer: "我把每次提交后的总结固定成 git-recap Skill。",
    quality: "concrete"
  })]);
  assert.equal(concrete.current_question.step_id, "creator_outdated");
  assert.equal(concrete.step_index, 1);

  const resumed = run(workspace, ["coach-status"]);
  assert.equal(resumed.current_question.step_id, "creator_outdated");
  const state = JSON.parse(await readFile(path.join(workspace, ".wuxing-harness", "state.json"), "utf8"));
  assert.equal(state.coaching.answer_count, 2);
  assert.equal(state.coaching.answers, undefined);
  const database = new DatabaseSync(path.join(workspace, ".wuxing-harness", "harness.db"), { readOnly: true });
  assert.deepEqual(database.prepare("SELECT quality FROM coaching_answers ORDER BY created_at, rowid").all().map((item) => item.quality), ["needs_followup", "concrete"]);
  database.close();
});

test("issues and human decisions are stored and linked in SQLite", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "wuxing-decisions-"));
  run(workspace, ["init"]);
  const issue = run(workspace, ["issue-log", "--input", await answerFile(workspace, {
    issue_id: "issue-history-backfill",
    fingerprint: "no-product-rule:historical-data-backfill",
    summary: "Agent 想自动拉齐历史数据",
    details: "项目没有明确产品规则，改动会批量影响已有数据。",
    impact_scope: "high",
    reversibility: "costly",
    status: "waiting_human",
    source_ref: "task:backfill"
  })]);
  assert.equal(issue.occurrences, 1);

  run(workspace, ["decision-log", "--input", await answerFile(workspace, {
    issue_id: issue.issue_id,
    decision: "先询问我，并同时给出修改建议和理由。",
    rationale: "没有明确产品规则，且涉及大量数据改动。",
    disposition: "create_rule",
    rule_ref: "AGENTS.md:data-migrations"
  })]);
  const history = run(workspace, ["history"]);
  assert.equal(history.issues[0].status, "resolved");
  assert.equal(history.human_decisions[0].decision_text, "先询问我，并同时给出修改建议和理由。");
  assert.equal(history.human_decisions[0].issue_id, issue.issue_id);
});

test("issue and decision inputs have strict portable schemas", async () => {
  const ajv = new Ajv2020({ allErrors: true });
  const issueSchema = JSON.parse(await readFile(path.resolve("skills/wuxing-harness/references/issue.schema.json"), "utf8"));
  const decisionSchema = JSON.parse(await readFile(path.resolve("skills/wuxing-harness/references/decision.schema.json"), "utf8"));
  const issueValid = ajv.compile(issueSchema);
  const decisionValid = ajv.compile(decisionSchema);

  assert.equal(issueValid({ summary: "批量改历史数据", details: "没有明确产品规则。", impact_scope: "high", reversibility: "costly", status: "waiting_human" }), true);
  assert.equal(issueValid({ summary: "缺字段", details: "没有影响范围。", reversibility: "costly", status: "observed" }), false);
  assert.equal(decisionValid({ issue_id: "issue-1", decision: "先问我", disposition: "create_rule" }), true);
  assert.equal(decisionValid({ decision: "Agent 自己猜", disposition: "invent" }), false);
});

test("coaching keeps creator, technical, and boundary phases in order", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "wuxing-coach-order-"));
  run(workspace, ["init"]);
  let current = run(workspace, ["coach-start"]);
  const seen = [];

  while (current.current_question) {
    seen.push([current.phase, current.current_question.step_id]);
    current = run(workspace, ["coach-answer", "--input", await answerFile(workspace, {
      step_id: current.current_question.step_id,
      answer: `真实实例：${current.current_question.step_id}`,
      quality: "concrete"
    })]);
  }

  assert.equal(current.status, "ready_to_synthesize");
  assert.deepEqual(current.deliverables, ["runnable_minimum_loop", "human_admission_rule", "non_goals"]);
  assert.equal(seen[0][0], "creator");
  assert.equal(seen.find(([phase]) => phase === "technical")[1], "admission_human");
  assert.equal(seen.at(-1)[0], "boundary");
});
