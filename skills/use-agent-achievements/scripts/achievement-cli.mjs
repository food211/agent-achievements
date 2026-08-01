#!/usr/bin/env node

import { appendFile, copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
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
const avatarExtensions = ["png", "jpg", "jpeg", "webp", "svg"];
const tierConfig = { bronze: { label: "铜牌", points: 10 }, silver: { label: "银牌", points: 30 }, gold: { label: "金牌", points: 100 } };

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

function fail(code, message, field) {
  process.stderr.write(`${JSON.stringify({ schema_version: VERSION, ok: false, error: { code, message, field, retryable: true } }, null, 2)}\n`);
  process.exit(1);
}

async function loadState() {
  if (!existsSync(statePath)) fail("STATE_NOT_FOUND", `Run init first; missing ${statePath}`);
  return JSON.parse(await readFile(statePath, "utf8"));
}

async function saveState(state) {
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function readInput() {
  const input = option("input");
  if (!input) fail("INPUT_REQUIRED", "Pass a JSON file with --input", "input");
  return JSON.parse(await readFile(path.resolve(input), "utf8"));
}

async function init() {
  await mkdir(root, { recursive: true });
  if (!existsSync(statePath)) {
    await saveState({
      schema_version: VERSION,
      achievements: [],
      progress: {},
      tracked: [],
      awards: [],
      processed_event_ids: []
    });
  }
  if (!existsSync(eventsPath)) await writeFile(eventsPath, "", "utf8");
  if (!existsSync(claimsPath)) await writeFile(claimsPath, "", "utf8");
  if (!existsSync(presencePath)) await writeFile(presencePath, `${JSON.stringify({ schema_version: VERSION, sessions: [] }, null, 2)}\n`, "utf8");
  if (!existsSync(designRequestsPath)) await writeFile(designRequestsPath, `${JSON.stringify({ schema_version: VERSION, requests: [] }, null, 2)}\n`, "utf8");
  if (!existsSync(diagnosticRequestsPath)) await writeFile(diagnosticRequestsPath, `${JSON.stringify({ schema_version: VERSION, requests: [] }, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ schema_version: VERSION, ok: true, data: { root } }, null, 2)}\n`);
}

async function presence() {
  await mkdir(root, { recursive: true });
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
  const document = existsSync(presencePath)
    ? JSON.parse(await readFile(presencePath, "utf8"))
    : { schema_version: VERSION, sessions: [] };
  const sessions = document.sessions.filter((item) => item.session_id !== sessionId && new Date(item.expires_at).getTime() > now.getTime());
  if (status !== "stopped") sessions.push(update);
  await writeFile(presencePath, `${JSON.stringify({ schema_version: VERSION, sessions }, null, 2)}\n`, "utf8");
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
  const state = await loadState();
  const designDocument = existsSync(designRequestsPath) ? JSON.parse(await readFile(designRequestsPath, "utf8")) : { requests: [] };
  const diagnosticDocument = existsSync(diagnosticRequestsPath) ? JSON.parse(await readFile(diagnosticRequestsPath, "utf8")) : { requests: [] };
  const designRequests = (designDocument.requests || []).filter((item) => item.status === "pending").slice(0, 3).map((item) => ({ request_id: item.request_id, brief: item.brief }));
  const diagnosticRequests = (diagnosticDocument.requests || []).filter((item) => item.status === "pending").slice(0, 2).map((item) => ({ request_id: item.request_id, reason: item.reason }));
  const agentId = option("agent");
  if (!agentId) fail("AGENT_REQUIRED", "Pass --agent", "agent_id");
  const tracked = state.achievements
    .filter((item) => state.tracked.includes(item.achievement_id))
    .slice(0, 3)
    .map((item) => ({
      ...achievementTier(item),
      achievement_id: item.achievement_id,
      title: item.title,
      progress: {
        current: state.progress[item.achievement_id] || 0,
        target: item.condition.target,
        unit: item.condition.unit
      },
      encouragement: item.tracking.encouragement,
      guardrails: item.tracking.guardrails
    }));
  const recentlyAwarded = state.awards.slice(-3).map((award) => ({
    ...achievementTier(state.achievements.find((item) => item.achievement_id === award.achievement_id)),
    achievement_id: award.achievement_id,
    title: state.achievements.find((item) => item.achievement_id === award.achievement_id)?.title || award.achievement_id,
    human_feedback: award.human_feedback,
    evidence_summary: award.evidence_summary,
    ...(award.awarded_by ? { awarded_by: award.awarded_by } : {}),
    ...(award.source_skill ? { source_skill: award.source_skill } : {})
  }));
  const payload = {
    schema_version: VERSION,
    agent_id: agentId,
    recently_awarded: recentlyAwarded,
    tracked,
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
    const designs = designRequests.length
      ? designRequests.map((item) => `- **${item.request_id}** — ${item.brief}`).join("\n")
      : "- 当前没有等待设计的成就。";
    const diagnostics = diagnosticRequests.length
      ? diagnosticRequests.map((item) => `- **${item.request_id}** — ${item.reason === "first_run" ? "首次回顾已完成的正向成果" : "重新回顾 Skill 带来的正向成果"}`).join("\n")
      : "- 当前没有等待处理的成就诊断。";
    process.stdout.write(`# 我的成就\n\n## 最近获得\n\n${awards}\n\n## 当前追踪\n\n${goals}\n\n## 等待 Agent 设计\n\n${designs}\n\n## 等待初始化诊断\n\n${diagnostics}\n\n优先级：用户指令 ＞ 安全与项目规则 ＞ 正确性 ＞ 追踪成就\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

async function designRequest() {
  await mkdir(root, { recursive: true });
  const brief = String(option("brief", "")).trim();
  if (!brief || brief.length > 1000) fail("DESIGN_BRIEF_INVALID", "Brief must be 1-1000 characters", "brief");
  const document = existsSync(designRequestsPath) ? JSON.parse(await readFile(designRequestsPath, "utf8")) : { schema_version: VERSION, requests: [] };
  const request = {
    schema_version: VERSION,
    request_id: `design-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    brief,
    status: "pending",
    created_at: new Date().toISOString()
  };
  document.requests ||= [];
  document.requests.push(request);
  await writeFile(designRequestsPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
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
  const document = existsSync(designRequestsPath) ? JSON.parse(await readFile(designRequestsPath, "utf8")) : { schema_version: VERSION, requests: [] };
  const request = (document.requests || []).find((item) => item.request_id === proposal.request_id);
  if (!request) fail("DESIGN_REQUEST_NOT_FOUND", `Unknown request: ${proposal.request_id}`, "request_id");
  request.status = "proposed";
  request.proposal = proposal;
  await writeFile(designRequestsPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ schema_version: VERSION, ok: true, data: { request_id: request.request_id, status: request.status }, next_actions: [] }, null, 2)}\n`);
}

async function diagnosticRequest() {
  await mkdir(root, { recursive: true });
  const reason = option("reason", "manual");
  if (!new Set(["first_run", "skills_changed", "manual"]).has(reason)) fail("DIAGNOSTIC_REASON_INVALID", "Use first_run, skills_changed, or manual", "reason");
  const document = existsSync(diagnosticRequestsPath) ? JSON.parse(await readFile(diagnosticRequestsPath, "utf8")) : { schema_version: VERSION, requests: [] };
  const existing = (document.requests || []).find((item) => item.status === "pending");
  if (existing) {
    process.stdout.write(`${JSON.stringify({ schema_version: VERSION, ok: true, data: existing, next_actions: [{ action: "diagnose_past_achievements", request_id: existing.request_id }] }, null, 2)}\n`);
    return;
  }
  const request = {
    schema_version: VERSION,
    request_id: `diagnostic-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    reason,
    status: "pending",
    created_at: new Date().toISOString(),
    settled_discovery_ids: []
  };
  document.requests ||= [];
  document.requests.push(request);
  await writeFile(diagnosticRequestsPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
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
  const document = existsSync(diagnosticRequestsPath) ? JSON.parse(await readFile(diagnosticRequestsPath, "utf8")) : { schema_version: VERSION, requests: [] };
  const request = (document.requests || []).find((item) => item.request_id === report.request_id);
  if (!request) fail("DIAGNOSTIC_REQUEST_NOT_FOUND", `Unknown request: ${report.request_id}`, "request_id");
  request.status = "reported";
  request.report = report;
  request.settled_discovery_ids ||= [];
  await writeFile(diagnosticRequestsPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ schema_version: VERSION, ok: true, data: { request_id: request.request_id, status: request.status }, next_actions: [] }, null, 2)}\n`);
}

async function define() {
  const state = await loadState();
  const achievement = await readInput();
  if (achievement.schema_version !== VERSION) fail("VERSION_UNSUPPORTED", `Expected ${VERSION}`, "schema_version");
  if (!achievement.achievement_id || !achievement.title || !achievement.condition?.event_types?.length || !achievement.tracking) {
    fail("ACHIEVEMENT_INVALID", "achievement_id, title, condition.event_types, and tracking are required", "achievement");
  }
  const index = state.achievements.findIndex((item) => item.achievement_id === achievement.achievement_id);
  if (index >= 0) state.achievements[index] = achievement;
  else state.achievements.push(achievement);
  state.progress[achievement.achievement_id] ??= 0;
  await saveState(state);
  process.stdout.write(`${JSON.stringify({ schema_version: VERSION, ok: true, data: { achievement_id: achievement.achievement_id, created: index < 0 }, next_actions: [] }, null, 2)}\n`);
}

async function track() {
  const state = await loadState();
  const achievementId = option("achievement");
  const enabled = option("enabled", "true") !== "false";
  const achievement = state.achievements.find((item) => item.achievement_id === achievementId);
  if (!achievement) fail("ACHIEVEMENT_NOT_FOUND", `Unknown achievement: ${achievementId}`, "achievement_id");
  if (enabled && !achievement.tracking.allowed) fail("TRACKING_NOT_ALLOWED", "This achievement cannot be actively tracked", "achievement_id");
  const next = new Set(state.tracked);
  if (enabled) next.add(achievementId);
  else next.delete(achievementId);
  if (next.size > 3) fail("TRACKING_LIMIT", "An agent may track at most three achievements", "tracked");
  state.tracked = [...next];
  await saveState(state);
  process.stdout.write(`${JSON.stringify({ schema_version: VERSION, ok: true, data: { achievement_id: achievementId, tracked: enabled }, next_actions: [] }, null, 2)}\n`);
}

async function report() {
  const state = await loadState();
  const event = await readInput();
  if (event.schema_version !== VERSION) fail("VERSION_UNSUPPORTED", `Expected ${VERSION}`, "schema_version");
  if (!event.event_id || !event.event_type) fail("EVENT_INVALID", "event_id and event_type are required", "event");
  if (state.processed_event_ids.includes(event.event_id)) {
    process.stdout.write(`${JSON.stringify({ schema_version: VERSION, ok: true, data: { accepted: true, duplicate: true, event_id: event.event_id }, next_actions: [] }, null, 2)}\n`);
    return;
  }
  const updates = [];
  for (const achievement of state.achievements) {
    if (!achievement.condition.event_types.includes(event.event_type)) continue;
    const previous = state.progress[achievement.achievement_id] || 0;
    const current = Math.min(previous + 1, achievement.condition.target);
    state.progress[achievement.achievement_id] = current;
    updates.push({
      achievement_id: achievement.achievement_id,
      previous,
      current,
      target: achievement.condition.target,
      state: current >= achievement.condition.target ? "claimable" : "progressed"
    });
  }
  state.processed_event_ids.push(event.event_id);
  await appendFile(eventsPath, `${JSON.stringify(event)}\n`, "utf8");
  await saveState(state);
  const nextActions = updates.filter((item) => item.state === "claimable").map((item) => ({ action: "submit_claim", achievement_id: item.achievement_id }));
  process.stdout.write(`${JSON.stringify({ schema_version: VERSION, ok: true, data: { accepted: true, duplicate: false, event_id: event.event_id, progress_updates: updates }, next_actions: nextActions }, null, 2)}\n`);
}

async function claim() {
  await loadState();
  const claim = await readInput();
  if (claim.schema_version !== VERSION) fail("VERSION_UNSUPPORTED", `Expected ${VERSION}`, "schema_version");
  if (!claim.claim_id || !claim.achievement_id || !claim.agent_id || !claim.evidence?.length) {
    fail("CLAIM_INVALID", "claim_id, achievement_id, agent_id, and evidence are required", "claim");
  }
  const existing = existsSync(claimsPath) ? await readFile(claimsPath, "utf8") : "";
  if (!existing.split(/\r?\n/).filter(Boolean).some((line) => JSON.parse(line).claim_id === claim.claim_id)) {
    await appendFile(claimsPath, `${JSON.stringify({ ...claim, status: "pending_human_review" })}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify({ schema_version: VERSION, ok: true, data: { claim_id: claim.claim_id, status: "pending_human_review", message: "Continue the primary task; achievement review is non-blocking." }, next_actions: [] }, null, 2)}\n`);
}

const commands = { init, presence, avatar, define, track, context, report, claim, "design-request": designRequest, "design-list": designList, "design-submit": designSubmit, "diagnostic-request": diagnosticRequest, "diagnostic-list": diagnosticList, "diagnostic-submit": diagnosticSubmit };
if (!commands[command]) fail("COMMAND_UNKNOWN", "Use init, presence, avatar, define, track, context, report, claim, design-request, design-list, design-submit, diagnostic-request, diagnostic-list, or diagnostic-submit", "command");
await commands[command]();
