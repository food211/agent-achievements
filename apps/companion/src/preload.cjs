const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agentCompanion", {
  toggle: () => ipcRenderer.send("companion:toggle"),
  collapse: () => ipcRenderer.send("companion:collapse"),
  chooseAvatar: () => ipcRenderer.invoke("companion:choose-avatar"),
  resetAvatar: () => ipcRenderer.invoke("companion:reset-avatar"),
  getAutostart: () => ipcRenderer.invoke("companion:get-autostart"),
  setAutostart: (enabled) => ipcRenderer.invoke("companion:set-autostart", Boolean(enabled)),
  getAlwaysOnTop: () => ipcRenderer.invoke("companion:get-always-on-top"),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke("companion:set-always-on-top", Boolean(enabled)),
  openWuxing: () => ipcRenderer.invoke("companion:open-wuxing"),
  saveAchievement: (input) => ipcRenderer.invoke("companion:save-achievement", input),
  setAchievementTracking: (achievementId, enabled) => ipcRenderer.invoke("companion:set-achievement-tracking", achievementId, Boolean(enabled)),
  requestAchievementDesign: (brief) => ipcRenderer.invoke("companion:request-achievement-design", brief),
  requestAchievementDiagnostic: () => ipcRenderer.invoke("companion:request-achievement-diagnostic"),
  confirmDiagnosticDiscovery: (requestId, discoveryId) => ipcRenderer.invoke("companion:confirm-diagnostic-discovery", requestId, discoveryId),
  hover: (hovering) => ipcRenderer.send("companion:hover", Boolean(hovering)),
  dragPrepare: () => ipcRenderer.send("companion:drag-prepare"),
  dragMove: () => ipcRenderer.send("companion:drag-move"),
  dragEnd: (commit) => ipcRenderer.send("companion:drag-end", Boolean(commit)),
  transitionReady: () => ipcRenderer.send("companion:transition-ready"),
  onState: (listener) => ipcRenderer.on("companion:state", (_event, payload) => listener(payload)),
  onExpanded: (listener) => ipcRenderer.on("companion:expanded", (_event, value) => listener(value)),
  onAlwaysOnTop: (listener) => ipcRenderer.on("companion:always-on-top", (_event, value) => listener(value))
});
