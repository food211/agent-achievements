const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agentCompanion", {
  toggle: () => ipcRenderer.send("companion:toggle"),
  collapse: () => ipcRenderer.send("companion:collapse"),
  chooseAvatar: () => ipcRenderer.invoke("companion:choose-avatar"),
  resetAvatar: () => ipcRenderer.invoke("companion:reset-avatar"),
  getAutostart: () => ipcRenderer.invoke("companion:get-autostart"),
  setAutostart: (enabled) => ipcRenderer.invoke("companion:set-autostart", Boolean(enabled)),
  hover: (hovering) => ipcRenderer.send("companion:hover", Boolean(hovering)),
  onState: (listener) => ipcRenderer.on("companion:state", (_event, payload) => listener(payload)),
  onExpanded: (listener) => ipcRenderer.on("companion:expanded", (_event, value) => listener(value))
});
