const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, screen, shell, Tray } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildHumanAchievement, calculateScore, settleDiagnosticReport, tierMetadata, updateTrackedIds } = require("./achievement-factory.cjs");
const { calculateDockedBounds, calculateDraggedBounds, clamp, equalBounds, nearestDock } = require("./geometry.cjs");

const DATA_HOME = path.resolve(process.env.AGENT_ACHIEVEMENTS_HOME || path.join(os.homedir(), ".agent-achievements"));
const STATE_PATH = path.join(DATA_HOME, "state.json");
const PRESENCE_PATH = path.join(DATA_HOME, "presence.json");
const SETTINGS_PATH = path.join(DATA_HOME, "companion-settings.json");
const DESIGN_REQUESTS_PATH = path.join(DATA_HOME, "achievement-design-requests.json");
const DIAGNOSTICS_PATH = path.join(DATA_HOME, "achievement-diagnostics.json");
const CLAIMS_PATH = path.join(DATA_HOME, "claims.jsonl");
const COLLAPSED = { width: 94, height: 100 };
const EXPANDED = { width: 430, height: 650 };
const SNAP_DISTANCE = 34;
const EDGE_PEEK = 30;
const AVATAR_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "svg"];
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const TRAY_ICON_PATH = path.join(__dirname, process.platform === "win32" ? "tray-icon.ico" : "tray-icon.png");
const APP_DISPLAY_NAME = "五行 Harness 助手";
const WUXING_ASSISTANT_URL = process.env.WUXING_ASSISTANT_URL || "https://wuxing-creation-harness.misakiff14.chatgpt.site";

app.setName(APP_DISPLAY_NAME);

let window;
let wuxingWindow;
let tray;
let expanded = false;
let lastPayload = "";
let quitting = false;
let movingProgrammatically = false;
let hideTimer;
let petDrag = null;
let collapsedRestoreBounds = null;
let transitionFallback;
let avatarCache = { key: "", value: null };
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

function claimRecords() {
  try { return fs.readFileSync(CLAIMS_PATH, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse); }
  catch { return []; }
}

function activeSessions() {
  const now = Date.now();
  const presence = readJson(PRESENCE_PATH, { sessions: [] });
  return presence.sessions.filter((session) => session.status !== "stopped" && new Date(session.expires_at).getTime() > now);
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

function createDiagnosticRequest(reason = "manual") {
  const document = diagnosticDocument();
  const existing = (document.requests || []).find((item) => item.status === "pending");
  if (existing) return existing;
  const request = {
    schema_version: "agent-achievements/v1",
    request_id: `diagnostic-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    reason,
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
  const document = diagnosticDocument();
  if (!(document.requests || []).length) createDiagnosticRequest("first_run");
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
      confirmDiscoveryId: confirm?.requestId === request.request_id ? confirm.discoveryId : undefined
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

function currentPayload() {
  settleReportedDiagnostics();
  const state = readJson(STATE_PATH, { achievements: [], progress: {}, tracked: [], awards: [] });
  const sessions = activeSessions();
  const achievements = state.achievements || [];
  const tracked = achievements.filter((item) => (state.tracked || []).includes(item.achievement_id)).slice(0, 3).map((item) => ({
    ...tierMetadata(item),
    id: item.achievement_id,
    title: item.title,
    current: state.progress?.[item.achievement_id] || 0,
    target: item.condition?.target || 1,
    encouragement: item.tracking?.encouragement || item.intent
  }));
  const awards = (state.awards || []).slice(-3).reverse().map((award) => ({
    ...award,
    ...tierMetadata(achievements.find((item) => item.achievement_id === award.achievement_id)),
    title: achievements.find((item) => item.achievement_id === award.achievement_id)?.title || award.achievement_id
  }));
  const awardedIds = new Set((state.awards || []).map((item) => item.achievement_id));
  const score = calculateScore(achievements, state.awards);
  const catalog = achievements.map((item) => ({
    ...tierMetadata(item),
    id: item.achievement_id,
    title: item.title,
    intent: item.intent,
    current: state.progress?.[item.achievement_id] || 0,
    target: item.condition?.target || 1,
    event_type: item.condition?.event_types?.[0] || "task.completed",
    encouragement: item.tracking?.encouragement || "",
    guardrails: (item.tracking?.guardrails || []).join("\n"),
    origin: item.origin || (item.extensions?.created_by === "system" ? "system_discovered" : "human_created"),
    source_skill: item.extensions?.source_skill || null,
    discovery_reason: (state.awards || []).find((award) => award.achievement_id === item.achievement_id)?.human_feedback || null,
    editable: item.origin !== "system_discovered" && item.extensions?.created_by !== "system",
    tracking_allowed: item.tracking?.allowed !== false,
    tracked: (state.tracked || []).includes(item.achievement_id),
    awarded: awardedIds.has(item.achievement_id)
  }));
  const designDocument = readJson(DESIGN_REQUESTS_PATH, { requests: [] });
  const designs = (designDocument.requests || []).filter((item) => item.status !== "applied").slice(-5).reverse();
  const diagnostics = diagnosticDocument();
  const latestDiagnostic = (diagnostics.requests || []).at(-1) || null;
  const settledIds = new Set(latestDiagnostic?.settled_discovery_ids || []);
  const pendingDiscoveries = (latestDiagnostic?.report?.discoveries || []).filter((item) => !settledIds.has(item.discovery_id));
  const claims = claimRecords().filter((item) => item.status === "pending_human_review").slice(-5).reverse().map((claim) => {
    const achievement = achievements.find((item) => item.achievement_id === claim.achievement_id);
    const tier = tierMetadata(achievement);
    return { claim_id: claim.claim_id, title: achievement?.title || claim.achievement_id, summary: claim.summary, evidence_count: claim.evidence?.length || 0, tier_label: { bronze: "铜牌", silver: "银牌", gold: "金牌" }[tier.tier] || "铜牌", ...tier };
  });
  return { dataHome: DATA_HOME, sessions, tracked, awards, claims, catalog, designs, score, avatar: readAvatar(), diagnostic: latestDiagnostic ? {
    request_id: latestDiagnostic.request_id,
    reason: latestDiagnostic.reason,
    status: latestDiagnostic.status,
    scanned_skills: latestDiagnostic.report?.sources?.skills?.length || 0,
    pending_discoveries: pendingDiscoveries
  } : null };
}

function reviewClaim(claimId, decision) {
  if (!new Set(["award", "reject"]).has(decision)) throw new Error("claim-decision-invalid");
  const claims = claimRecords();
  const claim = claims.find((item) => item.claim_id === String(claimId));
  if (!claim || claim.status !== "pending_human_review") throw new Error("claim-not-found");
  const state = readJson(STATE_PATH, { schema_version: "agent-achievements/v1", achievements: [], progress: {}, tracked: [], awards: [], processed_event_ids: [] });
  const achievement = state.achievements.find((item) => item.achievement_id === claim.achievement_id);
  if (!achievement) throw new Error("achievement-not-found");
  claim.status = decision === "award" ? "awarded" : "rejected";
  claim.reviewed_at = new Date().toISOString();
  claim.human_feedback = decision === "award" ? "我认可这次有证据的改进。" : "这次不授予成就。";
  if (decision === "award" && !state.awards.some((item) => item.achievement_id === claim.achievement_id && item.agent_id === claim.agent_id)) {
    const tier = tierMetadata(achievement);
    state.awards.push({ award_id: `award-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, achievement_id: claim.achievement_id, agent_id: claim.agent_id, awarded_at: claim.reviewed_at, awarded_by: "human", points: tier.points, human_feedback: claim.human_feedback, evidence_summary: claim.summary.slice(0, 600), evidence: (claim.evidence || []).slice(0, 12) });
    writeJsonAtomic(STATE_PATH, state);
  }
  writeTextAtomic(CLAIMS_PATH, `${claims.map((item) => JSON.stringify(item)).join("\n")}\n`);
  lastPayload = "";
  sync();
  return { claim_id: claim.claim_id, status: claim.status };
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
  if (!companionSettings.dock || expanded) return;
  hideTimer = setTimeout(() => placeWindow({ peek: true }), 520);
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
  const tracking = updateTrackedIds(state.tracked, achievement.achievement_id, Boolean(input?.track));
  state.tracked = tracking.tracked;
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
    tracked: state.tracked.includes(achievement.achievement_id),
    tracking_limit_reached: tracking.trackingLimitReached
  };
}

function requestAchievementDesign(briefValue) {
  const brief = String(briefValue || "").trim();
  if (!brief || brief.length > 1000) throw new Error("design-brief-invalid");
  const document = readJson(DESIGN_REQUESTS_PATH, { schema_version: "agent-achievements/v1", requests: [] });
  const request = {
    schema_version: "agent-achievements/v1",
    request_id: `design-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
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
}

function requestAchievementDiagnostic() {
  const request = createDiagnosticRequest("manual");
  lastPayload = "";
  sync();
  return { request_id: request.request_id, status: request.status };
}

function confirmDiagnosticDiscovery(requestId, discoveryId) {
  const normalizedRequestId = String(requestId);
  const normalizedDiscoveryId = String(discoveryId);
  const request = (diagnosticDocument().requests || []).find((item) => item.request_id === normalizedRequestId);
  const discovery = request?.report?.discoveries?.find((item) => item.discovery_id === normalizedDiscoveryId);
  if (!discovery || (request.settled_discovery_ids || []).includes(normalizedDiscoveryId)) throw new Error("diagnostic-discovery-not-found");
  const result = settleReportedDiagnostics({ requestId: normalizedRequestId, discoveryId: normalizedDiscoveryId });
  if (!result.changed) throw new Error("diagnostic-discovery-not-found");
  sync();
  return { request_id: normalizedRequestId, discovery_id: normalizedDiscoveryId, awarded: true };
}

function setAchievementTracking(achievementId, enabled) {
  const state = readJson(STATE_PATH, null);
  const achievement = state?.achievements?.find((item) => item.achievement_id === achievementId);
  if (!achievement) throw new Error("achievement-not-found");
  if (enabled && achievement.tracking?.allowed === false) throw new Error("tracking-not-allowed");
  const tracking = updateTrackedIds(state.tracked, achievementId, enabled);
  if (tracking.trackingLimitReached) return { achievement_id: achievementId, tracked: false, tracking_limit_reached: true };
  state.tracked = tracking.tracked;
  writeJsonAtomic(STATE_PATH, state);
  lastPayload = "";
  sync();
  return { achievement_id: achievementId, tracked: enabled, tracking_limit_reached: false };
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
  if (!window || window.isDestroyed()) return;
  const payload = currentPayload();
  const serialized = JSON.stringify(payload);
  if (serialized !== lastPayload) {
    lastPayload = serialized;
    window.webContents.send("companion:state", payload);
  }
  if (!window.isVisible()) window.showInactive();
}

function loginItemOptions(openAtLogin) {
  return { openAtLogin, path: process.execPath, ...(app.isPackaged ? {} : { args: [app.getAppPath()] }) };
}

function getAutostart() { return app.getLoginItemSettings(loginItemOptions(false)).openAtLogin; }

function setAutostart(enabled) {
  app.setLoginItemSettings(loginItemOptions(enabled));
  if (tray) refreshTrayMenu();
  return getAutostart();
}

function getAlwaysOnTop() { return companionSettings.always_on_top !== false; }

function setAlwaysOnTop(enabled) {
  companionSettings = { ...companionSettings, always_on_top: Boolean(enabled) };
  writeSettings();
  if (window && !window.isDestroyed()) window.setAlwaysOnTop(Boolean(enabled), "floating");
  if (window && !window.isDestroyed()) window.webContents.send("companion:always-on-top", getAlwaysOnTop());
  if (tray) refreshTrayMenu();
  return getAlwaysOnTop();
}

function openWuxingAssistant() {
  if (wuxingWindow && !wuxingWindow.isDestroyed()) {
    wuxingWindow.show();
    wuxingWindow.focus();
    return;
  }
  wuxingWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 760,
    minHeight: 620,
    title: APP_DISPLAY_NAME,
    backgroundColor: "#e9e6dc",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  wuxingWindow.loadURL(WUXING_ASSISTANT_URL);
  wuxingWindow.on("closed", () => { wuxingWindow = null; });
}

function refreshTrayMenu() {
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "打开规则体检", click: openWuxingAssistant },
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
  app.whenReady().then(() => {
    ensureInitialDiagnostic();
    createWindow();
    createTray();
    ipcMain.on("companion:toggle", () => setExpanded(!expanded));
    ipcMain.on("companion:collapse", () => { setExpanded(false); retreatToEdge(); });
    ipcMain.on("companion:hover", (_event, hovering) => hovering ? revealFromEdge() : retreatToEdge());
    ipcMain.on("companion:drag-prepare", preparePetDrag);
    ipcMain.on("companion:drag-move", movePetDrag);
    ipcMain.on("companion:drag-end", (_event, commit) => finishPetDrag(Boolean(commit)));
    ipcMain.on("companion:transition-ready", finishWindowTransition);
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
    ipcMain.handle("companion:open-wuxing", () => openWuxingAssistant());
    ipcMain.handle("companion:save-achievement", (_event, input) => saveAchievement(input));
    ipcMain.handle("companion:set-achievement-tracking", (_event, achievementId, enabled) => setAchievementTracking(String(achievementId), Boolean(enabled)));
    ipcMain.handle("companion:request-achievement-design", (_event, brief) => requestAchievementDesign(brief));
    ipcMain.handle("companion:request-achievement-diagnostic", () => requestAchievementDiagnostic());
    ipcMain.handle("companion:confirm-diagnostic-discovery", (_event, requestId, discoveryId) => confirmDiagnosticDiscovery(requestId, discoveryId));
    ipcMain.handle("companion:review-claim", (_event, claimId, decision) => reviewClaim(claimId, decision));
    screen.on("display-metrics-changed", () => placeWindow({ peek: Boolean(companionSettings.dock) && !expanded }));
    setInterval(sync, 1000).unref();
    sync();
  });
  app.on("second-instance", () => { if (window) { window.showInactive(); setExpanded(true); } });
  app.on("window-all-closed", (event) => event.preventDefault());
}
