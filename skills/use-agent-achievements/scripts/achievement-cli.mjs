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
const avatarExtensions = ["png", "jpg", "jpeg", "webp", "svg"];

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
  const agentId = option("agent");
  if (!agentId) fail("AGENT_REQUIRED", "Pass --agent", "agent_id");
  const tracked = state.achievements
    .filter((item) => state.tracked.includes(item.achievement_id))
    .slice(0, 3)
    .map((item) => ({
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
    achievement_id: award.achievement_id,
    title: state.achievements.find((item) => item.achievement_id === award.achievement_id)?.title || award.achievement_id,
    human_feedback: award.human_feedback,
    evidence_summary: award.evidence_summary
  }));
  const payload = {
    schema_version: VERSION,
    agent_id: agentId,
    recently_awarded: recentlyAwarded,
    tracked,
    operating_priority: ["current_user_instruction", "safety_and_project_rules", "task_correctness", "tracked_achievements"]
  };
  if (option("format", "json") === "markdown") {
    const awards = recentlyAwarded.length
      ? recentlyAwarded.map((item) => `- **${item.title}** — ${item.human_feedback}`).join("\n")
      : "- 暂无与当前任务相关的新成就。";
    const goals = tracked.length
      ? tracked.map((item) => `- **${item.title}** · ${item.progress.current}/${item.progress.target}\n  ${item.encouragement}\n  边界：${item.guardrails.join("；")}`).join("\n")
      : "- 当前没有主动追踪的成就。";
    process.stdout.write(`# 我的成就\n\n## 最近获得\n\n${awards}\n\n## 当前追踪\n\n${goals}\n\n优先级：用户指令 ＞ 安全与项目规则 ＞ 正确性 ＞ 追踪成就\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
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

const commands = { init, presence, avatar, define, track, context, report, claim };
if (!commands[command]) fail("COMMAND_UNKNOWN", "Use init, presence, avatar, define, track, context, report, or claim", "command");
await commands[command]();
