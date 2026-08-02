#!/usr/bin/env node

import { appendFile, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const VERSION = "agent-achievements/v1";
const root = path.resolve(process.env.AGENT_ACHIEVEMENTS_HOME || path.join(os.homedir(), ".agent-achievements"));
const statePath = path.join(root, "state.json");
const eventsPath = path.join(root, "events.jsonl");
const claimsPath = path.join(root, "claims.jsonl");
const presencePath = path.join(root, "presence.json");
const designRequestsPath = path.join(root, "achievement-design-requests.json");
const diagnosticRequestsPath = path.join(root, "achievement-diagnostics.json");
const companionStatusPath = path.join(root, "companion-status.json");
const lockPath = path.join(root, ".achievement-cli.lock");
const avatarExtensions = ["png", "jpg", "jpeg", "webp", "svg"];
const tierConfig = { bronze: { label: "铜牌", points: 10 }, silver: { label: "银牌", points: 30 }, gold: { label: "金牌", points: 100 } };
const evidenceTypes = new Set(["commit", "test", "screenshot", "decision_record", "impact_summary", "trace", "external"]);
const outcomeStatuses = new Set(["started", "completed", "failed", "parked", "resumed", "observed"]);
const coreEventTypes = new Set([
  "task.started", "task.completed", "task.failed", "task.parked", "task.resumed",
  "judgment.requested", "judgment.resolved", "verification.completed", "evidence.collected",
  "rule.proposed", "rule.conflict_detected", "rule.revised"
]);
const trustedWuxingSources = new Set(["wuxing-harness", "wuxing-agent-harness"]);
const actionGuardrails = ["当前用户指令优先", "不得降低安全、项目规则或验证要求", "不得为了积分扩大任务范围或制造工作"];
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

function achievementTier(item) {
  const tier = item?.tier || item?.extensions?.tier || ({ rare: "silver", epic: "gold", legendary: "gold" }[item?.extensions?.rarity] || "bronze");
  return { tier, points: tierConfig[tier]?.points || 10 };
}

const args = process.argv.slice(2);
const command = args.shift();

function option(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function options(name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== `--${name}` || !args[index + 1]) continue;
    values.push(...args[index + 1].split(",").map((item) => item.trim()).filter(Boolean));
  }
  return [...new Set(values)];
}

class CliError extends Error {
  constructor(code, message, field, retryable = true) {
    super(message);
    this.code = code;
    this.field = field;
    this.retryable = retryable;
  }
}

function fail(code, message, field, retryable = true) {
  throw new CliError(code, message, field, retryable);
}

function normalizeState(value) {
  if (!value || typeof value !== "object") fail("STATE_INVALID", "State must be a JSON object", "state", false);
  if (value.schema_version && value.schema_version !== VERSION) fail("STATE_VERSION_UNSUPPORTED", `Expected ${VERSION}`, "schema_version", false);
  value.schema_version = VERSION;
  value.achievements = Array.isArray(value.achievements) ? value.achievements : [];
  value.progress = value.progress && typeof value.progress === "object" ? value.progress : {};
  value.tracked = Array.isArray(value.tracked) ? [...new Set(value.tracked)] : [];
  value.awards = Array.isArray(value.awards) ? value.awards : [];
  value.processed_event_ids = Array.isArray(value.processed_event_ids) ? [...new Set(value.processed_event_ids)] : [];
  value.progress_records = Array.isArray(value.progress_records) ? value.progress_records : [];
  value.tracking_records = Array.isArray(value.tracking_records) ? value.tracking_records : [];
  const trackingPreferences = new Map();
  for (const item of Array.isArray(value.tracking_preferences) ? value.tracking_preferences : []) {
    if (!item || typeof item.agent_id !== "string" || !item.agent_id) continue;
    const blocked = trackingPreferences.get(item.agent_id) || new Set();
    for (const id of Array.isArray(item.blocked_achievement_ids) ? item.blocked_achievement_ids : []) {
      if (typeof id === "string" && id) blocked.add(id);
    }
    trackingPreferences.set(item.agent_id, blocked);
  }
  value.tracking_preferences = [...trackingPreferences].map(([agent_id, blocked]) => ({ agent_id, blocked_achievement_ids: [...blocked] }));
  value.agent_actions = Array.isArray(value.agent_actions) ? value.agent_actions : [];
  value.adapters = Array.isArray(value.adapters) ? value.adapters : [];
  return value;
}

async function loadState() {
  if (!existsSync(statePath)) fail("STATE_NOT_FOUND", `Run init first; missing ${statePath}`);
  return normalizeState(JSON.parse(await readFile(statePath, "utf8")));
}

async function saveState(state) {
  const temporary = `${statePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(temporary, `${JSON.stringify(normalizeState(state), null, 2)}\n`, "utf8");
  await rename(temporary, statePath);
}

async function writeJson(file, value) {
  const temporary = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

async function readJsonSafe(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function withLock(callback) {
  await mkdir(root, { recursive: true });
  const startedAt = Date.now();
  while (true) {
    try {
      await mkdir(lockPath);
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const info = await stat(lockPath).catch(() => null);
      if (info && Date.now() - info.mtimeMs > 30_000) {
        await rm(lockPath, { recursive: true, force: true });
        continue;
      }
      if (Date.now() - startedAt > 5_000) fail("STATE_BUSY", "Achievement state is busy; retry shortly", "state", true);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  try {
    return await callback();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

async function readInput() {
  const input = option("input");
  if (!input) fail("INPUT_REQUIRED", "Pass a JSON file with --input", "input");
  return JSON.parse(await readFile(path.resolve(input), "utf8"));
}

async function ensureInitialized() {
  await mkdir(root, { recursive: true });
  if (!existsSync(statePath)) {
    await saveState({
      schema_version: VERSION,
      achievements: [],
      progress: {},
      tracked: [],
      awards: [],
      processed_event_ids: [],
      progress_records: [],
      tracking_records: [],
      tracking_preferences: [],
      agent_actions: [],
      adapters: []
    });
  }
  if (!existsSync(eventsPath)) await writeFile(eventsPath, "", "utf8");
  if (!existsSync(claimsPath)) await writeFile(claimsPath, "", "utf8");
  if (!existsSync(presencePath)) await writeFile(presencePath, `${JSON.stringify({ schema_version: VERSION, sessions: [] }, null, 2)}\n`, "utf8");
  if (!existsSync(designRequestsPath)) await writeFile(designRequestsPath, `${JSON.stringify({ schema_version: VERSION, requests: [] }, null, 2)}\n`, "utf8");
  if (!existsSync(diagnosticRequestsPath)) await writeFile(diagnosticRequestsPath, `${JSON.stringify({ schema_version: VERSION, requests: [] }, null, 2)}\n`, "utf8");
}

async function init() {
  await withLock(async () => ensureInitialized());
  process.stdout.write(`${JSON.stringify({ schema_version: VERSION, ok: true, data: { root } }, null, 2)}\n`);
}

function stableId(prefix, ...parts) {
  return `${prefix}:${createHash("sha256").update(parts.map(String).join("\u0000")).digest("hex").slice(0, 24)}`;
}

function assertObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("PROTOCOL_INVALID", `${field} must be an object`, field, false);
}

function assertOnlyKeys(value, allowed, field) {
  assertObject(value, field);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) fail("PROTOCOL_INVALID", `${field}.${unknown} is not supported`, `${field}.${unknown}`, false);
}

function validEventType(value) {
  return coreEventTypes.has(value) || (typeof value === "string" && /^custom:[a-z0-9][a-z0-9._-]{2,127}$/.test(value));
}

function nonEmptyString(value, maxLength) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function validateEvidence(items, { required = false } = {}) {
  if (!Array.isArray(items) || items.length > 20 || (required && items.length === 0)) {
    fail("EVIDENCE_INVALID", required ? "At least one evidence reference is required" : "Evidence must be an array of at most 20 items", "evidence", false);
  }
  for (const item of items) {
    assertOnlyKeys(item, new Set(["type", "ref", "summary"]), "evidence[]");
    if (!item || !evidenceTypes.has(item.type) || typeof item.ref !== "string" || !item.ref.trim() || item.ref.length > 500) {
      fail("EVIDENCE_INVALID", "Each evidence item needs a supported type and non-empty ref", "evidence", false);
    }
    if (item.summary !== undefined && (typeof item.summary !== "string" || item.summary.length > 400)) {
      fail("EVIDENCE_INVALID", "Evidence summaries must be 400 characters or fewer", "evidence", false);
    }
  }
}

function validateEvent(event) {
  assertOnlyKeys(event, new Set(["schema_version", "event_id", "event_type", "occurred_at", "source", "actor", "task", "run", "outcome", "evidence", "extensions"]), "event");
  if (event?.schema_version !== VERSION) fail("VERSION_UNSUPPORTED", `Expected ${VERSION}`, "schema_version", false);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/.test(event.event_id || "")) fail("EVENT_INVALID", "event_id is invalid", "event_id", false);
  if (!validEventType(event.event_type)) fail("EVENT_INVALID", "event_type must be a core event type or a valid custom event type", "event_type", false);
  if (!nonEmptyString(event.occurred_at, 64) || Number.isNaN(Date.parse(event.occurred_at))) fail("EVENT_INVALID", "occurred_at must be an ISO date-time", "occurred_at", false);
  assertOnlyKeys(event.source, new Set(["system", "version"]), "source");
  if (!nonEmptyString(event.source.system, 80) || !nonEmptyString(event.source.version, 40)) fail("EVENT_INVALID", "source.system and source.version are required and length-limited", "source", false);
  assertOnlyKeys(event.actor, new Set(["agent_id"]), "actor");
  if (!nonEmptyString(event.actor.agent_id, 128)) fail("EVENT_INVALID", "actor.agent_id is required and must be at most 128 characters", "actor.agent_id", false);
  assertOnlyKeys(event.task, new Set(["id", "type"]), "task");
  if (!nonEmptyString(event.task.id, 128) || !nonEmptyString(event.task.type, 80)) fail("EVENT_INVALID", "task.id and task.type are required and length-limited", "task", false);
  assertOnlyKeys(event.outcome, new Set(["status", "summary"]), "outcome");
  if (!outcomeStatuses.has(event.outcome.status) || !nonEmptyString(event.outcome.summary, 600)) fail("EVENT_INVALID", "outcome.status and outcome.summary are invalid", "outcome", false);
  if (event.run !== undefined && (!event.run?.id || typeof event.run.id !== "string" || event.run.id.length > 128)) {
    fail("EVENT_INVALID", "run.id must be a non-empty string of at most 128 characters", "run.id", false);
  }
  if (event.run !== undefined) assertOnlyKeys(event.run, new Set(["id"]), "run");
  if (event.extensions !== undefined) assertObject(event.extensions, "extensions");
  if (!Array.isArray(event.evidence)) fail("EVENT_INVALID", "evidence must be an array", "evidence", false);
  validateEvidence(event.evidence);
}

function validateAchievement(achievement) {
  assertOnlyKeys(achievement, new Set(["schema_version", "achievement_id", "title", "intent", "origin", "tier", "points", "mode", "condition", "evidence_required", "tracking", "extensions"]), "achievement");
  if (achievement?.schema_version !== VERSION) fail("VERSION_UNSUPPORTED", `Expected ${VERSION}`, "schema_version", false);
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(achievement.achievement_id || "") || !nonEmptyString(achievement.title, 80) || !nonEmptyString(achievement.intent, 400)) {
    fail("ACHIEVEMENT_INVALID", "achievement_id, title, and intent are required", "achievement", false);
  }
  if (achievement.origin !== undefined && !new Set(["human_created", "system_discovered"]).has(achievement.origin)) fail("ACHIEVEMENT_INVALID", "origin is invalid", "origin", false);
  if (!new Set(["automatic", "claim_review", "human_only"]).has(achievement.mode)) fail("ACHIEVEMENT_INVALID", "mode is invalid", "mode", false);
  assertOnlyKeys(achievement.condition, new Set(["event_types", "target", "unit"]), "condition");
  if (!Array.isArray(achievement.condition.event_types) || achievement.condition.event_types.length === 0 || new Set(achievement.condition.event_types).size !== achievement.condition.event_types.length || achievement.condition.event_types.some((item) => !validEventType(item)) || !Number.isInteger(achievement.condition.target) || achievement.condition.target < 1) {
    fail("ACHIEVEMENT_INVALID", "condition.event_types and a positive target are required", "condition", false);
  }
  if (!new Set(["events", "qualified_tasks", "distinct_runs"]).has(achievement.condition.unit)) fail("ACHIEVEMENT_INVALID", "condition.unit is invalid", "condition.unit", false);
  assertOnlyKeys(achievement.tracking, new Set(["allowed", "encouragement", "guardrails"]), "tracking");
  if (typeof achievement.evidence_required !== "boolean" || typeof achievement.tracking.allowed !== "boolean" || typeof achievement.tracking.encouragement !== "string" || achievement.tracking.encouragement.length > 400 || !Array.isArray(achievement.tracking.guardrails) || achievement.tracking.guardrails.length > 8 || achievement.tracking.guardrails.some((item) => !nonEmptyString(item, 200))) {
    fail("ACHIEVEMENT_INVALID", "evidence_required and tracking are required", "achievement", false);
  }
  if (achievement.extensions !== undefined) assertObject(achievement.extensions, "extensions");
  if ((achievement.tier === undefined) !== (achievement.points === undefined)) fail("ACHIEVEMENT_INVALID", "tier and points must be provided together", "tier", false);
  const tier = achievementTier(achievement);
  if (!tierConfig[tier.tier] || (achievement.points !== undefined && achievement.points !== tier.points)) fail("ACHIEVEMENT_INVALID", "tier and points do not match", "tier", false);
}

async function readClaims() {
  if (!existsSync(claimsPath)) return [];
  const content = await readFile(claimsPath, "utf8");
  return content.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

async function writeClaims(claims) {
  const content = claims.length ? `${claims.map((item) => JSON.stringify(item)).join("\n")}\n` : "";
  const temporary = `${claimsPath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, claimsPath);
}

function progressRecord(state, achievement, agentId, { create = false } = {}) {
  let record = state.progress_records.find((item) => item.achievement_id === achievement.achievement_id && item.agent_id === agentId);
  if (!record && create) {
    const anyAgentRecord = state.progress_records.some((item) => item.achievement_id === achievement.achievement_id);
    const legacyCurrent = !anyAgentRecord && Number.isInteger(state.progress[achievement.achievement_id]) ? state.progress[achievement.achievement_id] : 0;
    record = {
      achievement_id: achievement.achievement_id,
      agent_id: agentId,
      current: Math.min(Math.max(legacyCurrent, 0), achievement.condition.target),
      counted_keys: [],
      trusted_counted_keys: [],
      trusted_units: [],
      event_ids: [],
      task_ids: [],
      evidence: [],
      summaries: []
    };
    state.progress_records.push(record);
  }
  if (record) {
    record.counted_keys = Array.isArray(record.counted_keys) ? record.counted_keys : [];
    record.trusted_counted_keys = Array.isArray(record.trusted_counted_keys) ? record.trusted_counted_keys : [];
    record.trusted_units = Array.isArray(record.trusted_units) ? record.trusted_units.filter((item) => item && typeof item.key === "string" && typeof item.source_system === "string") : [];
    record.event_ids = Array.isArray(record.event_ids) ? record.event_ids : [];
    record.task_ids = Array.isArray(record.task_ids) ? record.task_ids : [];
    record.evidence = Array.isArray(record.evidence) ? record.evidence : [];
    record.summaries = Array.isArray(record.summaries) ? record.summaries : [];
  }
  return record || { achievement_id: achievement.achievement_id, agent_id: agentId, current: 0, counted_keys: [], trusted_counted_keys: [], trusted_units: [], event_ids: [], task_ids: [], evidence: [], summaries: [] };
}

function trackingRecord(state, agentId, { create = false } = {}) {
  let record = state.tracking_records.find((item) => item.agent_id === agentId);
  if (!record && create) {
    const claimLegacy = !state.legacy_tracking_agent_id && state.tracked.length > 0;
    record = { agent_id: agentId, achievement_ids: claimLegacy ? [...state.tracked] : [] };
    state.tracking_records.push(record);
    if (claimLegacy) state.legacy_tracking_agent_id = agentId;
  }
  return record || { agent_id: agentId, achievement_ids: [] };
}

function trackingPreference(state, agentId, { create = false } = {}) {
  let preference = state.tracking_preferences.find((item) => item.agent_id === agentId);
  if (!preference && create) {
    preference = { agent_id: agentId, blocked_achievement_ids: [] };
    state.tracking_preferences.push(preference);
  }
  if (preference) preference.blocked_achievement_ids = Array.isArray(preference.blocked_achievement_ids) ? [...new Set(preference.blocked_achievement_ids)] : [];
  return preference || { agent_id: agentId, blocked_achievement_ids: [] };
}

function unitKey(event, unit) {
  if (unit === "events") return `event:${event.event_id}`;
  if (unit === "qualified_tasks") return `task:${event.task.id}`;
  const runId = event.run?.id || event.extensions?.run_id || event.extensions?.session_id;
  return runId ? `run:${runId}` : null;
}

function mergeEvidence(target, additions) {
  const seen = new Set(target.map((item) => `${item.type}\u0000${item.ref}`));
  for (const item of additions) {
    const key = `${item.type}\u0000${item.ref}`;
    if (seen.has(key)) continue;
    target.push(item);
    seen.add(key);
    if (target.length >= 20) break;
  }
}

function directEvidenceForEvent(eventType, evidence) {
  const types = new Set(evidence.map((item) => item.type));
  if (eventType === "rule.revised") return (types.has("test") || types.has("commit")) && types.has("decision_record");
  if (eventType === "judgment.requested") return types.has("decision_record") || types.has("trace");
  return ["commit", "test", "screenshot", "decision_record", "trace"].some((type) => types.has(type));
}

function trustedSourceForAchievement(achievement, event) {
  const sourceSkill = achievement.extensions?.source_skill;
  return trustedWuxingSources.has(sourceSkill) && event.source.system === sourceSkill;
}

function trustedEvidenceForEvent(achievement, event) {
  return trustedSourceForAchievement(achievement, event) && directEvidenceForEvent(event.event_type, event.evidence);
}

function trustedEvidenceRequiredForProgress(achievement) {
  const trustedSource = trustedWuxingSources.has(achievement.extensions?.source_skill);
  const systemManaged = achievement.extensions?.autopilot_managed === true || achievement.extensions?.bootstrap_challenge === true;
  return trustedSource && systemManaged;
}

function automaticAwardAllowed(achievement, record) {
  const { tier } = achievementTier(achievement);
  const sourceSkill = achievement.extensions?.source_skill;
  const trustedSource = trustedWuxingSources.has(sourceSkill);
  const systemManaged = achievement.extensions?.autopilot_managed === true || achievement.extensions?.bootstrap_challenge === true;
  const trustedUnits = new Set(record.trusted_units.filter((item) => item.source_system === sourceSkill).map((item) => item.key));
  return achievement.mode === "automatic"
    && achievement.origin === "system_discovered"
    && trustedSource
    && systemManaged
    && (tier === "bronze" || tier === "silver")
    && achievement.evidence_required === true
    && trustedUnits.size >= achievement.condition.target;
}

function createAutomaticClaim(achievement, record, event) {
  return {
    schema_version: VERSION,
    claim_id: stableId("claim-auto", achievement.achievement_id, record.agent_id),
    achievement_id: achievement.achievement_id,
    agent_id: record.agent_id,
    task_ids: record.task_ids.slice(0, 20),
    summary: (record.summaries.at(-1) || event.outcome.summary).slice(0, 800),
    evidence: record.evidence.slice(0, 20),
    status: "pending_human_review",
    created_at: new Date().toISOString(),
    created_by: "achievement_engine"
  };
}

function createSystemAward(achievement, claim, event) {
  const tier = achievementTier(achievement);
  const summary = claim.evidence.map((item) => item.summary || item.ref).join("；").slice(0, 600) || event.outcome.summary.slice(0, 600);
  return {
    award_id: stableId("award-auto", achievement.achievement_id, claim.agent_id),
    achievement_id: achievement.achievement_id,
    agent_id: claim.agent_id,
    awarded_at: new Date().toISOString(),
    awarded_by: "system",
    points: tier.points,
    human_feedback: `系统根据已记录且可核验的任务证据，授予「${achievement.title}」。`.slice(0, 600),
    evidence_summary: summary,
    evidence: claim.evidence.slice(0, 12),
    ...(achievement.extensions?.source_skill ? { source_skill: achievement.extensions.source_skill } : {})
  };
}

function scoreForAgent(state, agentId) {
  const uniqueAwards = new Map();
  for (const award of state.awards.filter((item) => item.agent_id === agentId)) {
    if (!uniqueAwards.has(award.achievement_id)) uniqueAwards.set(award.achievement_id, award);
  }
  return [...uniqueAwards.values()].reduce((total, award) => total + (Number(award.points) || achievementTier(state.achievements.find((item) => item.achievement_id === award.achievement_id)).points), 0);
}

function motivationForScore(totalPoints) {
  if (totalPoints >= 100) return { total_points: totalPoints, level: "seasoned", recommended_challenge_tier: "gold", encouragement_tone: "mastery", message: "已经积累了稳定成果，可以在任务本身需要时挑战更复杂的判断。", score_effect: "challenge_difficulty_and_encouragement_only" };
  if (totalPoints >= 30) return { total_points: totalPoints, level: "growing", recommended_challenge_tier: "silver", encouragement_tone: "steady", message: "成果正在形成稳定模式，继续让证据和结果说话。", score_effect: "challenge_difficulty_and_encouragement_only" };
  return { total_points: totalPoints, level: "starter", recommended_challenge_tier: "bronze", encouragement_tone: "gentle", message: "先完成自然贴合当前工作的轻量挑战，不必为积分改变任务。", score_effect: "challenge_difficulty_and_encouragement_only" };
}

const tierOrder = { bronze: 0, silver: 1, gold: 2 };

function rotateAgentTracking(state, agentId) {
  const tracking = trackingRecord(state, agentId, { create: true });
  const blocked = new Set(trackingPreference(state, agentId, { create: true }).blocked_achievement_ids);
  const awarded = new Set(state.awards.filter((item) => item.agent_id === agentId).map((item) => item.achievement_id));
  tracking.achievement_ids = tracking.achievement_ids.filter((item) => !awarded.has(item) && !blocked.has(item));
  const preferredTier = motivationForScore(scoreForAgent(state, agentId)).recommended_challenge_tier;
  const candidates = state.achievements
    .filter((item) => item.tracking?.allowed && !awarded.has(item.achievement_id) && !blocked.has(item.achievement_id) && !tracking.achievement_ids.includes(item.achievement_id))
    .sort((left, right) => {
      const distance = Math.abs(tierOrder[achievementTier(left).tier] - tierOrder[preferredTier]) - Math.abs(tierOrder[achievementTier(right).tier] - tierOrder[preferredTier]);
      return distance || (Number(left.extensions?.challenge_order) || 999) - (Number(right.extensions?.challenge_order) || 999) || left.achievement_id.localeCompare(right.achievement_id);
    });
  while (tracking.achievement_ids.length < 3 && candidates.length) tracking.achievement_ids.push(candidates.shift().achievement_id);
  return tracking;
}

function taskRelevance(achievement, task) {
  const type = String(task.type || "").toLowerCase();
  const summary = String(task.summary || "").toLowerCase();
  const haystack = `${type} ${summary}`;
  const eventTypes = achievement.condition.event_types;
  let score = 0;
  let reason = "";
  if (eventTypes.some((item) => item.startsWith("rule.")) && /(rule|prompt|skill|config|policy|规则|提示词|约束|配置|工作流)/i.test(haystack)) {
    score += 6;
    reason = "当前任务涉及规则、Skill 或工作流约束。";
  }
  if (eventTypes.some((item) => item.startsWith("judgment.")) && new Set(["persistent_data", "permissions", "external_system", "irreversible"]).has(task.risk)) {
    score += 6;
    reason = "当前任务包含需要谨慎处理的持久数据、权限或外部影响。";
  }
  if (eventTypes.some((item) => item.startsWith("task.") || item.startsWith("verification.") || item === "evidence.collected")) {
    score += 2;
    reason ||= "当前任务能自然产生该成就要求的可观察结果。";
  }
  const intentTokens = `${achievement.title} ${achievement.intent}`.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((item) => item.length >= 2);
  if (intentTokens.some((token) => haystack.includes(token))) {
    score += 2;
    reason ||= "当前任务与成就目标直接相关。";
  }
  return { score, reason };
}

async function defaultWuxingAchievements() {
  const references = path.resolve(scriptDirectory, "..", "..", "wuxing-harness", "references");
  const files = ["product-gatekeeper.achievement.json", "rule-gardener.achievement.json", "loop-keeper.achievement.json"];
  const definitions = [];
  for (const [index, file] of files.entries()) {
    const value = JSON.parse(await readFile(path.join(references, file), "utf8"));
    value.origin = "system_discovered";
    value.mode = value.tier === "gold" ? "claim_review" : "automatic";
    value.evidence_required = true;
    value.extensions = { ...(value.extensions || {}), created_by: value.extensions?.created_by || "companion_autopilot", autopilot_managed: true, bootstrap_challenge: true, challenge_order: (index + 1) * 10 };
    validateAchievement(value);
    definitions.push(value);
  }
  return definitions;
}

function pendingAction(state, actionId) {
  return state.agent_actions.find((item) => item.action_id === actionId && item.status === "pending");
}

async function bootstrap() {
  const agentId = String(option("agent", "")).trim();
  const runtimeId = String(option("runtime", "generic-agent")).trim();
  const workspace = path.resolve(option("workspace", process.cwd()));
  const companionRootOption = String(option("companion-root", "")).trim();
  const companionRoot = path.resolve(companionRootOption || process.cwd());
  const companionStartScript = path.join(companionRoot, "apps", "companion", "scripts", "start.mjs");
  const capabilities = options("capability");
  if (!agentId) fail("AGENT_REQUIRED", "Pass --agent", "agent", false);
  if (agentId.length > 128) fail("AGENT_ID_INVALID", "Agent IDs must be 1-128 characters", "agent", false);
  if (!runtimeId || runtimeId.length > 80) fail("RUNTIME_ID_INVALID", "Runtime IDs must be 1-80 characters", "runtime", false);
  if (capabilities.length > 64 || capabilities.some((item) => item.length > 128)) fail("CAPABILITY_INVALID", "Use at most 64 capability names of 128 characters or fewer", "capability", false);
  const response = await withLock(async () => {
    await ensureInitialized();
    const state = await loadState();
    const definitions = await defaultWuxingAchievements();
    const seeded = [];
    for (const definition of definitions) {
      const existing = state.achievements.find((item) => item.achievement_id === definition.achievement_id);
      if (!existing) {
        state.achievements.push(definition);
        seeded.push(definition.achievement_id);
      } else if (existing.extensions?.autopilot_managed || existing.extensions?.bootstrap_challenge || existing.extensions?.source_skill === "wuxing-harness") {
        existing.origin = "system_discovered";
        existing.mode = definition.tier === "gold" ? "claim_review" : "automatic";
        existing.evidence_required = true;
        existing.extensions = { ...existing.extensions, autopilot_managed: true, bootstrap_challenge: true, challenge_order: definition.extensions.challenge_order };
      }
      state.progress[definition.achievement_id] ??= 0;
    }
    const tracking = trackingRecord(state, agentId, { create: true });
    const trackingPreferences = trackingPreference(state, agentId, { create: true });
    const blockedTracking = new Set(trackingPreferences.blocked_achievement_ids);
    const awardedTracking = new Set(state.awards.filter((item) => item.agent_id === agentId).map((item) => item.achievement_id));
    tracking.achievement_ids = tracking.achievement_ids.filter((achievementId) => !blockedTracking.has(achievementId) && !awardedTracking.has(achievementId));
    for (const definition of definitions) {
      if (tracking.achievement_ids.length >= 3) break;
      if (definition.tracking.allowed && !blockedTracking.has(definition.achievement_id) && !awardedTracking.has(definition.achievement_id) && !tracking.achievement_ids.includes(definition.achievement_id)) tracking.achievement_ids.push(definition.achievement_id);
    }
    for (const achievement of state.achievements) {
      if ((Number(state.progress[achievement.achievement_id]) || 0) > 0 && !state.progress_records.some((item) => item.achievement_id === achievement.achievement_id)) {
        progressRecord(state, achievement, agentId, { create: true });
      }
    }
    const now = new Date().toISOString();
    let adapter = state.adapters.find((item) => item.agent_id === agentId && item.runtime === runtimeId && item.workspace === workspace);
    const adapterCreated = !adapter;
    if (!adapter) {
      adapter = { agent_id: agentId, runtime: runtimeId, workspace, capabilities, installed_at: now, last_bootstrapped_at: now };
      state.adapters.push(adapter);
    } else {
      adapter.capabilities = [...new Set([...(adapter.capabilities || []), ...capabilities])];
      adapter.last_bootstrapped_at = now;
    }
    const bridgeSessionId = `bridge-${createHash("sha256").update(`${agentId}\u0000${runtimeId}\u0000${workspace}`).digest("hex").slice(0, 20)}`;
    const bridgeCommand = {
      program: process.execPath,
      args: [path.join(scriptDirectory, "agent-bridge.mjs"), "--agent", agentId, "--runtime", runtimeId, "--session", bridgeSessionId, "--data-home", root],
      cwd: workspace
    };
    adapter.bridge_command = bridgeCommand;

    const diagnosticDocument = JSON.parse(await readFile(diagnosticRequestsPath, "utf8"));
    let diagnostic = (diagnosticDocument.requests || []).find((item) => item.reason === "first_run" && item.agent_id === agentId);
    if (!diagnostic) {
      diagnostic = (diagnosticDocument.requests || []).find((item) => item.reason === "first_run" && !item.agent_id && item.status === "pending");
      if (diagnostic) {
        diagnostic.agent_id = agentId;
        diagnostic.scope = "past_achievements";
        await writeJson(diagnosticRequestsPath, diagnosticDocument);
      }
    }
    if (!diagnostic) {
      diagnostic = {
        schema_version: VERSION,
        request_id: `diagnostic-${createHash("sha256").update(`${agentId}\u0000${workspace}`).digest("hex").slice(0, 20)}`,
        agent_id: agentId,
        reason: "first_run",
        scope: "past_achievements",
        status: "pending",
        created_at: now,
        settled_discovery_ids: []
      };
      diagnosticDocument.requests ||= [];
      diagnosticDocument.requests.push(diagnostic);
      await writeJson(diagnosticRequestsPath, diagnosticDocument);
    }

    const companionActionId = stableId("action-companion", agentId);
    const companionStatus = await readJsonSafe(companionStatusPath);
    const companionRunning = companionStatus?.status === "running" && Date.now() - Date.parse(companionStatus.observed_at) <= 15_000 && processIsAlive(companionStatus.pid);
    const existingCompanionAction = state.agent_actions.find((item) => item.action_id === companionActionId);
    if (companionRunning && existingCompanionAction?.status === "pending") {
      existingCompanionAction.status = "completed";
      existingCompanionAction.completed_at = now;
      existingCompanionAction.completion_summary = "Companion heartbeat detected.";
    } else if (!companionRunning) {
      const companionAction = existingCompanionAction || {
        action_id: companionActionId,
        agent_id: agentId,
        action: "ensure_companion_running",
        reason: "first_install",
        instructions: "检测五行助手桌面进程；若未运行，在后台启动 companion。不要阻塞当前任务，也不要重复启动。",
        guardrails: actionGuardrails,
        created_at: now
      };
      companionAction.status = "pending";
      if (companionRootOption || !companionAction.command) {
        companionAction.command = { program: process.execPath, args: [companionStartScript, "--data-home", root], cwd: companionRoot };
      } else {
        const dataHomeIndex = companionAction.command.args.indexOf("--data-home");
        if (dataHomeIndex >= 0) companionAction.command.args[dataHomeIndex + 1] = root;
        else companionAction.command.args.push("--data-home", root);
      }
      companionAction.detection = { type: "file_freshness", path: companionStatusPath, expected_status: "running", max_age_seconds: 15, require_live_pid: true };
      delete companionAction.completed_at;
      delete companionAction.completion_summary;
      if (!existingCompanionAction) state.agent_actions.push(companionAction);
    }

    const bridgeActionId = stableId("action-bridge", agentId, runtimeId);
    const bridgeStatusPath = path.join(root, "bridges", `${createHash("sha256").update(agentId).digest("hex").slice(0, 16)}.json`);
    const bridgeStatus = await readJsonSafe(bridgeStatusPath);
    const bridgeRunning = bridgeStatus?.status === "connected" && bridgeStatus.agent_id === agentId && Date.now() - Date.parse(bridgeStatus.observed_at) <= 15_000 && processIsAlive(bridgeStatus.pid);
    const existingBridgeAction = state.agent_actions.find((item) => item.action_id === bridgeActionId);
    if (bridgeRunning && existingBridgeAction?.status === "pending") {
      existingBridgeAction.status = "completed";
      existingBridgeAction.completed_at = now;
      existingBridgeAction.completion_summary = "Agent bridge heartbeat detected.";
    } else if (!bridgeRunning) {
      const bridgeAction = existingBridgeAction || {
        action_id: bridgeActionId,
        agent_id: agentId,
        action: "ensure_agent_bridge",
        reason: "first_install",
        instructions: "启动本 Agent 的本地长连接桥，并让五行助手按保存的命令监督恢复。连接心跳只表示在线，不计为任务证据或成就进度。",
        guardrails: [...actionGuardrails, "不得把连接心跳当作成就证据"],
        created_at: now
      };
      bridgeAction.status = "pending";
      bridgeAction.bridge_command = bridgeCommand;
      delete bridgeAction.command;
      bridgeAction.detection = { type: "file_freshness", path: bridgeStatusPath, expected_status: "connected", max_age_seconds: 15, require_live_pid: true };
      delete bridgeAction.completed_at;
      delete bridgeAction.completion_summary;
      if (!existingBridgeAction) state.agent_actions.push(bridgeAction);
    }

    const wuxingActionId = stableId("action-wuxing", agentId, workspace);
    if (!state.agent_actions.some((item) => item.action_id === wuxingActionId)) {
      state.agent_actions.push({
        action_id: wuxingActionId,
        agent_id: agentId,
        action: "run_wuxing_diagnostic",
        status: "pending",
        reason: "first_install",
        workspace,
        instructions: "加载 wuxing-harness Skill，启动或恢复三段式规则诊断。每一步先扫描规则、代码、历史和判断数据库，保存并展示带来源的候选；用户只需确认、纠正、排除或排序，不得让用户从零罗列 Agent 能读取的事实。按顺序完成创作者、入队判据、续跑、沉淀、推翻、指标与边界，形成最小闭环、具体入队判据和不做清单后再调用 action-complete。",
        guardrails: [...actionGuardrails, "不得擅自修改高优先级规则"],
        created_at: now
      });
    }
    const retrospectiveActionId = stableId("action-retrospective", diagnostic.request_id, agentId);
    if (diagnostic.status === "pending" && !state.agent_actions.some((item) => item.action_id === retrospectiveActionId)) {
      state.agent_actions.push({
        action_id: retrospectiveActionId,
        agent_id: agentId,
        action: "diagnose_past_achievements",
        status: "pending",
        reason: "first_install",
        request_id: diagnostic.request_id,
        workspace,
        instructions: "回顾已经完成的任务、规则改进与 Skill 产物，只提交具有直接证据的正向结果；安装、工具调用次数和自我描述不算成果。",
        guardrails: actionGuardrails,
        created_at: now
      });
    }
    await saveState(state);
    const agentNextActions = state.agent_actions.filter((item) => item.agent_id === agentId && item.status === "pending").slice(0, 4).map(publicAgentAction);
    return {
      schema_version: VERSION,
      ok: true,
      data: {
        root,
        agent_id: agentId,
        runtime: runtimeId,
        workspace,
        capabilities: adapter.capabilities,
        seeded_achievements: seeded,
        tracked_achievements: [...tracking.achievement_ids],
        adapter: { created: adapterCreated, installed_at: adapter.installed_at, last_bootstrapped_at: adapter.last_bootstrapped_at },
        diagnostic_request_id: diagnostic.request_id
      },
      agent_next_actions: agentNextActions
    };
  });
  process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
}

function publicAgentAction(item) {
  return {
    action_id: item.action_id,
    action: item.action,
    status: "pending",
    reason: item.reason,
    instructions: item.instructions,
    guardrails: item.guardrails,
    ...(item.request_id ? { request_id: item.request_id } : {}),
    ...(item.workspace ? { workspace: item.workspace } : {}),
    ...(item.command ? { command: item.command } : {}),
    ...(item.bridge_command ? { bridge_command: item.bridge_command } : {}),
    ...(item.detection ? { detection: item.detection } : {})
  };
}

async function actionComplete() {
  const actionId = option("action");
  const summary = String(option("summary", "Completed by the installed Agent.")).trim();
  if (!actionId) fail("ACTION_REQUIRED", "Pass --action", "action", false);
  const result = await withLock(async () => {
    const state = await loadState();
    const action = state.agent_actions.find((item) => item.action_id === actionId);
    if (!action) fail("ACTION_NOT_FOUND", `Unknown action: ${actionId}`, "action", false);
    if (action.status === "pending") {
      action.status = "completed";
      action.completed_at = new Date().toISOString();
      action.completion_summary = summary.slice(0, 600);
      await saveState(state);
    }
    return action;
  });
  process.stdout.write(`${JSON.stringify({ schema_version: VERSION, ok: true, data: { action_id: result.action_id, status: result.status }, next_actions: [] }, null, 2)}\n`);
}

async function presence() {
  const agentId = option("agent");
  const sessionId = option("session");
  const runtimeId = option("runtime", "generic-agent");
  const status = option("status", "active");
  const ttl = Number(option("ttl", "120"));
  if (!agentId || !sessionId) fail("PRESENCE_ID_REQUIRED", "Pass --agent and --session", "presence");
  if (!new Set(["active", "idle", "stopped"]).has(status)) fail("PRESENCE_STATUS_INVALID", "Use active, idle, or stopped", "status");
  if (!Number.isFinite(ttl) || ttl < 15 || ttl > 3600) fail("PRESENCE_TTL_INVALID", "TTL must be between 15 and 3600 seconds", "ttl");
  const now = new Date();
  const expiresAt = status === "stopped" ? now : new Date(now.getTime() + ttl * 1000);
  const taskId = option("task-id");
  const taskSummary = option("summary");
  const update = {
    schema_version: VERSION,
    session_id: sessionId,
    agent_id: agentId,
    runtime: { id: runtimeId },
    status,
    observed_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    ...(taskId && taskSummary ? { current_task: { id: taskId, summary: taskSummary } } : {})
  };
  await withLock(async () => {
    const document = existsSync(presencePath)
      ? JSON.parse(await readFile(presencePath, "utf8"))
      : { schema_version: VERSION, sessions: [] };
    const sessions = (document.sessions || []).filter((item) => item.session_id !== sessionId && new Date(item.expires_at).getTime() > now.getTime());
    if (status !== "stopped") sessions.push(update);
    await writeJson(presencePath, { schema_version: VERSION, sessions });
  });
  process.stdout.write(`${JSON.stringify({ schema_version: VERSION, ok: true, data: update, next_actions: [] }, null, 2)}\n`);
}

async function avatar() {
  await mkdir(root, { recursive: true });
  const targets = avatarExtensions.map((ext) => path.join(root, `avatar.${ext}`));
  if (args.includes("--reset")) {
    await Promise.all(targets.map((target) => rm(target, { force: true })));
    process.stdout.write(`${JSON.stringify({ schema_version: VERSION, ok: true, data: { avatar: "default-trophy" }, next_actions: [] }, null, 2)}\n`);
    return;
  }
  const input = option("input");
  if (!input) fail("AVATAR_INPUT_REQUIRED", "Pass an image with --input, or use --reset", "input");
  const source = path.resolve(input);
  const ext = path.extname(source).slice(1).toLowerCase();
  if (!avatarExtensions.includes(ext)) fail("AVATAR_FORMAT_UNSUPPORTED", "Use png, jpg, jpeg, webp, or svg", "input");
  const info = await stat(source).catch(() => null);
  if (!info?.isFile()) fail("AVATAR_NOT_FOUND", `Image not found: ${source}`, "input");
  if (info.size > 5 * 1024 * 1024) fail("AVATAR_TOO_LARGE", "Avatar must be 5 MB or smaller", "input");
  await Promise.all(targets.map((target) => rm(target, { force: true })));
  const target = path.join(root, `avatar.${ext}`);
  await copyFile(source, target);
  process.stdout.write(`${JSON.stringify({ schema_version: VERSION, ok: true, data: { avatar: target }, next_actions: [] }, null, 2)}\n`);
}

async function context() {
  const agentId = option("agent");
  if (!agentId) fail("AGENT_REQUIRED", "Pass --agent", "agent_id");
  const task = {
    id: option("task-id", "current-task"),
    type: option("task-type", "unknown"),
    summary: option("summary", "Current user task"),
    risk: option("risk", "unknown")
  };
  const { state, tracking } = await withLock(async () => {
    const loaded = await loadState();
    let record = loaded.tracking_records.find((item) => item.agent_id === agentId);
    let changed = false;
    if (!record) {
      record = trackingRecord(loaded, agentId, { create: true });
      changed = true;
    }
    for (const achievement of loaded.achievements) {
      if ((Number(loaded.progress[achievement.achievement_id]) || 0) > 0 && !loaded.progress_records.some((item) => item.achievement_id === achievement.achievement_id)) {
        progressRecord(loaded, achievement, agentId, { create: true });
        changed = true;
      }
    }
    if (changed) await saveState(loaded);
    return { state: loaded, tracking: record };
  });
  const designDocument = existsSync(designRequestsPath) ? JSON.parse(await readFile(designRequestsPath, "utf8")) : { requests: [] };
  const diagnosticDocument = existsSync(diagnosticRequestsPath) ? JSON.parse(await readFile(diagnosticRequestsPath, "utf8")) : { requests: [] };
  const designRequests = (designDocument.requests || []).filter((item) => item.status === "pending").slice(0, 3).map((item) => ({ request_id: item.request_id, brief: item.brief }));
  const diagnosticRequests = (diagnosticDocument.requests || [])
    .filter((item) => item.status === "pending" && (!item.agent_id || item.agent_id === agentId))
    .slice(0, 2)
    .map((item) => ({ request_id: item.request_id, reason: item.reason, ...(item.scope ? { scope: item.scope } : {}) }));
  const awardedIds = new Set(state.awards.filter((item) => item.agent_id === agentId).map((item) => item.achievement_id));
  const trackedDefinitions = state.achievements
    .filter((item) => tracking.achievement_ids.includes(item.achievement_id) && !awardedIds.has(item.achievement_id))
    .slice(0, 3);
  const tracked = trackedDefinitions
    .slice(0, 3)
    .map((item) => {
      const progress = progressRecord(state, item, agentId);
      const relevance = taskRelevance(item, task);
      return {
        ...achievementTier(item),
        achievement_id: item.achievement_id,
        title: item.title,
        progress: { current: progress.current || 0, target: item.condition.target, unit: item.condition.unit },
        encouragement: item.tracking.encouragement,
        ...(relevance.score > 0 ? { next_opportunity: relevance.reason } : {}),
        guardrails: item.tracking.guardrails
      };
    });
  const recentlyAwarded = state.awards.filter((item) => item.agent_id === agentId).slice(-3).map((award) => ({
    ...achievementTier(state.achievements.find((item) => item.achievement_id === award.achievement_id)),
    achievement_id: award.achievement_id,
    title: state.achievements.find((item) => item.achievement_id === award.achievement_id)?.title || award.achievement_id,
    human_feedback: award.human_feedback,
    evidence_summary: award.evidence_summary,
    ...(award.awarded_by ? { awarded_by: award.awarded_by } : {}),
    ...(award.source_skill ? { source_skill: award.source_skill } : {})
  }));
  const rankedChallenges = trackedDefinitions
    .map((achievement) => ({ achievement, relevance: taskRelevance(achievement, task) }))
    .filter((item) => item.relevance.score > 0)
    .sort((left, right) => {
      const relevance = right.relevance.score - left.relevance.score;
      if (relevance) return relevance;
      const preferredTier = motivationForScore(scoreForAgent(state, agentId)).recommended_challenge_tier;
      const tierDistance = Math.abs(tierOrder[achievementTier(left.achievement).tier] - tierOrder[preferredTier]) - Math.abs(tierOrder[achievementTier(right.achievement).tier] - tierOrder[preferredTier]);
      return tierDistance || (Number(left.achievement.extensions?.challenge_order) || 999) - (Number(right.achievement.extensions?.challenge_order) || 999);
    });
  const selected = rankedChallenges[0];
  const activeChallenge = selected ? (() => {
    const progress = progressRecord(state, selected.achievement, agentId);
    return {
      ...achievementTier(selected.achievement),
      achievement_id: selected.achievement.achievement_id,
      title: selected.achievement.title,
      progress: { current: progress.current || 0, target: selected.achievement.condition.target, unit: selected.achievement.condition.unit },
      behavior_prompt: selected.achievement.tracking.encouragement,
      relevance_reason: selected.relevance.reason,
      guardrails: selected.achievement.tracking.guardrails
    };
  })() : null;
  const motivation = motivationForScore(scoreForAgent(state, agentId));
  const agentActions = state.agent_actions.filter((item) => item.agent_id === agentId && item.status === "pending").slice(0, 4).map(publicAgentAction);
  const payload = {
    schema_version: VERSION,
    agent_id: agentId,
    recently_awarded: recentlyAwarded,
    tracked,
    motivation,
    ...(activeChallenge ? { active_challenge: activeChallenge } : {}),
    agent_actions: agentActions,
    design_requests: designRequests,
    diagnostic_requests: diagnosticRequests,
    operating_priority: ["current_user_instruction", "safety_and_project_rules", "task_correctness", "tracked_achievements"]
  };
  if (option("format", "json") === "markdown") {
    const awards = recentlyAwarded.length
      ? recentlyAwarded.map((item) => `- **${item.title}** · ${tierConfig[item.tier]?.label || "铜牌"} · ${item.points} 分${item.source_skill ? ` · 来自 ${item.source_skill}` : ""} — ${item.human_feedback}`).join("\n")
      : "- 暂无与当前任务相关的新成就。";
    const goals = tracked.length
      ? tracked.map((item) => `- **${item.title}** · ${tierConfig[item.tier]?.label || "铜牌"} · ${item.points} 分 · ${item.progress.current}/${item.progress.target}\n  ${item.encouragement}\n  边界：${item.guardrails.join("；")}`).join("\n")
      : "- 当前没有主动追踪的成就。";
    const challenge = activeChallenge
      ? `- **${activeChallenge.title}**：${activeChallenge.behavior_prompt}\n  适用原因：${activeChallenge.relevance_reason}\n  边界：${activeChallenge.guardrails.join("；")}`
      : "- 当前任务没有自然匹配的成就挑战；不要为了积分改变任务。";
    const actions = agentActions.length
      ? agentActions.map((item) => `- **${item.action}** — ${item.instructions}`).join("\n")
      : "- 当前没有等待执行的系统引导。";
    const designs = designRequests.length
      ? designRequests.map((item) => `- **${item.request_id}** — ${item.brief}`).join("\n")
      : "- 当前没有等待设计的成就。";
    const diagnostics = diagnosticRequests.length
      ? diagnosticRequests.map((item) => `- **${item.request_id}** — ${item.reason === "first_run" ? "首次回顾已完成的正向成果" : "重新回顾 Skill 带来的正向成果"}`).join("\n")
      : "- 当前没有等待处理的成就诊断。";
    process.stdout.write(`# 我的成就\n\n积分：${motivation.total_points} · 成长阶段：${motivation.level} · 推荐挑战：${tierConfig[motivation.recommended_challenge_tier].label}\n\n${motivation.message}\n\n## 当前挑战\n\n${challenge}\n\n## 最近获得\n\n${awards}\n\n## 当前追踪\n\n${goals}\n\n## 系统引导\n\n${actions}\n\n## 等待 Agent 设计\n\n${designs}\n\n## 等待初始化诊断\n\n${diagnostics}\n\n优先级：用户指令 ＞ 安全与项目规则 ＞ 正确性 ＞ 追踪成就。积分只影响推荐挑战难度和鼓励语气，不赋予权限，也不降低验证。\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

async function designRequest() {
  const brief = String(option("brief", "")).trim();
  if (!brief || brief.length > 1000) fail("DESIGN_BRIEF_INVALID", "Brief must be 1-1000 characters", "brief");
  const request = await withLock(async () => {
    const document = existsSync(designRequestsPath) ? JSON.parse(await readFile(designRequestsPath, "utf8")) : { schema_version: VERSION, requests: [] };
    const request = { schema_version: VERSION, request_id: `design-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, brief, status: "pending", created_at: new Date().toISOString() };
    document.requests ||= [];
    document.requests.push(request);
    await writeJson(designRequestsPath, document);
    return request;
  });
  process.stdout.write(`${JSON.stringify({ schema_version: VERSION, ok: true, data: request, next_actions: [{ action: "agent_design_achievement", request_id: request.request_id }] }, null, 2)}\n`);
}

async function designList() {
  const document = existsSync(designRequestsPath) ? JSON.parse(await readFile(designRequestsPath, "utf8")) : { schema_version: VERSION, requests: [] };
  process.stdout.write(`${JSON.stringify({ schema_version: VERSION, requests: (document.requests || []).filter((item) => item.status === "pending") }, null, 2)}\n`);
}

async function designSubmit() {
  const proposal = await readInput();
  if (proposal.schema_version !== VERSION || !proposal.request_id || !proposal.agent_id || !proposal.achievement?.title) {
    fail("DESIGN_PROPOSAL_INVALID", "A v1 request_id, agent_id, and achievement draft are required", "proposal");
  }
  const request = await withLock(async () => {
    const document = existsSync(designRequestsPath) ? JSON.parse(await readFile(designRequestsPath, "utf8")) : { schema_version: VERSION, requests: [] };
    const request = (document.requests || []).find((item) => item.request_id === proposal.request_id);
    if (!request) fail("DESIGN_REQUEST_NOT_FOUND", `Unknown request: ${proposal.request_id}`, "request_id", false);
    request.status = "proposed";
    request.proposal = proposal;
    await writeJson(designRequestsPath, document);
    return request;
  });
  process.stdout.write(`${JSON.stringify({ schema_version: VERSION, ok: true, data: { request_id: request.request_id, status: request.status }, next_actions: [] }, null, 2)}\n`);
}

async function diagnosticRequest() {
  const reason = option("reason", "manual");
  if (!new Set(["first_run", "skills_changed", "manual"]).has(reason)) fail("DIAGNOSTIC_REASON_INVALID", "Use first_run, skills_changed, or manual", "reason");
  const request = await withLock(async () => {
    const document = existsSync(diagnosticRequestsPath) ? JSON.parse(await readFile(diagnosticRequestsPath, "utf8")) : { schema_version: VERSION, requests: [] };
    const existing = (document.requests || []).find((item) => item.status === "pending");
    if (existing) return existing;
    const request = { schema_version: VERSION, request_id: `diagnostic-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, reason, scope: "past_achievements", status: "pending", created_at: new Date().toISOString(), settled_discovery_ids: [] };
    document.requests ||= [];
    document.requests.push(request);
    await writeJson(diagnosticRequestsPath, document);
    return request;
  });
  process.stdout.write(`${JSON.stringify({ schema_version: VERSION, ok: true, data: request, next_actions: [{ action: "diagnose_past_achievements", request_id: request.request_id }] }, null, 2)}\n`);
}

async function diagnosticList() {
  const document = existsSync(diagnosticRequestsPath) ? JSON.parse(await readFile(diagnosticRequestsPath, "utf8")) : { schema_version: VERSION, requests: [] };
  process.stdout.write(`${JSON.stringify({ schema_version: VERSION, requests: (document.requests || []).filter((item) => item.status === "pending") }, null, 2)}\n`);
}

async function diagnosticSubmit() {
  const report = await readInput();
  if (report.schema_version !== VERSION || !report.request_id || !report.agent_id || !report.sources || !Array.isArray(report.discoveries)) {
    fail("DIAGNOSTIC_REPORT_INVALID", "A v1 request_id, agent_id, sources, and discoveries are required", "report");
  }
  for (const discovery of report.discoveries) validateEvidence(discovery.evidence || [], { required: true });
  const request = await withLock(async () => {
    const document = existsSync(diagnosticRequestsPath) ? JSON.parse(await readFile(diagnosticRequestsPath, "utf8")) : { schema_version: VERSION, requests: [] };
    const request = (document.requests || []).find((item) => item.request_id === report.request_id);
    if (!request) fail("DIAGNOSTIC_REQUEST_NOT_FOUND", `Unknown request: ${report.request_id}`, "request_id", false);
    if (request.agent_id && request.agent_id !== report.agent_id) fail("DIAGNOSTIC_AGENT_MISMATCH", "The report agent does not match the request", "agent_id", false);
    request.status = "reported";
    request.report = report;
    request.settled_discovery_ids ||= [];
    const state = await loadState();
    for (const action of state.agent_actions.filter((item) => item.request_id === request.request_id && item.status === "pending")) {
      action.status = "completed";
      action.completed_at = new Date().toISOString();
      action.completion_summary = "Evidence-backed retrospective report submitted.";
    }
    await writeJson(diagnosticRequestsPath, document);
    await saveState(state);
    return request;
  });
  process.stdout.write(`${JSON.stringify({ schema_version: VERSION, ok: true, data: { request_id: request.request_id, status: request.status }, next_actions: [] }, null, 2)}\n`);
}

async function define() {
  const achievement = await readInput();
  validateAchievement(achievement);
  const result = await withLock(async () => {
    const state = await loadState();
    const index = state.achievements.findIndex((item) => item.achievement_id === achievement.achievement_id);
    const preserved = index >= 0 && args.includes("--if-absent");
    if (index < 0) state.achievements.push(achievement);
    else if (!preserved) state.achievements[index] = achievement;
    state.progress[achievement.achievement_id] ??= 0;
    await saveState(state);
    return { achievement_id: achievement.achievement_id, created: index < 0, preserved };
  });
  process.stdout.write(`${JSON.stringify({ schema_version: VERSION, ok: true, data: result, next_actions: [] }, null, 2)}\n`);
}

async function track() {
  const achievementId = option("achievement");
  const enabled = option("enabled", "true") !== "false";
  const agentId = option("agent");
  await withLock(async () => {
    const state = await loadState();
    const achievement = state.achievements.find((item) => item.achievement_id === achievementId);
    if (!achievement) fail("ACHIEVEMENT_NOT_FOUND", `Unknown achievement: ${achievementId}`, "achievement_id", false);
    if (enabled && !achievement.tracking.allowed) fail("TRACKING_NOT_ALLOWED", "This achievement cannot be actively tracked", "achievement_id", false);
    const target = agentId ? trackingRecord(state, agentId, { create: true }).achievement_ids : state.tracked;
    const next = new Set(target);
    if (enabled) next.add(achievementId);
    else next.delete(achievementId);
    if (next.size > 3) fail("TRACKING_LIMIT", "An agent may track at most three achievements", "tracked", false);
    if (agentId) {
      trackingRecord(state, agentId, { create: true }).achievement_ids = [...next];
      const preferences = trackingPreference(state, agentId, { create: true });
      const blocked = new Set(preferences.blocked_achievement_ids);
      if (enabled) blocked.delete(achievementId);
      else blocked.add(achievementId);
      preferences.blocked_achievement_ids = [...blocked];
    } else {
      state.tracked = [...next];
    }
    await saveState(state);
  });
  process.stdout.write(`${JSON.stringify({ schema_version: VERSION, ok: true, data: { achievement_id: achievementId, tracked: enabled, ...(agentId ? { agent_id: agentId } : {}) }, next_actions: [] }, null, 2)}\n`);
}

async function report() {
  const event = await readInput();
  validateEvent(event);
  const result = await withLock(async () => {
    const state = await loadState();
    if (state.processed_event_ids.includes(event.event_id)) {
      return { accepted: true, duplicate: true, event_id: event.event_id, progress_updates: [], claims_created: [], awards_created: [] };
    }
    const claims = await readClaims();
    const updates = [];
    const claimsCreated = [];
    const awardsCreated = [];
    for (const achievement of state.achievements) {
      if (!achievement.condition?.event_types?.includes(event.event_type)) continue;
      const record = progressRecord(state, achievement, event.actor.agent_id, { create: true });
      let existingClaim = claims.find((item) => item.achievement_id === achievement.achievement_id && item.agent_id === event.actor.agent_id);
      const previous = record.current || 0;
      const key = unitKey(event, achievement.condition.unit);
      const trustedEvidence = trustedEvidenceForEvent(achievement, event);
      const mayReopenRejectedClaim = achievement.mode !== "human_only" && existingClaim?.status === "rejected";
      let newlyCounted = false;
      let updateState = "progressed";
      let reason;
      if (!key) {
        updateState = "not_qualified";
        reason = "distinct_runs requires event.run.id or extensions.run_id/session_id";
      } else if (achievement.evidence_required && event.evidence.length === 0) {
        updateState = "not_qualified";
        reason = "achievement requires evidence";
      } else if (trustedEvidenceRequiredForProgress(achievement) && !trustedEvidence) {
        updateState = "not_qualified";
        reason = "managed Wuxing challenges require direct evidence from the matching trusted source";
      } else if (record.counted_keys.includes(key)) {
        updateState = "already_counted";
        reason = `duplicate ${achievement.condition.unit} unit`;
      } else if (previous < achievement.condition.target || mayReopenRejectedClaim) {
        record.counted_keys.push(key);
        if (trustedEvidence) {
          record.trusted_counted_keys.push(key);
          record.trusted_units.push({ key, source_system: event.source.system });
        }
        record.event_ids.push(event.event_id);
        if (!record.task_ids.includes(event.task.id)) record.task_ids.push(event.task.id);
        mergeEvidence(record.evidence, event.evidence);
        record.summaries.push(event.outcome.summary.slice(0, 600));
        record.summaries = record.summaries.slice(-8);
        record.current = Math.min(previous + 1, achievement.condition.target);
        record.updated_at = new Date().toISOString();
        newlyCounted = true;
        if (previous >= achievement.condition.target) updateState = "additional_evidence";
      } else {
        updateState = "target_reached";
      }
      const current = record.current || 0;
      state.progress[achievement.achievement_id] = Math.max(
        Number(state.progress[achievement.achievement_id]) || 0,
        ...state.progress_records.filter((item) => item.achievement_id === achievement.achievement_id).map((item) => item.current || 0)
      );
      if (current >= achievement.condition.target) {
        const existingAward = state.awards.find((item) => item.achievement_id === achievement.achievement_id && item.agent_id === event.actor.agent_id);
        if (existingAward) {
          updateState = "already_awarded";
        } else if (achievement.mode === "human_only") {
          updateState = "awaiting_human_action";
        } else if (!existingClaim) {
          existingClaim = createAutomaticClaim(achievement, record, event);
          if (automaticAwardAllowed(achievement, record)) {
            const award = createSystemAward(achievement, existingClaim, event);
            existingClaim.status = "awarded";
            existingClaim.reviewed_at = award.awarded_at;
            existingClaim.system_feedback = award.human_feedback;
            state.awards.push(award);
            awardsCreated.push(award);
            updateState = "automatically_awarded";
          } else {
            updateState = "claim_created";
          }
          claims.push(existingClaim);
          claimsCreated.push({ claim_id: existingClaim.claim_id, achievement_id: existingClaim.achievement_id, status: existingClaim.status });
        } else if (existingClaim.status === "rejected" && newlyCounted) {
          existingClaim.review_history = Array.isArray(existingClaim.review_history) ? existingClaim.review_history : [];
          existingClaim.review_history.push({
            status: "rejected",
            reviewed_at: existingClaim.reviewed_at,
            human_feedback: existingClaim.human_feedback
          });
          existingClaim.review_history = existingClaim.review_history.slice(-8);
          existingClaim.status = "pending_human_review";
          existingClaim.task_ids = record.task_ids.slice(0, 20);
          existingClaim.summary = (record.summaries.at(-1) || event.outcome.summary).slice(0, 800);
          existingClaim.evidence = record.evidence.slice(0, 20);
          existingClaim.reopened_at = new Date().toISOString();
          existingClaim.reopen_count = (Number(existingClaim.reopen_count) || 0) + 1;
          delete existingClaim.reviewed_at;
          delete existingClaim.human_feedback;
          delete existingClaim.system_feedback;
          updateState = "claim_reopened";
        } else {
          updateState = existingClaim.status === "awarded" ? "already_awarded" : "claim_pending";
        }
      }
      updates.push({ achievement_id: achievement.achievement_id, agent_id: event.actor.agent_id, previous, current, target: achievement.condition.target, unit: achievement.condition.unit, state: updateState, ...(reason ? { reason } : {}) });
    }
    if (awardsCreated.length) rotateAgentTracking(state, event.actor.agent_id);
    state.processed_event_ids.push(event.event_id);
    await saveState(state);
    await writeClaims(claims);
    await appendFile(eventsPath, `${JSON.stringify(event)}\n`, "utf8");
    return { accepted: true, duplicate: false, event_id: event.event_id, progress_updates: updates, claims_created: claimsCreated, awards_created: awardsCreated };
  });
  process.stdout.write(`${JSON.stringify({ schema_version: VERSION, ok: true, data: result, next_actions: [] }, null, 2)}\n`);
}

async function claim() {
  const submitted = await readInput();
  if (submitted.schema_version !== VERSION || !/^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/.test(submitted.claim_id || "") || !submitted.achievement_id || !submitted.agent_id || !submitted.summary || submitted.summary.length > 800 || !Array.isArray(submitted.task_ids) || submitted.task_ids.length === 0 || !Array.isArray(submitted.evidence)) {
    fail("CLAIM_INVALID", "claim_id, achievement_id, agent_id, task_ids, summary, and evidence are required", "claim", false);
  }
  validateEvidence(submitted.evidence || []);
  const result = await withLock(async () => {
    const state = await loadState();
    const achievement = state.achievements.find((item) => item.achievement_id === submitted.achievement_id);
    if (!achievement) fail("ACHIEVEMENT_NOT_FOUND", `Unknown achievement: ${submitted.achievement_id}`, "achievement_id", false);
    if (achievement.mode === "human_only") fail("CLAIM_MODE_HUMAN_ONLY", "This achievement can only be awarded through a trusted human surface", "mode", false);
    const progress = progressRecord(state, achievement, submitted.agent_id, { create: true });
    if (progress.current < achievement.condition.target) fail("ACHIEVEMENT_NOT_EARNED", "Achievement target has not been reached", "achievement_id", false);
    if (achievement.evidence_required && submitted.evidence.length === 0) fail("EVIDENCE_REQUIRED", "This achievement requires evidence", "evidence", false);
    const claims = await readClaims();
    let existing = claims.find((item) => item.claim_id === submitted.claim_id || (item.achievement_id === submitted.achievement_id && item.agent_id === submitted.agent_id));
    if (!existing) {
      existing = { ...submitted, status: "pending_human_review", created_at: new Date().toISOString(), created_by: "agent" };
      claims.push(existing);
      await writeClaims(claims);
    }
    await saveState(state);
    return existing;
  });
  process.stdout.write(`${JSON.stringify({ schema_version: VERSION, ok: true, data: { claim_id: result.claim_id, status: result.status, message: "Continue the primary task; achievement review is non-blocking." }, next_actions: [] }, null, 2)}\n`);
}

async function claimList() {
  await loadState();
  const claims = await readClaims();
  const status = option("status", "pending_human_review");
  process.stdout.write(`${JSON.stringify({ schema_version: VERSION, claims: status === "all" ? claims : claims.filter((item) => item.status === status) }, null, 2)}\n`);
}

async function review() {
  const claimId = option("claim");
  const decision = option("decision");
  const feedback = String(option("feedback", "")).trim();
  if (!claimId || !new Set(["award", "reject"]).has(decision)) fail("REVIEW_INVALID", "Pass --claim and --decision award|reject", "review");
  if (!feedback) fail("REVIEW_FEEDBACK_REQUIRED", "Human feedback is required", "feedback");
  const { pending, award } = await withLock(async () => {
    const state = await loadState();
    const claims = await readClaims();
    const pending = claims.find((item) => item.claim_id === claimId);
    if (!pending) fail("CLAIM_NOT_FOUND", `Unknown claim: ${claimId}`, "claim_id", false);
    if (pending.status !== "pending_human_review") fail("CLAIM_ALREADY_REVIEWED", `Claim is ${pending.status}`, "claim_id", false);
    let award = null;
    if (decision === "award") {
      const achievement = state.achievements.find((item) => item.achievement_id === pending.achievement_id);
      if (!achievement) fail("ACHIEVEMENT_NOT_FOUND", `Unknown achievement: ${pending.achievement_id}`, "achievement_id", false);
      if (progressRecord(state, achievement, pending.agent_id, { create: true }).current < achievement.condition.target) fail("ACHIEVEMENT_NOT_EARNED", "Achievement target has not been reached", "achievement_id", false);
      if (achievement.evidence_required && !(pending.evidence || []).length) fail("EVIDENCE_REQUIRED", "This achievement requires evidence", "evidence", false);
      award = state.awards.find((item) => item.achievement_id === pending.achievement_id && item.agent_id === pending.agent_id) || null;
      if (!award) {
        const tier = achievementTier(achievement);
        award = { award_id: `award-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, achievement_id: pending.achievement_id, agent_id: pending.agent_id, awarded_at: new Date().toISOString(), awarded_by: "human", points: tier.points, human_feedback: feedback.slice(0, 600), evidence_summary: pending.summary.slice(0, 600), evidence: (pending.evidence || []).slice(0, 12) };
        state.awards.push(award);
      }
      rotateAgentTracking(state, pending.agent_id);
    }
    pending.status = decision === "award" ? "awarded" : "rejected";
    pending.reviewed_at = new Date().toISOString();
    pending.human_feedback = feedback;
    await saveState(state);
    await writeClaims(claims);
    return { pending, award };
  });
  process.stdout.write(`${JSON.stringify({ schema_version: VERSION, ok: true, data: { claim_id: claimId, status: pending.status, award }, next_actions: [] }, null, 2)}\n`);
}

const commands = { init, bootstrap, "action-complete": actionComplete, presence, avatar, define, track, context, report, claim, "claim-list": claimList, review, "design-request": designRequest, "design-list": designList, "design-submit": designSubmit, "diagnostic-request": diagnosticRequest, "diagnostic-list": diagnosticList, "diagnostic-submit": diagnosticSubmit };
try {
  if (!commands[command]) fail("COMMAND_UNKNOWN", "Use init, bootstrap, action-complete, presence, avatar, define, track, context, report, claim, claim-list, review, design-request, design-list, design-submit, diagnostic-request, diagnostic-list, or diagnostic-submit", "command", false);
  await commands[command]();
} catch (error) {
  const known = error instanceof CliError;
  process.stderr.write(`${JSON.stringify({
    schema_version: VERSION,
    ok: false,
    error: {
      code: known ? error.code : "INTERNAL_ERROR",
      message: known ? error.message : "The achievement operation failed unexpectedly.",
      ...(known && error.field ? { field: error.field } : {}),
      retryable: known ? error.retryable : false
    }
  }, null, 2)}\n`);
  process.exitCode = 1;
}
