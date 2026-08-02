const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("companionBubble", {
  open: () => ipcRenderer.send("companion:bubble-open"),
  dismiss: () => ipcRenderer.send("companion:bubble-dismiss"),
  sendAgentMessage: (text) => ipcRenderer.invoke("companion:send-agent-message", text),
  onMode: (listener) => ipcRenderer.on("companion:bubble-mode", (_event, mode) => listener(mode)),
  onPlacement: (listener) => ipcRenderer.on("companion:bubble-placement", (_event, placement) => listener(placement)),
  onMessage: (listener) => ipcRenderer.on("companion:bubble-message", (_event, message) => listener(message)),
  onState: (listener) => ipcRenderer.on("companion:state", (_event, payload) => listener(payload))
});
