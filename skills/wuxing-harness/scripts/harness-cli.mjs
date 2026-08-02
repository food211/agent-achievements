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
  { id: "creator_inventory", phase: "creator", prework: "扫描所有实际生效的 Skill、模板、规则文件和提示词；按类型列全名称、路径和一句可核验用途，合并重复项。", prompt: "先展示你找到的完整清单，再问：哪些已经停用、描述不准或遗漏？如果清单准确，用户只需确认。" },
  { id: "creator_outdated", phase: "creator", prework: "把清单逐项与当前代码、测试、配置、Git 历史和问题数据库对照；只提出有矛盾、漂移或反复摩擦证据的候选，并附来源。", prompt: "先展示过时或漂移候选及证据，再问：哪些判断准确，哪一项最值得继续？不要让用户从零回忆。" },
  { id: "creator_obsolete_guard", phase: "creator", prework: "从规则原文、相邻文档、提交历史和被保护代码推断建立目的；检查被防范的问题是否仍存在。目的找不到时明确写未知。", prompt: "先展示可能已经失去保护对象的规则，再请用户确认原始目的或排除候选。只询问仓库无法回答的缺口。" },
  { id: "creator_human_judgment", phase: "creator", prework: "读取 issues、human_decisions、待判 finding 和可见的用户覆盖记录，列出 Agent 曾停下或被纠正的具体时刻。", prompt: "先展示这些真实时刻，再问：哪些确实属于必须由你决定，哪些其实 Agent 可以自己处理？" },
  { id: "admission_human", phase: "technical", prework: "根据已确认实例，按影响范围、可逆性、是否已有明确产品规则和是否涉及外部或历史数据，拟一条最小入队判据并标注覆盖实例。", prompt: "给出拟定判据和它会拦住的实例，再请用户批准、收紧或放宽。" },
  { id: "admission_agent", phase: "technical", prework: "从低影响、可逆、已有明确规则的任务中列出不应打断用户的反例，并说明 Agent 可自行验证的方式。", prompt: "展示不入队清单，再请用户指出其中是否仍有必须询问的例外。" },
  { id: "admission_failure", phase: "technical", prework: "用当前判据回放已有问题记录，估算误报和漏报；列出最可能产生垃圾队列的类型。", prompt: "展示回放结果和建议的保守边界，再请用户只判断这个边界是否可接受。" },
  { id: "resume_work", phase: "technical", prework: "检查当前 Agent 的任务、子任务和可持久化能力，提出可继续的独立分支及恢复所需的最小状态。", prompt: "展示续跑方案和宿主限制，再请用户纠正错误假设。" },
  { id: "judgment_to_rule", phase: "technical", prework: "从问题指纹和历史决策中聚合同类判断，提出最小规则文本；标明出现次数、共通点和仍不应升级的孤例。", prompt: "展示候选规则及证据，再请用户决定继续观察、创建还是替换规则。" },
  { id: "overturn_rule", phase: "technical", prework: "根据仓库现有测试、运行记录和版本控制能力，选出今天可实现的推翻信号，并比较覆盖、归档、降权的实际成本。", prompt: "先推荐一种信号和处置方式，再请用户批准或改选。" },
  { id: "metrics", phase: "technical", prework: "依据 harness.db 和宿主任务记录，给出人介入、系统执行、一次判断解题数、等待期间执行数的可自动计算口径。", prompt: "展示计数公式及一个已有记录示例，再请用户确认是否符合她理解。" },
  { id: "boundary_non_goals", phase: "boundary", prework: "从需求文档、仓库现状和本轮已确认目标中提取明确不做项，并补充会扩大 MVP 的候选。", prompt: "展示不做清单，再请用户删除误判或补充遗漏。" },
  { id: "boundary_unfit", phase: "boundary", prework: "检查每个五行映射是否有真实机制和证据；把套不上、技术上不可行或收益不足的项原样列为 unmapped。", prompt: "展示不成立或存疑的映射，再请用户确认；不要要求用户替框架找解释。" },
  { id: "boundary_dependencies", phase: "boundary", prework: "扫描未满足的接口、凭据、外部服务、队友交付和运行环境要求，区分真正阻塞与可自行完成。", prompt: "展示依赖清单；如果没有阻塞，只请用户确认，不要让用户重新列一遍。" }
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
  const preparedContext = latestCoachingObservation(coaching, step);
  return {
    schema_version: VERSION,
    status: coaching.status,
    phase: step?.phase || "complete",
    step_index: coaching.step_index,
    answer_count: coaching.answer_count || 0,
    total_steps: COACHING_STEPS.length,
    current_question: step ? { step_id: step.id, prework: step.prework, prompt: step.prompt } : null,
    prepared_context: preparedContext,
    instruction: step
      ? preparedContext
        ? "Present prepared_context before asking only current_question.prompt. The user confirms, corrects, excludes, or prioritizes; never ask them to restate facts already found."
        : "Complete current_question.prework and save it with coach-observe before asking the user. Do not ask an open-ended question that repository evidence can answer."
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
    if (!latestCoachingObservation(state.coaching, step)) throw new Error("coaching-prework-required");
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
