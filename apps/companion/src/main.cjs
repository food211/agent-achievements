const { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DATA_HOME = path.resolve(process.env.AGENT_ACHIEVEMENTS_HOME || path.join(os.homedir(), ".agent-achievements"));
const STATE_PATH = path.join(DATA_HOME, "state.json");
const PRESENCE_PATH = path.join(DATA_HOME, "presence.json");
const COLLAPSED = { width: 154, height: 174 };
const EXPANDED = { width: 370, height: 520 };

let window;
let tray;
let expanded = false;
let lastPayload = "";
let quitting = false;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function activeSessions() {
  const now = Date.now();
  const presence = readJson(PRESENCE_PATH, { sessions: [] });
  return presence.sessions.filter((session) =>
    session.status !== "stopped" && new Date(session.expires_at).getTime() > now
  );
}

function currentPayload() {
  const state = readJson(STATE_PATH, { achievements: [], progress: {}, tracked: [], awards: [] });
  const sessions = activeSessions();
  const achievements = state.achievements || [];
  const tracked = achievements
    .filter((item) => (state.tracked || []).includes(item.achievement_id))
    .slice(0, 3)
    .map((item) => ({
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
  return { dataHome: DATA_HOME, sessions, tracked, awards };
}

function placeWindow(size) {
  const display = screen.getPrimaryDisplay().workArea;
  window.setBounds({
    width: size.width,
    height: size.height,
    x: display.x + display.width - size.width - 22,
    y: display.y + display.height - size.height - 22
  }, true);
}

function setExpanded(next) {
  expanded = next;
  placeWindow(expanded ? EXPANDED : COLLAPSED);
  window.webContents.send("companion:expanded", expanded);
}

function sync() {
  if (!window || window.isDestroyed()) return;
  const payload = currentPayload();
  const serialized = JSON.stringify(payload);
  if (serialized !== lastPayload) {
    lastPayload = serialized;
    window.webContents.send("companion:state", payload);
  }
  if (payload.sessions.length > 0) {
    if (!window.isVisible()) window.showInactive();
  } else if (window.isVisible()) {
    setExpanded(false);
    window.hide();
  }
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
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  window.setAlwaysOnTop(true, "floating");
  window.loadFile(path.join(__dirname, "index.html"));
  window.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      window.hide();
    }
  });
  placeWindow(COLLAPSED);
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, "pet.svg")).resize({ width: 18, height: 18 });
  tray = new Tray(icon);
  tray.setToolTip("Agent Achievements Companion");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "显示桌面伙伴", click: () => { window.showInactive(); sync(); } },
    { label: "打开成就目录", click: () => require("electron").shell.openPath(DATA_HOME) },
    { type: "separator" },
    { label: "退出", click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on("click", () => window.isVisible() ? window.hide() : window.showInactive());
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  ipcMain.on("companion:toggle", () => setExpanded(!expanded));
  ipcMain.on("companion:collapse", () => setExpanded(false));
  setInterval(sync, 1000).unref();
  sync();
});

app.on("window-all-closed", (event) => event.preventDefault());

