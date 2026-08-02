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
  { id: "creator_inventory", phase: "creator", requires_observation: true, prework: "扫描所有实际生效的 Skill、模板、规则文件和提示词；按类型列出名称、路径和一句可核验用途，合并重复项。", prompt: "这是我扫描到的固定做法。哪些已经停用、描述不准或遗漏？如果准确，回复“清单准确”即可。" },
  { id: "creator_outdated", phase: "creator", requires_observation: true, prework: "把已确认清单与当前代码、测试、Git 历史、问题记录和人工纠正对照；找出有直接矛盾或反复摩擦证据的陈旧候选。每项说明当前用途、失效信号和证据；文件年龄只能用于排序。", prompt: "这是本轮最值得处理的陈旧候选。请选择一条先处理、纠正我的判断，或确认本轮没有合适候选。" },
  { id: "creator_obsolete_guard", phase: "creator", requires_observation: true, prework: "追查所选规则的建立目的、当时防范的问题和今天是否仍存在。能从代码与历史确认的直接给结论；找不到目的时明确写未知。", prompt: "我已经把规则原目的和当前现实对齐。请只确认 Agent 无法知道的原始意图，或选择保留、修改、退役、继续观察。" },
  { id: "creator_human_judgment", phase: "creator", requires_observation: true, prework: "读取具体任务、人工纠正和判断数据库，归纳哪些取舍已有明确规则、哪些仍属于产品或审美判断；给出 Agent 建议边界和实例。", prompt: "这是我归纳的人类判断边界。请批准、收紧或放宽；不需要重新讲一遍仓库事实。" },
  { id: "admission_human", phase: "technical", requires_observation: true, prework: "根据已确认实例拟定一条最小入队判据，覆盖影响范围、可逆性、既有规则和批量数据影响，并列出它会拦住的真实实例。", prompt: "这是建议的入队判据。请批准，或指出哪种情况应该增删。" },
  { id: "admission_agent", phase: "technical", requires_observation: true, prework: "从低影响、可逆、有明确规则且可自行验证的任务中整理不应入队的反例。", prompt: "这些情况建议由 Agent 自己决定。请确认是否存在必须询问的例外。" },
  { id: "admission_failure", phase: "technical", requires_observation: true, prework: "用当前判据回放已有问题，指出最可能的误报、漏报和垃圾队列来源，并提出一个保守修正。", prompt: "这是判据回放和保守修正。请确认这个误报/漏报取舍是否可接受。" },
  { id: "resume_work", phase: "technical", requires_observation: true, prework: "检查宿主真实的任务、子任务和持久化能力，给出挂起一项后可继续的独立分支、恢复状态和明确限制。", prompt: "这是当前宿主真正能做到的续跑方式。请只纠正其中的错误假设。" },
  { id: "judgment_to_rule", phase: "technical", requires_observation: true, prework: "聚合同一 fingerprint 的问题与人的决定，提出最小规则文本；标注出现次数、共通点和不应升级的孤例。", prompt: "这是可以沉淀的规则候选。请选择继续观察、创建或替换。" },
  { id: "overturn_rule", phase: "technical", requires_observation: true, prework: "从现有测试、运行结果和版本控制中选择可实施的失效信号，给出旧规则的删除、归档或降权建议及影响。", prompt: "这是建议的推翻信号和旧规则处置方式。请批准或改选。" },
  { id: "metrics", phase: "technical", requires_observation: true, prework: "依据 harness.db 和宿主记录直接计算或给出可计算口径：人介入/系统执行、一次判断解题数、等待期间执行数；附一个真实样例。", prompt: "这是三个证据数字及口径。请只指出哪项不能代表你要证明的事情。" },
  { id: "boundary_non_goals", phase: "boundary", requires_observation: true, prework: "从本轮目标、仓库现状和已确认方案提取不做清单，主动剔除会扩大 MVP 的部分。", prompt: "这是建议的不做清单。请删除误判或补一个关键遗漏。" },
  { id: "boundary_unfit", phase: "boundary", requires_observation: true, prework: "检查每个五行映射是否有真实机制；把套不上、技术不可行或收益不足的项原样列为 unmapped。", prompt: "这些映射目前不成立或不值得做。请确认，不需要替框架找解释。" },
  { id: "boundary_dependencies", phase: "boundary", requires_observation: true, prework: "扫描接口、凭据、外部服务、队友交付和运行环境，区分真正阻塞与 Agent 可自行完成。", prompt: "这是仅剩的真实依赖。请确认归属；没有阻塞就直接进入实施。" }
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
    CREATE TABLE IF NOT EXISTS coaching_observations (
      observation_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      candidates_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS coaching_observations_step_idx ON coaching_observations(session_id, step_id, created_at);
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

function recordCoachingObservation(coaching, step, value) {
  const summary = String(value.summary || "").trim();
  if (!summary || !Array.isArray(value.candidates)) throw new Error("coaching-observation-invalid");
  for (const candidate of value.candidates) {
    if (!candidate.id || !candidate.label || !candidate.source_ref || !candidate.evidence || !["high", "medium", "low", "unknown"].includes(candidate.confidence)) {
      throw new Error("coaching-candidate-invalid");
    }
  }
  const database = openDatabase();
  try {
    const record = {
      observation_id: value.observation_id || `observation_${randomUUID()}`,
      session_id: coaching.session_id,
      step_id: step.id,
      summary,
      candidates: value.candidates,
      created_at: new Date().toISOString()
    };
    database.prepare("INSERT INTO coaching_observations (observation_id, session_id, step_id, summary, candidates_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(record.observation_id, record.session_id, record.step_id, record.summary, JSON.stringify(record.candidates), record.created_at);
    return record;
  } finally {
    database.close();
  }
}

function latestCoachingObservation(coaching, step) {
  if (!coaching || !step) return null;
  const database = openDatabase();
  try {
    const row = database.prepare("SELECT observation_id, summary, candidates_json, created_at FROM coaching_observations WHERE session_id = ? AND step_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(coaching.session_id, step.id);
    return row ? { observation_id: row.observation_id, summary: row.summary, candidates: JSON.parse(row.candidates_json), created_at: row.created_at } : null;
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
  const currentObservation = latestCoachingObservation(coaching, step);
  const preparedContext = step?.requires_observation ? currentObservation : null;
  const supportContext = step && !step.requires_observation ? currentObservation : null;
  const inventoryContext = latestCoachingObservation(coaching, COACHING_STEPS[0]);
  return {
    schema_version: VERSION,
    status: coaching.status,
    phase: step?.phase || "complete",
    step_index: coaching.step_index,
    answer_count: coaching.answer_count || 0,
    total_steps: COACHING_STEPS.length,
    current_question: step ? { step_id: step.id, prework: step.prework, prompt: step.prompt } : null,
    prepared_context: preparedContext,
    support_context: supportContext,
    inventory_context: inventoryContext,
    instruction: step
      ? step.requires_observation
        ? preparedContext
          ? "Present prepared_context as the Agent's completed analysis, then ask only the minimal decision in current_question.prompt. Do not ask the user to supply facts already available in the workspace. Follow any user-requested change to sorting, filtering, or presentation while keeping the same decision goal."
          : "Complete current_question.prework and save the evidence-backed analysis with coach-observe before asking the user anything. Never present a naked question."
        : "Treat current_question.prompt as the judgment goal, not fixed wording. If the user asks to list, sort, filter, compare, or inspect, immediately change the questioning method from recall to recognition, follow the user's requested lens, save the resulting shortlist with coach-observe, and keep the same step. Use support_context to resume that adapted method. Do not call coach-answer until the user actually makes or describes a judgment."
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
    extensions: { finding_id: finding.finding_id, relation: finding.relation || "unmapped", human_decision_required: true, workspace }
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
    if (step.requires_observation && !latestCoachingObservation(state.coaching, step)) throw new Error("coaching-prework-required");
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
  } else if (command === "coach-observe") {
    const observation = loadJson(option("input"));
    const state = readState();
    if (!state.coaching || state.coaching.status !== "in_progress") throw new Error("coaching-not-in-progress");
    const step = currentCoachingStep(state.coaching);
    if (!step || observation.step_id !== step.id) throw new Error("coaching-step-mismatch");
    output({ observation: recordCoachingObservation(state.coaching, step, observation), coaching: coachingOutput(state.coaching) });
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
        coaching_observations: database.prepare("SELECT session_id, step_id, summary, candidates_json, created_at FROM coaching_observations ORDER BY created_at DESC LIMIT ?").all(limit).reverse().map((item) => ({ ...item, candidates: JSON.parse(item.candidates_json), candidates_json: undefined })),
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
    throw new Error("usage: init | coach-start [--restart true] | coach-status | coach-observe --input file | coach-answer --input file | issue-log --input file | decision-log --input file | history [--limit 50] | propose --input file | list | decide --finding id --decision approve|reject | applied --finding id --input file");
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
