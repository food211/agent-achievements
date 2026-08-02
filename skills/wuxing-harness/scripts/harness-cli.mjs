#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const VERSION = "wuxing-harness/v1";
const args = process.argv.slice(2);
const command = args.shift();

function option(name, fallback = "") {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
}

const workspace = path.resolve(option("workspace", process.cwd()));
const home = path.resolve(process.env.WUXING_HARNESS_HOME || path.join(workspace, ".wuxing-harness"));
const statePath = path.join(home, "state.json");
const databasePath = path.join(home, "harness.db");
const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const COACHING_STEPS = [
  { id: "creator_inventory", phase: "creator", prompt: "你和 AI 协作时，已经沉淀了哪些固定做法？请从 Skill、模板、规则或提示词里，先举一个你确实在用的例子。" },
  { id: "creator_outdated", phase: "creator", prompt: "这些沉淀里，有没有一条已经可能过时、但你仍在使用？请说一个具体实例：你因为什么开始怀疑它？" },
  { id: "creator_obsolete_guard", phase: "creator", prompt: "有没有一条规则原本是为了防住某个问题，而现在那个问题已经不存在或变了？请说规则原文、当时的问题和现在的变化。" },
  { id: "creator_human_judgment", phase: "creator", prompt: "最近一次你在和 AI 协作时觉得“这个还是得我来定”是什么事？当时 AI 缺少的是什么判断？" },
  { id: "admission_human", phase: "technical", prompt: "先只定最重要的入队判据：什么样的问题必须留给人判断？请用刚才的真实实例来划线，不要先追求通用公式。" },
  { id: "admission_agent", phase: "technical", prompt: "反过来，哪些问题不该进入待判队列，应该让 Agent 自己决定？请给一个会被你视为“垃圾打断”的具体例子。" },
  { id: "admission_failure", phase: "technical", prompt: "如果这道筛选错了，最可能怎样让你不再愿意清队列？你愿意接受的保守边界是什么？" },
  { id: "resume_work", phase: "technical", prompt: "一条任务挂起后，哪些彼此独立的分支仍能继续？人回来判断后，最少需要保存哪些状态才能接着跑？" },
  { id: "judgment_to_rule", phase: "technical", prompt: "人的一次判断怎样沉淀，才会让后续同类问题少问一次？请描述最小规则，以及至少满足什么条件才值得升级成规则。" },
  { id: "overturn_rule", phase: "technical", prompt: "今天先选一种可实现的规则推翻信号。它是什么？触发后旧规则应直接覆盖、归档还是降权，为什么？" },
  { id: "metrics", phase: "technical", prompt: "Demo 要记录三个证据：人介入/系统执行、一次判断解掉几个待判点、等待期间系统跑了多少。对你的工作流来说，一次“执行”和一次“解掉”分别怎样计数？" },
  { id: "boundary_non_goals", phase: "boundary", prompt: "今天明确不做什么？请列出会让这个最小闭环失焦的具体功能。" },
  { id: "boundary_unfit", phase: "boundary", prompt: "哪些五行映射你认为技术上做不了、没有价值，或目前根本套不上？卡住的地方请原样说，不需要替框架解释。" },
  { id: "boundary_dependencies", phase: "boundary", prompt: "开始实现这个最小闭环前，你还需要队友或外部系统提供什么？没有就明确说没有。" }
];

function emptyState() {
  return { schema_version: VERSION, workspace, findings: [], decisions: [], applications: [], achievement_sync: [], coaching: null };
}

function readState() {
  try {
    const value = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return value.schema_version === VERSION ? value : emptyState();
  } catch {
    return emptyState();
  }
}

function writeState(state) {
  fs.mkdirSync(home, { recursive: true });
  const temporary = `${statePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, statePath);
}

function openDatabase() {
  fs.mkdirSync(home, { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS coaching_answers (
      answer_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      phase TEXT NOT NULL,
      answer TEXT NOT NULL,
      quality TEXT NOT NULL CHECK (quality IN ('concrete', 'needs_followup')),
      note TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS issues (
      issue_id TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL,
      summary TEXT NOT NULL,
      details TEXT NOT NULL,
      impact_scope TEXT NOT NULL CHECK (impact_scope IN ('low', 'medium', 'high')),
      reversibility TEXT NOT NULL CHECK (reversibility IN ('reversible', 'costly', 'irreversible')),
      status TEXT NOT NULL CHECK (status IN ('observed', 'waiting_human', 'resolved')),
      source_ref TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS issues_fingerprint_idx ON issues(fingerprint, created_at);
    CREATE TABLE IF NOT EXISTS human_decisions (
      decision_id TEXT PRIMARY KEY,
      issue_id TEXT,
      decision_text TEXT NOT NULL,
      rationale TEXT,
      disposition TEXT NOT NULL CHECK (disposition IN ('ask', 'self_decide', 'observe', 'create_rule', 'replace_rule', 'retire_rule')),
      rule_ref TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (issue_id) REFERENCES issues(issue_id)
    );
  `);
  return database;
}

function recordCoachingAnswer(coaching, step, answer, now) {
  const database = openDatabase();
  try {
    database.prepare("INSERT INTO coaching_answers (answer_id, session_id, step_id, phase, answer, quality, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(`answer_${randomUUID()}`, coaching.session_id, step.id, step.phase, String(answer.answer).trim(), answer.quality, String(answer.note || "").trim() || null, now);
  } finally {
    database.close();
  }
}

function logIssue(value) {
  const summary = String(value.summary || "").trim();
  const details = String(value.details || "").trim();
  const fingerprint = String(value.fingerprint || summary).trim();
  if (!summary || !details || !fingerprint) throw new Error("issue-incomplete");
  if (!["low", "medium", "high"].includes(value.impact_scope)) throw new Error("issue-impact-invalid");
  if (!["reversible", "costly", "irreversible"].includes(value.reversibility)) throw new Error("issue-reversibility-invalid");
  if (!["observed", "waiting_human", "resolved"].includes(value.status)) throw new Error("issue-status-invalid");
  const database = openDatabase();
  try {
    const record = {
      issue_id: value.issue_id || `issue_${randomUUID()}`,
      fingerprint,
      summary,
      details,
      impact_scope: value.impact_scope,
      reversibility: value.reversibility,
      status: value.status,
      source_ref: String(value.source_ref || "").trim() || null,
      created_at: new Date().toISOString()
    };
    database.prepare("INSERT INTO issues (issue_id, fingerprint, summary, details, impact_scope, reversibility, status, source_ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(record.issue_id, record.fingerprint, record.summary, record.details, record.impact_scope, record.reversibility, record.status, record.source_ref, record.created_at);
    const occurrences = database.prepare("SELECT COUNT(*) AS count FROM issues WHERE fingerprint = ?").get(record.fingerprint).count;
    return { ...record, occurrences };
  } finally {
    database.close();
  }
}

function logDecision(value) {
  const decisionText = String(value.decision || "").trim();
  if (!decisionText) throw new Error("decision-text-required");
  if (!["ask", "self_decide", "observe", "create_rule", "replace_rule", "retire_rule"].includes(value.disposition)) throw new Error("decision-disposition-invalid");
  const database = openDatabase();
  try {
    const issueId = String(value.issue_id || "").trim() || null;
    if (issueId && !database.prepare("SELECT 1 FROM issues WHERE issue_id = ?").get(issueId)) throw new Error("decision-issue-not-found");
    const record = {
      decision_id: value.decision_id || `decision_${randomUUID()}`,
      issue_id: issueId,
      decision_text: decisionText,
      rationale: String(value.rationale || "").trim() || null,
      disposition: value.disposition,
      rule_ref: String(value.rule_ref || "").trim() || null,
      created_at: new Date().toISOString()
    };
    database.prepare("INSERT INTO human_decisions (decision_id, issue_id, decision_text, rationale, disposition, rule_ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(record.decision_id, record.issue_id, record.decision_text, record.rationale, record.disposition, record.rule_ref, record.created_at);
    if (record.issue_id) {
      const nextStatus = record.disposition === "ask" ? "waiting_human" : record.disposition === "observe" ? "observed" : "resolved";
      database.prepare("UPDATE issues SET status = ? WHERE issue_id = ?").run(nextStatus, record.issue_id);
    }
    return record;
  } finally {
    database.close();
  }
}

function currentCoachingStep(coaching) {
  return COACHING_STEPS[coaching?.step_index || 0] || null;
}

function coachingOutput(coaching) {
  const step = currentCoachingStep(coaching);
  return {
    schema_version: VERSION,
    status: coaching.status,
    phase: step?.phase || "complete",
    step_index: coaching.step_index,
    answer_count: coaching.answer_count || 0,
    total_steps: COACHING_STEPS.length,
    current_question: step ? { step_id: step.id, prompt: step.prompt } : null,
    instruction: step
      ? "Ask only current_question. If the answer is vague or hypothetical, record it as needs_followup and ask for one concrete incident before advancing."
      : "Synthesize the runnable minimum loop, the concrete human-admission rule, and the explicit non-goal list from the recorded answers and code evidence.",
    deliverables: step ? [] : ["runnable_minimum_loop", "human_admission_rule", "non_goals"]
  };
}

function loadJson(file) {
  if (!file) throw new Error("input-required");
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

function validateFinding(value) {
  const minimum = { direct_conflict: 1, repeated_friction: 2, automation_boundary: 1 }[value.kind];
  if (!minimum) throw new Error("finding-kind-invalid");
  if (!value.title || !value.rule?.path || !value.rule?.text) throw new Error("finding-rule-incomplete");
  if (!Number.isInteger(value.trigger_count) || value.trigger_count < 0 || !Number.isInteger(value.contradiction_count) || value.contradiction_count < 0 || value.contradiction_count > value.trigger_count) throw new Error("finding-counts-invalid");
  if (!Array.isArray(value.evidence) || value.evidence.length < minimum) throw new Error("finding-evidence-insufficient");
  if (value.evidence.some((item) => !item.type || !item.ref || !item.summary)) throw new Error("finding-evidence-invalid");
  const proposal = value.proposal || {};
  if (!proposal.replacement || !proposal.reason || !proposal.impact_scope || !proposal.reversibility) throw new Error("finding-proposal-incomplete");
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function achievementsCli() {
  const candidates = [
    process.env.AGENT_ACHIEVEMENTS_CLI,
    path.resolve(skillRoot, "..", "use-agent-achievements", "scripts", "achievement-cli.mjs")
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function runAchievements(cli, args) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: process.env });
  if (result.status !== 0) return { ok: false, error: result.stderr.trim() || "achievement-command-failed" };
  try { return JSON.parse(result.stdout); } catch { return { ok: false, error: "achievement-response-invalid" }; }
}

function setupAchievements() {
  const cli = achievementsCli();
  if (!cli) return { status: "not_installed" };
  const initialized = runAchievements(cli, ["init"]);
  if (!initialized.ok) return { status: "failed", error: initialized.error };
  const definitions = ["rule-gardener.achievement.json", "product-gatekeeper.achievement.json", "loop-keeper.achievement.json"];
  for (const file of definitions) {
    const defined = runAchievements(cli, ["define", "--input", path.join(skillRoot, "references", file), "--if-absent"]);
    if (!defined.ok) return { status: "failed", error: defined.error };
  }
  return { status: "ready", achievements: ["wuxing-rule-gardener", "wuxing-product-gatekeeper", "wuxing-loop-keeper"] };
}

function normalizedEvidence(items) {
  return (items || []).map((item) => ({
    type: { test: "test", decision: "decision_record", run: "trace" }[item.type] || "external",
    ref: item.ref,
    summary: item.summary
  }));
}

function achievementEvent(finding, eventType, extraEvidence = []) {
  const eventId = `wuxing:${finding.finding_id}:${eventType}:${randomUUID()}`;
  const lifecycleEvidence = eventType === "judgment.requested"
    ? [{ type: "trace", ref: `wuxing-finding:${finding.finding_id}`, summary: "Harness 已挂起这条高影响分支并等待人的判断。" }]
    : [];
  return {
    schema_version: "agent-achievements/v1",
    event_id: eventId,
    event_type: eventType,
    occurred_at: new Date().toISOString(),
    source: { system: "wuxing-harness", version: "0.1.0" },
    actor: { agent_id: option("agent", "wuxing-agent") },
    task: { id: option("task-id", finding.finding_id), type: option("task-type", "rule-maintenance") },
    run: { id: option("run-id", option("task-id", finding.finding_id)) },
    outcome: {
      status: eventType === "judgment.requested" ? "parked" : "completed",
      summary: eventType === "judgment.requested" ? `规则边界需要人判断：${finding.title}` : `规则已经按人的决定修改并验证：${finding.title}`
    },
    evidence: [...normalizedEvidence(finding.evidence), ...lifecycleEvidence, ...extraEvidence],
    extensions: { finding_id: finding.finding_id, relation: finding.relation || "unmapped", human_decision_required: true }
  };
}

function syncAchievement(event, achievementId) {
  const eventDirectory = path.join(home, "achievement-events");
  fs.mkdirSync(eventDirectory, { recursive: true });
  const eventFile = path.join(eventDirectory, `${event.event_id.replace(/[^a-z0-9._-]/gi, "_")}.json`);
  fs.writeFileSync(eventFile, `${JSON.stringify(event, null, 2)}\n`, "utf8");
  const cli = achievementsCli();
  if (!cli) return { status: "queued", event_file: eventFile };
  const reported = runAchievements(cli, ["report", "--input", eventFile]);
  if (!reported.ok) return { status: "failed", event_file: eventFile, error: reported.error };
  if (!(reported.next_actions || []).some((item) => item.action === "submit_claim" && item.achievement_id === achievementId)) {
    return { status: reported.data?.duplicate ? "already_reported" : "reported", event_file: eventFile };
  }
  const claim = {
    schema_version: "agent-achievements/v1",
    claim_id: `claim:${event.event_id}`,
    achievement_id: achievementId,
    agent_id: event.actor.agent_id,
    task_ids: [event.task.id],
    summary: event.outcome.summary,
    evidence: event.evidence
  };
  const claimDirectory = path.join(home, "achievement-claims");
  fs.mkdirSync(claimDirectory, { recursive: true });
  const claimFile = path.join(claimDirectory, `${claim.claim_id.replace(/[^a-z0-9._-]/gi, "_")}.json`);
  fs.writeFileSync(claimFile, `${JSON.stringify(claim, null, 2)}\n`, "utf8");
  const submitted = runAchievements(cli, ["claim", "--input", claimFile]);
  return { status: submitted.ok ? "claim_submitted" : "failed", event_file: eventFile, claim_file: claimFile, ...(submitted.ok ? {} : { error: submitted.error }) };
}

try {
  if (command === "init") {
    const state = readState();
    state.workspace = workspace;
    const database = openDatabase();
    database.close();
    if (!(state.achievement_sync || []).some((item) => item.status === "ready")) {
      state.achievement_sync ||= [];
      state.achievement_sync.push({ at: new Date().toISOString(), ...setupAchievements() });
    }
    writeState(state);
    output({ ok: true, state_path: statePath, database_path: databasePath, workspace });
  } else if (command === "coach-start") {
    const state = readState();
    if (!state.coaching || option("restart") === "true") {
      const now = new Date().toISOString();
      state.coaching = { session_id: `coaching_${randomUUID()}`, status: "in_progress", step_index: 0, answer_count: 0, started_at: now, updated_at: now };
      writeState(state);
    }
    output(coachingOutput(state.coaching));
  } else if (command === "coach-status") {
    const state = readState();
    if (!state.coaching) throw new Error("coaching-not-started");
    output(coachingOutput(state.coaching));
  } else if (command === "coach-answer") {
    const answer = loadJson(option("input"));
    const state = readState();
    if (!state.coaching || state.coaching.status !== "in_progress") throw new Error("coaching-not-in-progress");
    const step = currentCoachingStep(state.coaching);
    if (!step || answer.step_id !== step.id) throw new Error("coaching-step-mismatch");
    if (!String(answer.answer || "").trim()) throw new Error("coaching-answer-required");
    if (!["concrete", "needs_followup"].includes(answer.quality)) throw new Error("coaching-quality-invalid");
    const now = new Date().toISOString();
    recordCoachingAnswer(state.coaching, step, answer, now);
    state.coaching.answer_count = (state.coaching.answer_count || 0) + 1;
    if (answer.quality === "concrete") state.coaching.step_index += 1;
    if (state.coaching.step_index >= COACHING_STEPS.length) state.coaching.status = "ready_to_synthesize";
    state.coaching.updated_at = now;
    writeState(state);
    output(coachingOutput(state.coaching));
  } else if (command === "issue-log") {
    output(logIssue(loadJson(option("input"))));
  } else if (command === "decision-log") {
    output(logDecision(loadJson(option("input"))));
  } else if (command === "history") {
    const database = openDatabase();
    try {
      const limit = Math.min(200, Math.max(1, Number.parseInt(option("limit", "50"), 10) || 50));
      output({
        database_path: databasePath,
        coaching_answers: database.prepare("SELECT session_id, step_id, phase, answer, quality, note, created_at FROM coaching_answers ORDER BY created_at DESC LIMIT ?").all(limit).reverse(),
        issues: database.prepare("SELECT i.*, (SELECT COUNT(*) FROM issues same WHERE same.fingerprint = i.fingerprint) AS occurrences FROM issues i ORDER BY i.created_at DESC LIMIT ?").all(limit),
        human_decisions: database.prepare("SELECT * FROM human_decisions ORDER BY created_at DESC LIMIT ?").all(limit)
      });
    } finally {
      database.close();
    }
  } else if (command === "propose") {
    const finding = loadJson(option("input"));
    validateFinding(finding);
    const state = readState();
    finding.schema_version = VERSION;
    finding.finding_id ||= `finding_${randomUUID()}`;
    finding.status = "pending";
    finding.created_at = new Date().toISOString();
    if (state.findings.some((item) => item.finding_id === finding.finding_id)) throw new Error("finding-id-duplicate");
    state.findings.push(finding);
    if (finding.kind === "automation_boundary") {
      state.achievement_sync.push({ finding_id: finding.finding_id, at: new Date().toISOString(), ...syncAchievement(achievementEvent(finding, "judgment.requested"), "wuxing-product-gatekeeper") });
    }
    writeState(state);
    output(finding);
  } else if (command === "list") {
    const state = readState();
    const status = option("status");
    output({ findings: status ? state.findings.filter((item) => item.status === status) : state.findings, decisions: state.decisions, applications: state.applications, achievement_sync: state.achievement_sync || [] });
  } else if (command === "decide") {
    const state = readState();
    const finding = state.findings.find((item) => item.finding_id === option("finding"));
    const decision = option("decision");
    if (!finding) throw new Error("finding-not-found");
    if (finding.status !== "pending") throw new Error("finding-already-decided");
    if (!['approve', 'reject'].includes(decision)) throw new Error("decision-invalid");
    finding.status = decision === "approve" ? "approved" : "rejected";
    const record = { decision_id: `decision_${randomUUID()}`, finding_id: finding.finding_id, decision, note: option("note"), decided_at: new Date().toISOString() };
    state.decisions.push(record);
    writeState(state);
    output(record);
  } else if (command === "applied") {
    const state = readState();
    const finding = state.findings.find((item) => item.finding_id === option("finding"));
    if (!finding) throw new Error("finding-not-found");
    if (finding.status !== "approved") throw new Error("finding-not-approved");
    const application = loadJson(option("input"));
    if (!application.path || !application.before || !application.after || !Array.isArray(application.validation)) throw new Error("application-incomplete");
    application.schema_version = VERSION;
    application.application_id = `application_${randomUUID()}`;
    application.finding_id = finding.finding_id;
    application.applied_at = new Date().toISOString();
    finding.status = "applied";
    state.applications.push(application);
    const extraEvidence = [
      { type: "decision_record", ref: state.decisions.find((item) => item.finding_id === finding.finding_id)?.decision_id || application.application_id, summary: "人已批准这次规则修改。" },
      ...application.validation.map((item) => ({ type: "test", ref: item, summary: "规则修改后完成验证。" }))
    ];
    state.achievement_sync.push({ finding_id: finding.finding_id, at: new Date().toISOString(), ...syncAchievement(achievementEvent(finding, "rule.revised", extraEvidence), "wuxing-rule-gardener") });
    writeState(state);
    output(application);
  } else {
    throw new Error("usage: init | coach-start [--restart true] | coach-status | coach-answer --input file | issue-log --input file | decision-log --input file | history [--limit 50] | propose --input file | list | decide --finding id --decision approve|reject | applied --finding id --input file");
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
