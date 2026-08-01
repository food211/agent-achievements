const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agentCompanion", {
  toggle: () => ipcRenderer.send("companion:toggle"),
  collapse: () => ipcRenderer.send("companion:collapse"),
  onState: (listener) => ipcRenderer.on("companion:state", (_event, payload) => listener(payload)),
  onExpanded: (listener) => ipcRenderer.on("companion:expanded", (_event, value) => listener(value))
});

