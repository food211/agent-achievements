const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, screen, shell, Tray } = require("electron");
const { DEFAULT_SIZE: BUBBLE_SIZE, bubbleMessage, bubblePlacement } = require("./companion-bubble.cjs");
const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  agentBlockedAchievementIds,
  alignAutopilotTracking,
  buildAgentConnectionContext,
  buildAutopilotView,
  buildHumanAchievement,
  ensureDefaultWuxingChallenges,
  queueWuxingDiagnosticAction,
  reviewPendingClaim,
  settleDiagnosticReport,
  settleTrustedAutomaticClaims,
  setAgentAchievementBlocked,
  tierMetadata,
  updateTrackedIds
} = require("./achievement-factory.cjs");
const { createAgentConnectionServer } = require("./agent-connection-server.cjs");
const { createAgentAdapterFactory } = require("./agent-adapter-factory.cjs");
const {
  BRIDGE_RESTART_COOLDOWN_MS,
  BRIDGE_SWEEP_INTERVAL_MS,
  bridgeStatusIsFresh,
  processIsAlive,
  safeBridgeCommand
} = require("./bridge-supervisor.cjs");
const { calculateDockedBounds, calculateDraggedBounds, clamp, equalBounds, nearestDock } = require("./geometry.cjs");

const DATA_HOME = path.resolve(process.env.AGENT_ACHIEVEMENTS_HOME || path.join(os.homedir(), ".agent-achievements"));
const STATE_PATH = path.join(DATA_HOME, "state.json");
const PRESENCE_PATH = path.join(DATA_HOME, "presence.json");
const SETTINGS_PATH = path.join(DATA_HOME, "companion-settings.json");
const DESIGN_REQUESTS_PATH = path.join(DATA_HOME, "achievement-design-requests.json");
const DIAGNOSTICS_PATH = path.join(DATA_HOME, "achievement-diagnostics.json");
const CLAIMS_PATH = path.join(DATA_HOME, "claims.jsonl");
const EVENTS_PATH = path.join(DATA_HOME, "events.jsonl");
const COMPANION_STATUS_PATH = path.join(DATA_HOME, "companion-status.json");
const STATE_LOCK_PATH = path.join(DATA_HOME, ".achievement-cli.lock");
const COLLAPSED = { width: 94, height: 100 };
const EXPANDED = { width: 430, height: 650 };
const SNAP_DISTANCE = 34;
const EDGE_PEEK = 30;
const AVATAR_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "svg"];
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const TRAY_ICON_PATH = path.join(__dirname, process.platform === "win32" ? "tray-icon.ico" : "tray-icon.png");
const APP_DISPLAY_NAME = "五行 Harness 助手";

app.setName(APP_DISPLAY_NAME);

let window;
let tray;
let agentConnectionServer;
let agentAdapters;
let expanded = false;
let bubbleWindow = null;
let bubbleTimer = null;
let bubbleMode = null;
let previousBubblePayload = null;
let lastPayload = "";
let quitting = false;
let movingProgrammatically = false;
let hideTimer;
let petDrag = null;
let collapsedRestoreBounds = null;
let transitionFallback;
let avatarCache = { key: "", value: null };
let lastCompanionHeartbeat = 0;
let lastBridgeSweep = 0;
const supervisedBridges = new Map();
const settingsExistedAtLaunch = fs.existsSync(SETTINGS_PATH);
let companionSettings = readJson(SETTINGS_PATH, { dock: null, free_bounds: null, always_on_top: true });

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeSettings() {
  fs.mkdirSync(DATA_HOME, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, `${JSON.stringify(companionSettings, null, 2)}\n`, "utf8");
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}

function writeTextAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, value, "utf8");
  fs.renameSync(temporary, file);
}

function acquireStateLock(optional = false) {
  fs.mkdirSync(DATA_HOME, { recursive: true });
  const deadline = Date.now() + 2_000;
  const waitBuffer = new Int32Array(new SharedArrayBuffer(4));
  while (true) {
    try {
      fs.mkdirSync(STATE_LOCK_PATH);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const info = (() => { try { return fs.statSync(STATE_LOCK_PATH); } catch { return null; } })();
      if (info && Date.now() - info.mtimeMs > 30_000) {
        fs.rmSync(STATE_LOCK_PATH, { recursive: true, force: true });
        continue;
      }
      if (optional) return null;
      if (Date.now() >= deadline) throw new Error("state-busy");
      Atomics.wait(waitBuffer, 0, 0, 25);
    }
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    fs.rmSync(STATE_LOCK_PATH, { recursive: true, force: true });
  };
}

function jsonLineRecords(file) {
  try { return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse); }
  catch { return []; }
}

function claimRecords() { return jsonLineRecords(CLAIMS_PATH); }

function eventRecords() { return jsonLineRecords(EVENTS_PATH); }

function emptyState() {
  return {
    schema_version: "agent-achievements/v1",
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
  };
}

function legacyAutopilotBlockedIds() {
  return Array.isArray(companionSettings.autopilot_blocked_ids)
    ? companionSettings.autopilot_blocked_ids.filter((item) => typeof item === "string" && item)
    : [];
}

function effectiveAutopilotBlockedIds(state, agentId, workspace = null) {
  return [...new Set([...agentBlockedAchievementIds(state, agentId, workspace), ...legacyAutopilotBlockedIds()])];
}

function migrateLegacyAutopilotBlocks(state, agentId, workspace = null) {
  const legacyIds = legacyAutopilotBlockedIds();
  if (!agentId || !Object.prototype.hasOwnProperty.call(companionSettings, "autopilot_blocked_ids")) return false;
  let changed = false;
  for (const achievementId of legacyIds) {
    const result = setAgentAchievementBlocked(state, agentId, achievementId, true, workspace);
    changed ||= result.changed;
  }
  const { autopilot_blocked_ids: _legacy, ...settings } = companionSettings;
  companionSettings = settings;
  writeSettings();
  return changed;
}

function prepareAutopilotState(state, agentId, workspace = null) {
  let workspaceMigrated = false;
  if (agentId && workspace) {
    for (const collection of [state.progress_records, state.tracking_records, state.tracking_preferences, state.awards]) {
      for (const record of collection || []) {
        if (record.agent_id === agentId && !record.workspace) {
          record.workspace = workspace;
          workspaceMigrated = true;
        }
      }
    }
    for (const achievement of state.achievements || []) {
      const humanCreated = achievement.origin === "human_created" || achievement.extensions?.created_by === "human";
      if (humanCreated && !achievement.extensions?.workspace) {
        achievement.extensions = { ...(achievement.extensions || {}), workspace };
        workspaceMigrated = true;
      }
    }
  }
  const migrated = migrateLegacyAutopilotBlocks(state, agentId, workspace);
  const defaults = ensureDefaultWuxingChallenges(state);
  const tracking = alignAutopilotTracking(defaults.state, { agentId, workspace });
  return { state: tracking.state, changed: workspaceMigrated || migrated || defaults.changed || tracking.changed };
}

function completeSatisfiedRuntimeActions(state) {
  let changed = false;
  const connectedAgents = new Set((agentConnectionServer?.sessions() || []).map((item) => item.agent_id));
  for (const action of state.agent_actions || []) {
    if (action.status !== "pending") continue;
    const companionReady = action.action === "ensure_companion_running";
    const bridgeReady = action.action === "ensure_agent_bridge" && connectedAgents.has(action.agent_id);
    if (!companionReady && !bridgeReady) continue;
    action.status = "completed";
    action.completed_at = new Date().toISOString();
    action.completion_summary = companionReady ? "Companion heartbeat detected." : "Authenticated Agent bridge connected.";
    changed = true;
  }
  return changed;
}

function ensureCompanionData() {
  const release = acquireStateLock(true);
  if (!release) return;
  try {
    if (!fs.existsSync(STATE_PATH)) writeJsonAtomic(STATE_PATH, emptyState());
    if (!fs.existsSync(PRESENCE_PATH)) writeJsonAtomic(PRESENCE_PATH, { schema_version: "agent-achievements/v1", sessions: [] });
    if (!fs.existsSync(DESIGN_REQUESTS_PATH)) writeJsonAtomic(DESIGN_REQUESTS_PATH, { schema_version: "agent-achievements/v1", requests: [] });
    if (!fs.existsSync(DIAGNOSTICS_PATH)) writeJsonAtomic(DIAGNOSTICS_PATH, { schema_version: "agent-achievements/v1", requests: [] });
    if (!fs.existsSync(CLAIMS_PATH)) writeTextAtomic(CLAIMS_PATH, "");
    if (!fs.existsSync(EVENTS_PATH)) writeTextAtomic(EVENTS_PATH, "");
    const prepared = prepareAutopilotState(readJson(STATE_PATH, emptyState()));
    if (prepared.changed) writeJsonAtomic(STATE_PATH, prepared.state);
  } finally {
    release();
  }
}

function writeCompanionStatus(status = "running", force = false) {
  const now = Date.now();
  if (!force && status === "running" && now - lastCompanionHeartbeat < 5000) return;
  writeJsonAtomic(COMPANION_STATUS_PATH, {
    schema_version: "agent-achievements/v1",
    status,
    observed_at: new Date(now).toISOString(),
    pid: process.pid
  });
  lastCompanionHeartbeat = now;
}

function bridgeStatusPath(agentId) {
  const digest = createHash("sha256").update(String(agentId), "utf8").digest("hex").slice(0, 16);
  return path.join(DATA_HOME, "bridges", `${digest}.json`);
}

function bridgeIsFresh(agentId) {
  if ((agentConnectionServer?.sessions() || []).some((item) => item.agent_id === agentId)) return true;
  const status = readJson(bridgeStatusPath(agentId), null);
  return bridgeStatusIsFresh(status, { agentId });
}

function superviseAgentBridges(force = false) {
  const now = Date.now();
  if (!force && now - lastBridgeSweep < BRIDGE_SWEEP_INTERVAL_MS) return;
  lastBridgeSweep = now;
  const state = readJson(STATE_PATH, emptyState());
  for (const adapter of state.adapters || []) {
    if (!adapter.agent_id || bridgeIsFresh(adapter.agent_id)) continue;
    const existing = supervisedBridges.get(adapter.agent_id);
    if (existing?.running && !processIsAlive(existing.child?.pid)) existing.running = false;
    if (existing?.running || now - (existing?.startedAt || 0) < BRIDGE_RESTART_COOLDOWN_MS) continue;
    const command = safeBridgeCommand(adapter, { dataHome: DATA_HOME });
    if (!command) continue;
    try {
      const child = spawn(command.program, command.args, {
        cwd: command.cwd,
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        shell: false,
        env: { ...process.env, AGENT_ACHIEVEMENTS_HOME: DATA_HOME }
      });
      const record = { child, running: true, startedAt: now };
      supervisedBridges.set(adapter.agent_id, record);
      child.once("exit", () => { record.running = false; });
      child.once("error", () => { record.running = false; });
      child.unref();
    } catch {
      supervisedBridges.set(adapter.agent_id, { child: null, running: false, startedAt: now });
    }
  }
}

function activeSessions() {
  const now = Date.now();
  const presence = readJson(PRESENCE_PATH, { sessions: [] });
  const sessions = new Map((presence.sessions || [])
    .filter((session) => session.status !== "stopped" && new Date(session.expires_at).getTime() > now)
    .map((session) => [session.session_id, session]));
  for (const session of agentConnectionServer?.sessions() || []) {
    for (const [sessionId, existing] of sessions) {
      if (existing.agent_id === session.agent_id
        && existing.workspace === session.workspace
        && (existing.runtime?.id || "") === (session.runtime?.id || "")) sessions.delete(sessionId);
    }
    sessions.set(session.session_id, session);
  }
  const knownTargets = new Set([...sessions.values()].map((item) => `${item.agent_id}\u0000${item.runtime?.id || ""}\u0000${item.workspace || ""}`));
  const adapters = readJson(STATE_PATH, emptyState()).adapters || [];
  for (const adapter of [...adapters].reverse()) {
    if (!adapter.workspace || !fs.existsSync(adapter.workspace)) continue;
    const workspace = path.resolve(adapter.workspace);
    const runtimeId = adapter.runtime || "generic-agent";
    const targetKey = `${adapter.agent_id || "agent-local"}\u0000${runtimeId}\u0000${workspace}`;
    if (knownTargets.has(targetKey)) continue;
    knownTargets.add(targetKey);
    const target = { agent_id: adapter.agent_id || "agent-local", runtime_id: runtimeId, workspace };
    const conversation = agentAdapters?.stateFor(target);
    sessions.set(`known:${createHash("sha256").update(targetKey).digest("hex").slice(0, 16)}`, {
      schema_version: "agent-achievements/v1",
      session_id: `known-${createHash("sha256").update(targetKey).digest("hex").slice(0, 16)}`,
      agent_id: target.agent_id,
      runtime: { id: runtimeId },
      workspace,
      status: conversation?.status === "streaming" ? "active" : "idle",
      observed_at: new Date(now).toISOString(),
      expires_at: new Date(now + 365 * 24 * 60 * 60_000).toISOString(),
      extensions: { transport: "companion_agent_adapter", adapter_id: agentAdapters?.adapterIdForRuntime(runtimeId), connected: Boolean(conversation), prompt_injection: "host_native" }
    });
  }
  const unique = new Map();
  for (const session of sessions.values()) {
    const key = `${session.agent_id}\u0000${session.runtime?.id || ""}\u0000${session.workspace || ""}`;
    const current = unique.get(key);
    if (!current || session.status === "active" || Date.parse(session.observed_at || 0) > Date.parse(current.observed_at || 0)) unique.set(key, session);
  }
  return [...unique.values()];
}

function adapterTarget(session) {
  return session?.workspace ? { agent_id: session.agent_id, runtime_id: session.runtime?.id || "", workspace: session.workspace } : null;
}

function focusedSession(sessions = activeSessions()) {
  const selected = companionSettings.focus_workspace;
  return sessions.find((item) => item.agent_id === selected?.agent_id && item.workspace === selected?.workspace && (!selected?.runtime_id || item.runtime?.id === selected.runtime_id))
    || sessions.find((item) => item.status === "active")
    || sessions[0]
    || null;
}

function setFocusWorkspace(agentId, workspace, runtimeId = "") {
  const session = activeSessions().find((item) => item.agent_id === agentId && item.workspace === workspace && (!runtimeId || item.runtime?.id === runtimeId));
  if (!session) throw new Error("workspace-not-connected");
  companionSettings = { ...companionSettings, focus_workspace: { agent_id: agentId, runtime_id: session.runtime?.id || "", workspace } };
  writeSettings();
  lastPayload = "";
  sync();
  agentAdapters?.connect(adapterTarget(session)).catch(() => { lastPayload = ""; sync(); });
  return { agent_id: agentId, runtime_id: session.runtime?.id || "", workspace };
}

function avatarFiles() { return AVATAR_EXTENSIONS.map((ext) => path.join(DATA_HOME, `avatar.${ext}`)); }

function readAvatar() {
  const file = avatarFiles().find((candidate) => fs.existsSync(candidate));
  if (!file) return null;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > AVATAR_MAX_BYTES) return null;
    const key = `${file}:${stat.mtimeMs}:${stat.size}`;
    if (avatarCache.key === key) return avatarCache.value;
    const ext = path.extname(file).slice(1).toLowerCase();
    const mime = ext === "svg" ? "image/svg+xml" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
    const value = { dataUrl: `data:${mime};base64,${fs.readFileSync(file).toString("base64")}` };
    avatarCache = { key, value };
    return value;
  } catch { return null; }
}

function clearAvatarFiles() {
  for (const file of avatarFiles()) {
    try { fs.unlinkSync(file); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  avatarCache = { key: "", value: null };
}

function diagnosticDocument() {
  return readJson(DIAGNOSTICS_PATH, { schema_version: "agent-achievements/v1", requests: [] });
}

function createDiagnosticRequest(reason = "manual", agentId = null, workspace = null) {
  const document = diagnosticDocument();
  const existing = (document.requests || []).find((item) => item.status === "pending" && (!agentId || item.agent_id === agentId) && (!workspace || item.workspace === workspace));
  if (existing) return existing;
  const request = {
    schema_version: "agent-achievements/v1",
    request_id: `diagnostic-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    reason,
    ...(agentId ? { agent_id: agentId } : {}),
    ...(workspace ? { workspace } : {}),
    status: "pending",
    created_at: new Date().toISOString(),
    settled_discovery_ids: []
  };
  document.requests ||= [];
  document.requests.push(request);
  writeJsonAtomic(DIAGNOSTICS_PATH, document);
  return request;
}

function ensureInitialDiagnostic() {
  const release = acquireStateLock();
  try {
    const document = diagnosticDocument();
    if (!(document.requests || []).length) createDiagnosticRequest("first_run");
  } finally {
    release();
  }
}

function settleReportedDiagnostics(confirm = null) {
  const document = diagnosticDocument();
  const state = readJson(STATE_PATH, {
    schema_version: "agent-achievements/v1", achievements: [], progress: {}, tracked: [], awards: [], processed_event_ids: []
  });
  let changed = false;
  for (const request of document.requests || []) {
    if (!request.report || !["reported", "settled"].includes(request.status)) continue;
    const before = new Set(request.settled_discovery_ids || []);
    const result = settleDiagnosticReport(state, request.report, {
      confirmDiscoveryId: confirm?.requestId === request.request_id ? confirm.discoveryId : undefined,
      workspace: request.workspace
    });
    for (const award of result.awarded) before.add(award.discovery_id);
    request.settled_discovery_ids = [...before];
    const total = request.report.discoveries.length;
    request.status = request.settled_discovery_ids.length >= total ? "settled" : "reported";
    if (result.awarded.length) changed = true;
  }
  if (changed) {
    writeJsonAtomic(STATE_PATH, state);
    writeJsonAtomic(DIAGNOSTICS_PATH, document);
    lastPayload = "";
  }
  return { changed, document };
}

function installAvatar(source) {
  const ext = path.extname(source).slice(1).toLowerCase();
  if (!AVATAR_EXTENSIONS.includes(ext)) throw new Error("unsupported-avatar-format");
  const stat = fs.statSync(source);
  if (!stat.isFile() || stat.size > AVATAR_MAX_BYTES) throw new Error("avatar-too-large");
  fs.mkdirSync(DATA_HOME, { recursive: true });
  clearAvatarFiles();
  fs.copyFileSync(source, path.join(DATA_HOME, `avatar.${ext}`));
  avatarCache = { key: "", value: null };
}

function sameWorkspace(record, workspace) {
  return workspace ? record?.workspace === workspace : !record?.workspace;
}

function agentProgress(state, achievementId, agentId, workspace = null) {
  const record = agentId
    ? state.progress_records?.find((item) => item.agent_id === agentId && item.achievement_id === achievementId && sameWorkspace(item, workspace))
    : null;
  const value = agentId
    ? record?.current
      ?? state.progress_by_agent?.[agentId]?.[achievementId]
      ?? state.agent_progress?.[agentId]?.[achievementId]
      ?? (Array.isArray(state.progress_records) ? 0 : state.progress?.[achievementId])
    : state.progress?.[achievementId];
  if (Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (Number.isFinite(value?.current)) return Math.max(0, Math.floor(value.current));
  return 0;
}

function agentTrackedIds(state, agentId, workspace = null) {
  const trackedIds = !agentId
    ? state.tracked || []
    : Array.isArray(state.tracking_records)
      ? state.tracking_records.find((item) => item.agent_id === agentId && sameWorkspace(item, workspace))?.achievement_ids || []
      : state.tracked || [];
  const blockedIds = new Set(effectiveAutopilotBlockedIds(state, agentId, workspace));
  return trackedIds.filter((item) => !blockedIds.has(item));
}

function connectionContext(agentId, workspace = null) {
  const state = readJson(STATE_PATH, emptyState());
  const visibleState = {
    ...state,
    agent_actions: (state.agent_actions || []).filter((item) => item.action !== "ensure_companion_running" && !(item.action === "ensure_agent_bridge" && item.agent_id === agentId))
  };
  return buildAgentConnectionContext(visibleState, eventRecords(), agentId, {
    autostartEnabled: getAutostart(),
    workspace,
    blockedIds: effectiveAutopilotBlockedIds(state, agentId, workspace)
  });
}

function currentPayload() {
  let state = readJson(STATE_PATH, emptyState());
  let claimsDocument = claimRecords();
  const reconciliationLock = acquireStateLock(true);
  if (reconciliationLock) {
    try {
      if (!fs.existsSync(STATE_PATH)) writeJsonAtomic(STATE_PATH, emptyState());
      settleReportedDiagnostics();
      state = readJson(STATE_PATH, emptyState());
      claimsDocument = claimRecords();
      const sessionsForPlan = activeSessions();
      const focusSessionForPlan = focusedSession(sessionsForPlan);
      const eventsForPlan = eventRecords();
      const focusAgentForPlan = focusSessionForPlan?.agent_id || state.awards?.at(-1)?.agent_id || eventsForPlan.at(-1)?.actor?.agent_id || null;
      const focusWorkspaceForPlan = focusSessionForPlan?.workspace || null;
      let claimsWorkspaceMigrated = false;
      if (focusAgentForPlan && focusWorkspaceForPlan) {
        for (const claim of claimsDocument) {
          if (claim.agent_id === focusAgentForPlan && !claim.workspace) {
            claim.workspace = focusWorkspaceForPlan;
            claimsWorkspaceMigrated = true;
          }
        }
      }
      const automatic = settleTrustedAutomaticClaims(state, claimsDocument);
      if (automatic.awarded.length) {
        writeJsonAtomic(STATE_PATH, automatic.state);
        writeTextAtomic(CLAIMS_PATH, `${automatic.claims.map((item) => JSON.stringify(item)).join("\n")}\n`);
        state = automatic.state;
        claimsDocument = automatic.claims;
        lastPayload = "";
      }
      if (claimsWorkspaceMigrated && !automatic.awarded.length) writeTextAtomic(CLAIMS_PATH, `${claimsDocument.map((item) => JSON.stringify(item)).join("\n")}\n`);
      const runtimeActionsChanged = completeSatisfiedRuntimeActions(state);
      const prepared = prepareAutopilotState(state, focusAgentForPlan, focusWorkspaceForPlan);
      if (prepared.changed || runtimeActionsChanged) {
        writeJsonAtomic(STATE_PATH, prepared.state);
        state = prepared.state;
      }
    } finally {
      reconciliationLock();
    }
  }
  const sessions = activeSessions();
  const focusSession = focusedSession(sessions);
  const events = eventRecords();
  const focusAgentId = focusSession?.agent_id || state.awards?.at(-1)?.agent_id || events.at(-1)?.actor?.agent_id || null;
  const focusRuntimeId = focusSession?.runtime?.id || null;
  const focusWorkspace = focusSession?.workspace || null;
  const achievements = state.achievements || [];
  const scopedAwards = (state.awards || []).filter((item) => (!focusAgentId || item.agent_id === focusAgentId) && sameWorkspace(item, focusWorkspace));
  const awardedIds = new Set(scopedAwards.map((item) => item.achievement_id));
  const automation = buildAutopilotView(state, events, {
    agentId: focusAgentId,
    workspace: focusWorkspace,
    autostartEnabled: getAutostart(),
    blockedIds: effectiveAutopilotBlockedIds(state, focusAgentId, focusWorkspace)
  });
  automation.connection_status = focusSession?.extensions?.connected
    ? focusSession.status === "active" ? "connected_active" : "connected_idle"
    : focusSession
      ? focusSession.status === "active" ? "heartbeat_active" : "heartbeat_idle"
      : "waiting";
  const trackedIds = agentTrackedIds(state, focusAgentId, focusWorkspace);
  const tracked = achievements.filter((item) => trackedIds.includes(item.achievement_id) && !awardedIds.has(item.achievement_id)).slice(0, 3).map((item) => ({
    ...tierMetadata(item),
    id: item.achievement_id,
    title: item.title,
    current: agentProgress(state, item.achievement_id, focusAgentId, focusWorkspace),
    target: item.condition?.target || 1,
    encouragement: item.tracking?.encouragement || item.intent
  }));
  const awards = scopedAwards.slice(-3).reverse().map((award) => ({
    ...award,
    ...tierMetadata(achievements.find((item) => item.achievement_id === award.achievement_id)),
    title: achievements.find((item) => item.achievement_id === award.achievement_id)?.title || award.achievement_id
  }));
  const catalog = achievements.filter((item) => {
    const autopilotManaged = item.extensions?.autopilot_managed || item.extensions?.created_by === "companion_autopilot";
    const humanCreated = item.origin === "human_created" || item.extensions?.created_by === "human";
    if (focusWorkspace && humanCreated && item.extensions?.workspace !== focusWorkspace) return false;
    if (item.origin === "system_discovered" && !autopilotManaged && focusAgentId) return awardedIds.has(item.achievement_id);
    return true;
  }).map((item) => {
    const createdBy = item.extensions?.created_by;
    const viewOrigin = createdBy === "companion_autopilot" || item.extensions?.autopilot_managed
      ? (awardedIds.has(item.achievement_id) ? "system_discovered" : "system_suggested")
      : item.origin === "system_discovered" || createdBy === "system"
        ? "system_discovered"
        : "human_created";
    return {
      ...tierMetadata(item),
      id: item.achievement_id,
      title: item.title,
      intent: item.intent,
      current: agentProgress(state, item.achievement_id, focusAgentId, focusWorkspace),
      target: item.condition?.target || 1,
      event_type: item.condition?.event_types?.[0] || "task.completed",
      encouragement: item.tracking?.encouragement || "",
      guardrails: (item.tracking?.guardrails || []).join("\n"),
      origin: viewOrigin,
      source_skill: item.extensions?.source_skill || null,
      discovery_reason: scopedAwards.find((award) => award.achievement_id === item.achievement_id)?.human_feedback || null,
      editable: viewOrigin === "human_created",
      tracking_allowed: item.tracking?.allowed !== false,
      tracked: trackedIds.includes(item.achievement_id),
      awarded: awardedIds.has(item.achievement_id)
    };
  });
  const designDocument = readJson(DESIGN_REQUESTS_PATH, { requests: [] });
  const designs = (designDocument.requests || [])
    .filter((item) => item.status !== "applied" && (!focusAgentId || !item.agent_id || item.agent_id === focusAgentId) && sameWorkspace(item, focusWorkspace))
    .slice(-5)
    .reverse();
  const diagnostics = diagnosticDocument();
  const latestDiagnostic = (diagnostics.requests || []).filter((item) => (!focusAgentId || !item.agent_id || item.agent_id === focusAgentId) && (!focusWorkspace || !item.workspace || item.workspace === focusWorkspace)).at(-1) || null;
  const settledIds = new Set(latestDiagnostic?.settled_discovery_ids || []);
  const pendingDiscoveries = (latestDiagnostic?.report?.discoveries || []).filter((item) => !settledIds.has(item.discovery_id));
  const claims = claimsDocument.filter((item) => item.status === "pending_human_review" && (!focusAgentId || item.agent_id === focusAgentId) && sameWorkspace(item, focusWorkspace)).slice(-5).reverse().map((claim) => {
    const achievement = achievements.find((item) => item.achievement_id === claim.achievement_id);
    const tier = tierMetadata(achievement);
    const current = agentProgress(state, claim.achievement_id, claim.agent_id, focusWorkspace);
    const target = achievement?.condition?.target || 1;
    const evidence = (claim.evidence || []).slice(0, 12).map((item) => ({ type: item.type, ref: item.ref, summary: item.summary || "" }));
    const evidenceSufficient = achievement?.evidence_required === false || evidence.length > 0;
    return {
      claim_id: claim.claim_id,
      title: achievement?.title || claim.achievement_id,
      summary: claim.summary,
      current,
      target,
      eligible: current >= target && evidenceSufficient,
      eligibility_reason: current < target ? "尚未达到目标" : evidenceSufficient ? "已达到目标" : "等待补充证据",
      evidence_count: claim.evidence?.length || 0,
      evidence,
      suggested_feedback: `我认可这次完成的结果：${claim.summary}`.slice(0, 600),
      tier_label: { bronze: "铜牌", silver: "银牌", gold: "金牌" }[tier.tier] || "铜牌",
      ...tier
    };
  });
  return { dataHome: DATA_HOME, sessions, focusAgentId, focusRuntimeId, focusWorkspace, tracked, awards, claims, catalog, designs, score: automation.score, automation, avatar: readAvatar(), agentConversation: agentAdapters?.stateFor(adapterTarget(focusSession)) || null, diagnostic: latestDiagnostic ? {
    request_id: latestDiagnostic.request_id,
    reason: latestDiagnostic.reason,
    status: latestDiagnostic.status,
    scanned_skills: latestDiagnostic.report?.sources?.skills?.length || 0,
    pending_discoveries: pendingDiscoveries
  } : null };
}

function reviewClaim(claimId, decision, feedback) {
  const release = acquireStateLock();
  let reviewed;
  try {
    const claims = claimRecords();
    const state = readJson(STATE_PATH, emptyState());
    reviewed = reviewPendingClaim(state, claims, claimId, decision, feedback);
    const prepared = prepareAutopilotState(reviewed.state, reviewed.claim.agent_id, reviewed.claim.workspace || null);
    writeJsonAtomic(STATE_PATH, prepared.state);
    writeTextAtomic(CLAIMS_PATH, `${reviewed.claims.map((item) => JSON.stringify(item)).join("\n")}\n`);
  } finally {
    release();
  }
  lastPayload = "";
  sync();
  return { claim_id: reviewed.claim.claim_id, status: reviewed.claim.status };
}

function currentWorkArea() {
  if (!window || window.isDestroyed()) return screen.getPrimaryDisplay().workArea;
  return screen.getDisplayMatching(window.getBounds()).workArea;
}

function setWindowBounds(bounds, animate = true) {
  if (equalBounds(window.getBounds(), bounds)) return;
  movingProgrammatically = true;
  window.setBounds(bounds, animate);
  setTimeout(() => { movingProgrammatically = false; }, 120);
}

function placeBubble() {
  if (!bubbleWindow || bubbleWindow.isDestroyed() || !window || window.isDestroyed()) return;
  const petBounds = window.getBounds();
  const work = screen.getDisplayMatching(petBounds).workArea;
  const size = bubbleMode === "chat" ? { width: 342, height: 318 } : BUBBLE_SIZE;
  const placement = bubblePlacement(petBounds, work, size);
  bubbleWindow.setBounds(placement.bounds, false);
  if (!bubbleWindow.webContents.isLoading()) bubbleWindow.webContents.send("companion:bubble-placement", placement);
  return placement;
}

function hideBubble() {
  clearTimeout(bubbleTimer);
  bubbleTimer = null;
  bubbleMode = null;
  if (bubbleWindow && !bubbleWindow.isDestroyed()) bubbleWindow.hide();
}

function showBubble(message) {
  if (!message || expanded || bubbleMode === "chat" || !bubbleWindow || bubbleWindow.isDestroyed()) return;
  clearTimeout(bubbleTimer);
  bubbleMode = "notification";
  const placement = placeBubble();
  bubbleWindow.webContents.send("companion:bubble-mode", "notification");
  bubbleWindow.webContents.send("companion:bubble-message", { ...message, ...placement });
  bubbleWindow.showInactive();
  bubbleTimer = setTimeout(hideBubble, 7200);
}

function showChat() {
  if (!bubbleWindow || bubbleWindow.isDestroyed() || expanded) return;
  clearTimeout(bubbleTimer);
  bubbleTimer = null;
  bubbleMode = "chat";
  const placement = placeBubble();
  bubbleWindow.webContents.send("companion:bubble-mode", "chat");
  bubbleWindow.webContents.send("companion:bubble-placement", placement);
  bubbleWindow.webContents.send("companion:state", currentPayload());
  bubbleWindow.show();
  bubbleWindow.focus();
}

function toggleChat() {
  if (bubbleMode === "chat" && bubbleWindow?.isVisible()) hideBubble();
  else showChat();
}

function dockedBounds(size, peek = false) {
  const work = currentWorkArea();
  const dock = companionSettings.dock;
  return calculateDockedBounds(work, size, dock, peek, EDGE_PEEK);
}

function freeBounds(size) {
  const work = currentWorkArea();
  const saved = companionSettings.free_bounds;
  return {
    x: clamp(saved?.x ?? work.x + work.width - size.width - 22, work.x, work.x + work.width - size.width),
    y: clamp(saved?.y ?? work.y + work.height - size.height - 22, work.y, work.y + work.height - size.height),
    width: size.width,
    height: size.height
  };
}

function placeWindow({ peek = false } = {}) {
  const size = expanded ? EXPANDED : COLLAPSED;
  setWindowBounds(companionSettings.dock ? dockedBounds(size, peek && !expanded) : freeBounds(size));
}

function setExpanded(next) {
  clearTimeout(hideTimer);
  if (next === expanded) return;
  if (next) collapsedRestoreBounds = window.getBounds();
  clearTimeout(transitionFallback);
  window.setOpacity(0);
  expanded = next;
  if (expanded) hideBubble();
  if (!next && collapsedRestoreBounds) {
    const restore = collapsedRestoreBounds;
    collapsedRestoreBounds = null;
    setWindowBounds(restore, false);
  } else {
    const size = expanded ? EXPANDED : COLLAPSED;
    const bounds = companionSettings.dock ? dockedBounds(size, false) : freeBounds(size);
    setWindowBounds(bounds, false);
  }
  window.webContents.send("companion:expanded", expanded);
  transitionFallback = setTimeout(() => {
    if (window && !window.isDestroyed()) window.setOpacity(1);
  }, 180);
}

function finishWindowTransition() {
  clearTimeout(transitionFallback);
  if (window && !window.isDestroyed()) window.setOpacity(1);
}

function revealFromEdge() {
  clearTimeout(hideTimer);
  if (companionSettings.dock && !expanded) placeWindow({ peek: false });
}

function retreatToEdge() {
  clearTimeout(hideTimer);
  if (!companionSettings.dock || expanded || bubbleMode === "chat") return;
  hideTimer = setTimeout(() => {
    if (bubbleMode !== "chat") placeWindow({ peek: true });
  }, 520);
}

function detectSnap() {
  if (movingProgrammatically || petDrag || expanded || !window || window.isDestroyed()) return;
  const bounds = window.getBounds();
  const work = screen.getDisplayMatching(bounds).workArea;
  const dock = nearestDock(bounds, work, SNAP_DISTANCE, ["left", "right", "top"]);
  if (dock) {
    companionSettings = { ...companionSettings, dock };
    writeSettings();
    setExpanded(false);
    retreatToEdge();
    return;
  }
  companionSettings = { ...companionSettings, dock: null, free_bounds: { x: bounds.x, y: bounds.y } };
  writeSettings();
}

function saveAchievement(input) {
  const release = acquireStateLock();
  try {
  const state = readJson(STATE_PATH, {
    schema_version: "agent-achievements/v1",
    achievements: [], progress: {}, tracked: [], awards: [], processed_event_ids: []
  });
  state.achievements ||= [];
  state.progress ||= {};
  state.tracked ||= [];
  const requestedId = String(input?.achievement_id || "").trim();
  const existingIndex = requestedId ? state.achievements.findIndex((item) => item.achievement_id === requestedId) : -1;
  if (requestedId && existingIndex < 0) throw new Error("achievement-not-found");
  const existing = existingIndex >= 0 ? state.achievements[existingIndex] : null;
  if (existing?.origin === "system_discovered" || existing?.extensions?.created_by === "system") throw new Error("system-achievement-read-only");
  const achievement = buildHumanAchievement(input, {
    achievementId: existing?.achievement_id,
    existingExtensions: existing?.extensions,
    existingMode: existing?.mode,
    existingCondition: existing?.condition,
    evidenceRequired: existing?.evidence_required,
    existingOrigin: existing?.origin
  });
  if (existingIndex >= 0) state.achievements[existingIndex] = achievement;
  else state.achievements.push(achievement);
  state.progress[achievement.achievement_id] ??= 0;
  const focusSession = focusedSession();
  const agentId = focusSession?.agent_id || null;
  const workspace = focusSession?.workspace || null;
  achievement.extensions = { ...(achievement.extensions || {}), ...(workspace ? { workspace } : {}) };
  if (existingIndex >= 0) state.achievements[existingIndex] = achievement;
  const tracking = updateTrackedIds(agentTrackedIds(state, agentId, workspace), achievement.achievement_id, Boolean(input?.track));
  if (agentId) {
    state.tracking_records ||= [];
    const record = state.tracking_records.find((item) => item.agent_id === agentId && sameWorkspace(item, workspace));
    if (record) record.achievement_ids = tracking.tracked;
    else state.tracking_records.push({ agent_id: agentId, ...(workspace ? { workspace } : {}), achievement_ids: tracking.tracked });
  } else {
    state.tracked = tracking.tracked;
  }
  writeJsonAtomic(STATE_PATH, state);
  if (input?.design_request_id) {
    const designDocument = readJson(DESIGN_REQUESTS_PATH, { schema_version: "agent-achievements/v1", requests: [] });
    const request = (designDocument.requests || []).find((item) => item.request_id === input.design_request_id);
    if (request) {
      request.status = "applied";
      writeJsonAtomic(DESIGN_REQUESTS_PATH, designDocument);
    }
  }
  lastPayload = "";
  sync();
  return {
    achievement_id: achievement.achievement_id,
    created: existingIndex < 0,
    tracked: tracking.tracked.includes(achievement.achievement_id),
    tracking_limit_reached: tracking.trackingLimitReached
  };
  } finally {
    release();
  }
}

function requestAchievementDesign(briefValue) {
  const release = acquireStateLock();
  try {
  const brief = String(briefValue || "").trim();
  if (!brief || brief.length > 1000) throw new Error("design-brief-invalid");
  const document = readJson(DESIGN_REQUESTS_PATH, { schema_version: "agent-achievements/v1", requests: [] });
  const sessions = activeSessions();
  const focusSession = focusedSession(sessions);
  const request = {
    schema_version: "agent-achievements/v1",
    request_id: `design-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    ...(focusSession?.agent_id ? { agent_id: focusSession.agent_id } : {}),
    ...(focusSession?.workspace ? { workspace: focusSession.workspace } : {}),
    brief,
    status: "pending",
    created_at: new Date().toISOString()
  };
  document.requests ||= [];
  document.requests.push(request);
  writeJsonAtomic(DESIGN_REQUESTS_PATH, document);
  lastPayload = "";
  sync();
  return { request_id: request.request_id, status: request.status };
  } finally {
    release();
  }
}

function requestAchievementDiagnostic() {
  const release = acquireStateLock();
  try {
    const sessions = activeSessions();
    const focusSession = focusedSession(sessions);
    const request = createDiagnosticRequest("manual", focusSession?.agent_id || null, focusSession?.workspace || null);
    lastPayload = "";
    sync();
    return { request_id: request.request_id, status: request.status };
  } finally {
    release();
  }
}

async function requestWuxingDiagnostic() {
  const release = acquireStateLock();
  let queued;
  let focusSession;
  try {
    const state = readJson(STATE_PATH, emptyState());
    const sessions = activeSessions();
    focusSession = focusedSession(sessions);
    if (!focusSession?.agent_id) throw new Error("agent-not-connected");
    if (!focusSession.workspace) throw new Error("workspace-not-detected");
    const result = queueWuxingDiagnosticAction(state, focusSession.agent_id, focusSession.workspace);
    if (result.created) writeJsonAtomic(STATE_PATH, result.state);
    queued = result;
    lastPayload = "";
    sync();
  } finally {
    release();
  }
  const repository = path.basename(focusSession.workspace);
  const delivery = await agentAdapters.runPrompt(
    adapterTarget(focusSession),
    `请使用已安装的 wuxing-harness Skill，对当前仓库 ${repository} 启动或继续五行诊断。先读取当前仓库的规则、Skills、代码、历史和判断数据库，按三段式流程一次只问一个需要我判断的问题；不要跳到实现。当前是只读诊断会话，不要修改任何文件。把扫描结果和当前唯一需要我判断的问题直接回复在本会话中。`,
    { displayText: `诊断当前仓库：${repository}` }
  );
  return { action_id: queued.action.action_id, status: queued.action.status, created: queued.created, workspace: queued.action.workspace, target_session_status: focusSession.status, delivery };
}

async function sendAgentMessage(text) {
  const focusSession = focusedSession();
  if (!focusSession?.workspace) throw new Error("workspace-not-detected");
  return agentAdapters.runPrompt(adapterTarget(focusSession), text);
}

async function startNewAgentConversation() {
  const focusSession = focusedSession();
  if (!focusSession?.workspace) throw new Error("workspace-not-detected");
  const confirmation = await dialog.showMessageBox(bubbleWindow && !bubbleWindow.isDestroyed() ? bubbleWindow : window, {
    type: "question",
    title: "新建对话",
    message: "开始一个新对话？",
    detail: "当前对话会从五行助手中移除，但仍保留在 Coding Agent 的历史记录里。",
    buttons: ["新建对话", "取消"],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  });
  if (confirmation.response !== 0) return { created: false };
  const conversation = await agentAdapters.resetSession(adapterTarget(focusSession));
  lastPayload = "";
  sync();
  return { created: true, session_id: conversation.session_id, workspace: conversation.workspace };
}

function confirmDiagnosticDiscovery(requestId, discoveryId) {
  const release = acquireStateLock();
  try {
  const normalizedRequestId = String(requestId);
  const normalizedDiscoveryId = String(discoveryId);
  const request = (diagnosticDocument().requests || []).find((item) => item.request_id === normalizedRequestId);
  const discovery = request?.report?.discoveries?.find((item) => item.discovery_id === normalizedDiscoveryId);
  if (!discovery || (request.settled_discovery_ids || []).includes(normalizedDiscoveryId)) throw new Error("diagnostic-discovery-not-found");
  const result = settleReportedDiagnostics({ requestId: normalizedRequestId, discoveryId: normalizedDiscoveryId });
  if (!result.changed) throw new Error("diagnostic-discovery-not-found");
  sync();
  return { request_id: normalizedRequestId, discovery_id: normalizedDiscoveryId, awarded: true };
  } finally {
    release();
  }
}

function setAchievementTracking(achievementId, enabled) {
  const release = acquireStateLock();
  try {
  const state = readJson(STATE_PATH, null);
  const achievement = state?.achievements?.find((item) => item.achievement_id === achievementId);
  if (!achievement) throw new Error("achievement-not-found");
  if (enabled && achievement.tracking?.allowed === false) throw new Error("tracking-not-allowed");
  const focusSession = focusedSession();
  const agentId = focusSession?.agent_id || state.awards?.at(-1)?.agent_id || eventRecords().at(-1)?.actor?.agent_id || null;
  const workspace = focusSession?.workspace || null;
  const migrated = migrateLegacyAutopilotBlocks(state, agentId, workspace);
  const tracking = updateTrackedIds(agentTrackedIds(state, agentId, workspace), achievementId, enabled);
  if (tracking.trackingLimitReached) {
    if (migrated) writeJsonAtomic(STATE_PATH, state);
    return { achievement_id: achievementId, agent_id: agentId, tracked: false, tracking_limit_reached: true };
  }
  if (agentId) {
    state.tracking_records ||= [];
    const record = state.tracking_records.find((item) => item.agent_id === agentId && sameWorkspace(item, workspace));
    if (record) record.achievement_ids = tracking.tracked;
    else state.tracking_records.push({ agent_id: agentId, ...(workspace ? { workspace } : {}), achievement_ids: tracking.tracked });
  } else {
    state.tracked = tracking.tracked;
  }
  setAgentAchievementBlocked(state, agentId, achievementId, !enabled, workspace);
  writeJsonAtomic(STATE_PATH, state);
  lastPayload = "";
  sync();
  return { achievement_id: achievementId, agent_id: agentId, workspace, tracked: enabled, tracking_limit_reached: false };
  } finally {
    release();
  }
}

function preparePetDrag() {
  if (expanded || !window || window.isDestroyed()) return;
  clearTimeout(hideTimer);
  petDrag = { bounds: window.getBounds(), cursor: screen.getCursorScreenPoint(), moved: false };
}

function movePetDrag() {
  if (!petDrag || expanded || !window || window.isDestroyed()) return;
  clearTimeout(hideTimer);
  if (!petDrag.moved) {
    petDrag.moved = true;
    companionSettings = { ...companionSettings, dock: null };
  }
  const bounds = calculateDraggedBounds(petDrag.bounds, petDrag.cursor, screen.getCursorScreenPoint());
  window.setBounds(bounds, false);
}

function finishPetDrag(commit) {
  const moved = Boolean(petDrag?.moved);
  petDrag = null;
  if (commit && moved) detectSnap();
}

function sync() {
  if (quitting || !window || window.isDestroyed()) return;
  writeCompanionStatus("running");
  superviseAgentBridges();
  const payload = currentPayload();
  const notification = bubbleMessage(previousBubblePayload, payload);
  previousBubblePayload = payload;
  const serialized = JSON.stringify(payload);
  if (serialized !== lastPayload) {
    lastPayload = serialized;
    window.webContents.send("companion:state", payload);
    if (bubbleWindow && !bubbleWindow.isDestroyed() && !bubbleWindow.webContents.isLoading()) {
      bubbleWindow.webContents.send("companion:state", payload);
    }
  }
  if (notification) showBubble(notification);
  agentConnectionServer?.refreshContexts();
  if (!window.isVisible()) window.showInactive();
}

function loginItemOptions(openAtLogin) {
  return { openAtLogin, path: process.execPath, ...(app.isPackaged ? {} : { args: [app.getAppPath()] }) };
}

function getAutostart() { return app.getLoginItemSettings(loginItemOptions(false)).openAtLogin; }

function setAutostart(enabled) {
  app.setLoginItemSettings(loginItemOptions(enabled));
  companionSettings = { ...companionSettings, autostart_initialized: true };
  writeSettings();
  if (tray) refreshTrayMenu();
  return getAutostart();
}

function ensureAutostartOnFirstLaunch() {
  if (settingsExistedAtLaunch || companionSettings.autostart_initialized) return getAutostart();
  return setAutostart(true);
}

function getAlwaysOnTop() { return companionSettings.always_on_top !== false; }

function setAlwaysOnTop(enabled) {
  companionSettings = { ...companionSettings, always_on_top: Boolean(enabled) };
  writeSettings();
  if (window && !window.isDestroyed()) window.setAlwaysOnTop(Boolean(enabled), "floating");
  if (bubbleWindow && !bubbleWindow.isDestroyed()) bubbleWindow.setAlwaysOnTop(Boolean(enabled), "floating");
  if (window && !window.isDestroyed()) window.webContents.send("companion:always-on-top", getAlwaysOnTop());
  if (tray) refreshTrayMenu();
  return getAlwaysOnTop();
}

function sessionMenuLabel(session) {
  const title = String(session.title || "未命名对话").replace(/[\r\n\t]+/g, " ").replace(/&/g, "&&").trim();
  const timestamp = session.updated_at ? new Date(session.updated_at) : null;
  const time = timestamp && !Number.isNaN(timestamp.getTime())
    ? timestamp.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";
  return `${title.slice(0, 42) || "未命名对话"}${time ? ` · ${time}` : ""}`;
}

async function switchAgentConversation(target, sessionId) {
  try {
    await agentAdapters.switchSession(target, sessionId);
    lastPayload = "";
    sync();
    if (bubbleMode === "chat" && bubbleWindow?.isVisible()) bubbleWindow.focus();
  } catch (error) {
    await dialog.showMessageBox(window, {
      type: "error",
      title: "无法切换对话",
      message: String(error?.message || "").includes("prompt-in-progress") ? "Agent 正在回复，请稍后再切换。" : "这条对话暂时无法恢复。",
      detail: String(error?.message || error),
      buttons: ["知道了"]
    });
  }
}

async function showAgentSessionMenu() {
  const focusSession = focusedSession();
  if (!focusSession?.workspace || !window || window.isDestroyed()) return;
  try {
    const history = await agentAdapters.listSessions(adapterTarget(focusSession));
    const currentId = agentAdapters.stateFor(adapterTarget(focusSession))?.session_id;
    const target = adapterTarget(focusSession);
    const adapter = agentAdapters.descriptor(target);
    const recent = history.slice(0, 12);
    const template = [
      { label: `${path.basename(focusSession.workspace)} · ${adapter?.label || "Agent"} 对话`, enabled: false },
      { type: "separator" },
      ...(recent.length ? recent.map((session) => ({
        label: sessionMenuLabel(session),
        type: "radio",
        checked: session.session_id === currentId,
        click: () => { void switchAgentConversation(target, session.session_id); }
      })) : [{ label: "没有找到历史对话", enabled: false }]),
      ...(history.length > recent.length ? [{ type: "separator" }, { label: `还有 ${history.length - recent.length} 条较早对话`, enabled: false }] : [])
    ];
    Menu.buildFromTemplate(template).popup({ window });
  } catch (error) {
    await dialog.showMessageBox(window, {
      type: "error",
      title: "无法读取历史对话",
      message: "暂时无法读取当前仓库的 Agent 对话。",
      detail: String(error?.message || error),
      buttons: ["知道了"]
    });
  }
}

function refreshTrayMenu() {
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "和 Agent 聊天", click: () => { window.showInactive(); revealFromEdge(); showChat(); } },
    { label: "打开成就任务", click: () => { hideBubble(); window.showInactive(); revealFromEdge(); setExpanded(true); } },
    { label: "诊断当前仓库", click: () => { void requestWuxingDiagnostic().catch(() => {}); window.showInactive(); revealFromEdge(); showChat(); } },
    { label: "显示桌面伙伴", click: () => { window.showInactive(); revealFromEdge(); } },
    { label: "打开成就目录", click: () => shell.openPath(DATA_HOME) },
    { label: "窗口置顶", type: "checkbox", checked: getAlwaysOnTop(), click: (item) => setAlwaysOnTop(item.checked) },
    { label: "开机常驻", type: "checkbox", checked: getAutostart(), click: (item) => setAutostart(item.checked) },
    { type: "separator" },
    { label: "退出", click: () => { quitting = true; app.quit(); } }
  ]));
}

function createWindow() {
  window = new BrowserWindow({
    ...COLLAPSED,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: getAlwaysOnTop(),
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false }
  });
  window.setAlwaysOnTop(getAlwaysOnTop(), "floating");
  window.loadFile(path.join(__dirname, "index.html"));
  window.webContents.on("did-finish-load", () => { lastPayload = ""; sync(); });
  window.webContents.on("context-menu", (event) => { event.preventDefault(); void showAgentSessionMenu(); });
  window.on("move", () => { if (bubbleWindow?.isVisible()) placeBubble(); });
  window.on("moved", detectSnap);
  window.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      setExpanded(false);
      retreatToEdge();
      window.showInactive();
    }
  });
  placeWindow({ peek: Boolean(companionSettings.dock) });
}

function createBubbleWindow() {
  bubbleWindow = new BrowserWindow({
    ...BUBBLE_SIZE,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    focusable: true,
    alwaysOnTop: getAlwaysOnTop(),
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: { preload: path.join(__dirname, "bubble-preload.cjs"), contextIsolation: true, nodeIntegration: false }
  });
  bubbleWindow.setAlwaysOnTop(getAlwaysOnTop(), "floating");
  bubbleWindow.loadFile(path.join(__dirname, "bubble.html"));
  bubbleWindow.webContents.on("did-finish-load", () => {
    bubbleWindow.webContents.send("companion:state", currentPayload());
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(TRAY_ICON_PATH);
  if (icon.isEmpty()) throw new Error(`tray-icon-empty:${TRAY_ICON_PATH}`);
  tray = new Tray(icon);
  tray.setToolTip(APP_DISPLAY_NAME);
  refreshTrayMenu();
  tray.on("click", () => { window.showInactive(); revealFromEdge(); });
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.whenReady().then(async () => {
    ensureCompanionData();
    ensureInitialDiagnostic();
    ensureAutostartOnFirstLaunch();
    agentAdapters = createAgentAdapterFactory({ dataHome: DATA_HOME, onChanged: () => { lastPayload = ""; sync(); } });
    agentConnectionServer = createAgentConnectionServer({
      dataHome: DATA_HOME,
      getContext: connectionContext,
      onChanged: () => { lastPayload = ""; sync(); },
      onAssistantPrompt: ({ agentId, runtimeId, workspace, text }) => {
        const matches = activeSessions().filter((item) => item.workspace === workspace
          && (!agentId || item.agent_id === agentId)
          && (!runtimeId || item.runtime?.id === runtimeId));
        if (matches.length !== 1) throw new Error(matches.length ? "assistant-target-ambiguous" : "assistant-target-not-connected");
        const session = matches[0];
        return agentAdapters.runPrompt(adapterTarget(session), text);
      }
    });
    await agentConnectionServer.start();
    const initialFocus = focusedSession();
    if (initialFocus?.workspace) agentAdapters.connect(adapterTarget(initialFocus)).catch(() => { lastPayload = ""; sync(); });
    createWindow();
    createBubbleWindow();
    createTray();
    ipcMain.on("companion:toggle", toggleChat);
    ipcMain.on("companion:open-achievements", () => { hideBubble(); setExpanded(true); });
    ipcMain.on("companion:collapse", () => { setExpanded(false); retreatToEdge(); });
    ipcMain.on("companion:hover", (_event, hovering) => hovering ? revealFromEdge() : retreatToEdge());
    ipcMain.on("companion:drag-prepare", preparePetDrag);
    ipcMain.on("companion:drag-move", movePetDrag);
    ipcMain.on("companion:drag-end", (_event, commit) => finishPetDrag(Boolean(commit)));
    ipcMain.on("companion:transition-ready", finishWindowTransition);
    ipcMain.on("companion:bubble-open", showChat);
    ipcMain.on("companion:bubble-dismiss", hideBubble);
    ipcMain.handle("companion:choose-avatar", async () => {
      const result = await dialog.showOpenDialog(window, { title: "选择伙伴形象", properties: ["openFile"], filters: [{ name: "图片", extensions: AVATAR_EXTENSIONS }] });
      if (!result.canceled && result.filePaths[0]) installAvatar(result.filePaths[0]);
      sync();
    });
    ipcMain.handle("companion:reset-avatar", () => { clearAvatarFiles(); sync(); });
    ipcMain.handle("companion:get-autostart", () => getAutostart());
    ipcMain.handle("companion:set-autostart", (_event, enabled) => setAutostart(Boolean(enabled)));
    ipcMain.handle("companion:get-always-on-top", () => getAlwaysOnTop());
    ipcMain.handle("companion:set-always-on-top", (_event, enabled) => setAlwaysOnTop(Boolean(enabled)));
    ipcMain.handle("companion:set-focus-workspace", (_event, agentId, workspace, runtimeId) => setFocusWorkspace(String(agentId), String(workspace), String(runtimeId || "")));
    ipcMain.handle("companion:request-wuxing-diagnostic", () => requestWuxingDiagnostic());
    ipcMain.handle("companion:send-agent-message", (_event, text) => sendAgentMessage(String(text || "")));
    ipcMain.handle("companion:new-agent-conversation", () => startNewAgentConversation());
    ipcMain.handle("companion:save-achievement", (_event, input) => saveAchievement(input));
    ipcMain.handle("companion:set-achievement-tracking", (_event, achievementId, enabled) => setAchievementTracking(String(achievementId), Boolean(enabled)));
    ipcMain.handle("companion:request-achievement-design", (_event, brief) => requestAchievementDesign(brief));
    ipcMain.handle("companion:request-achievement-diagnostic", () => requestAchievementDiagnostic());
    ipcMain.handle("companion:confirm-diagnostic-discovery", (_event, requestId, discoveryId) => confirmDiagnosticDiscovery(requestId, discoveryId));
    ipcMain.handle("companion:review-claim", (_event, claimId, decision, feedback) => reviewClaim(claimId, decision, feedback));
    screen.on("display-metrics-changed", () => { placeWindow({ peek: Boolean(companionSettings.dock) && !expanded }); if (bubbleWindow?.isVisible()) placeBubble(); });
    setInterval(sync, 1000).unref();
    sync();
  });
  app.on("second-instance", () => { if (window) { window.showInactive(); revealFromEdge(); showChat(); } });
  app.on("before-quit", () => { quitting = true; agentAdapters?.stop(); agentConnectionServer?.stop(); writeCompanionStatus("stopped", true); });
  app.on("window-all-closed", (event) => event.preventDefault());
}
