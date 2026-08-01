const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, screen, shell, Tray } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { calculateDockedBounds, clamp, nearestDock } = require("./geometry.cjs");

const DATA_HOME = path.resolve(process.env.AGENT_ACHIEVEMENTS_HOME || path.join(os.homedir(), ".agent-achievements"));
const STATE_PATH = path.join(DATA_HOME, "state.json");
const PRESENCE_PATH = path.join(DATA_HOME, "presence.json");
const SETTINGS_PATH = path.join(DATA_HOME, "companion-settings.json");
const COLLAPSED = { width: 76, height: 82 };
const EXPANDED = { width: 390, height: 580 };
const SNAP_DISTANCE = 34;
const EDGE_PEEK = 17;
const AVATAR_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "svg"];
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

let window;
let tray;
let expanded = false;
let lastPayload = "";
let quitting = false;
let movingProgrammatically = false;
let hideTimer;
let avatarCache = { key: "", value: null };
let companionSettings = readJson(SETTINGS_PATH, { dock: null, free_bounds: null });

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeSettings() {
  fs.mkdirSync(DATA_HOME, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, `${JSON.stringify(companionSettings, null, 2)}\n`, "utf8");
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
  const state = readJson(STATE_PATH, { achievements: [], progress: {}, tracked: [], awards: [] });
  const sessions = activeSessions();
  const achievements = state.achievements || [];
  const tracked = achievements.filter((item) => (state.tracked || []).includes(item.achievement_id)).slice(0, 3).map((item) => ({
    id: item.achievement_id,
    title: item.title,
    current: state.progress?.[item.achievement_id] || 0,
    target: item.condition?.target || 1,
    encouragement: item.tracking?.encouragement || item.intent
  }));
  const awards = (state.awards || []).slice(-3).reverse().map((award) => ({
    ...award,
    title: achievements.find((item) => item.achievement_id === award.achievement_id)?.title || award.achievement_id
  }));
  return { dataHome: DATA_HOME, sessions, tracked, awards, avatar: readAvatar() };
}

function currentWorkArea() {
  if (!window || window.isDestroyed()) return screen.getPrimaryDisplay().workArea;
  return screen.getDisplayMatching(window.getBounds()).workArea;
}

function setWindowBounds(bounds) {
  movingProgrammatically = true;
  window.setBounds(bounds, true);
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
  expanded = next;
  placeWindow({ peek: false });
  window.webContents.send("companion:expanded", expanded);
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
  if (movingProgrammatically || !window || window.isDestroyed()) return;
  const bounds = window.getBounds();
  const work = screen.getDisplayMatching(bounds).workArea;
  const dock = nearestDock(bounds, work, SNAP_DISTANCE);
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

function refreshTrayMenu() {
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "显示桌面伙伴", click: () => { window.showInactive(); revealFromEdge(); } },
    { label: "打开成就目录", click: () => shell.openPath(DATA_HOME) },
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
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false }
  });
  window.setAlwaysOnTop(true, "floating");
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
  const icon = nativeImage.createFromPath(path.join(__dirname, "pet.svg")).resize({ width: 18, height: 18 });
  tray = new Tray(icon);
  tray.setToolTip("Agent Achievements Companion");
  refreshTrayMenu();
  tray.on("click", () => { window.showInactive(); revealFromEdge(); });
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    createWindow();
    createTray();
    ipcMain.on("companion:toggle", () => setExpanded(!expanded));
    ipcMain.on("companion:collapse", () => { setExpanded(false); retreatToEdge(); });
    ipcMain.on("companion:hover", (_event, hovering) => hovering ? revealFromEdge() : retreatToEdge());
    ipcMain.handle("companion:choose-avatar", async () => {
      const result = await dialog.showOpenDialog(window, { title: "选择伙伴形象", properties: ["openFile"], filters: [{ name: "图片", extensions: AVATAR_EXTENSIONS }] });
      if (!result.canceled && result.filePaths[0]) installAvatar(result.filePaths[0]);
      sync();
    });
    ipcMain.handle("companion:reset-avatar", () => { clearAvatarFiles(); sync(); });
    ipcMain.handle("companion:get-autostart", () => getAutostart());
    ipcMain.handle("companion:set-autostart", (_event, enabled) => setAutostart(Boolean(enabled)));
    screen.on("display-metrics-changed", () => placeWindow({ peek: Boolean(companionSettings.dock) && !expanded }));
    setInterval(sync, 1000).unref();
    sync();
  });
  app.on("second-instance", () => { if (window) { window.showInactive(); setExpanded(true); } });
  app.on("window-all-closed", (event) => event.preventDefault());
}
