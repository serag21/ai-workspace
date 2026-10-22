const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aiWorkspace", Object.freeze({
  selectProvider: (provider, pane) => ipcRenderer.invoke("spike:select-provider", provider, pane),
  setLayout: (layout) => ipcRenderer.invoke("spike:set-layout", layout),
  listAgents: () => ipcRenderer.invoke("spike:list-agents"),
  resumeAgent: (provider, sessionId) => ipcRenderer.invoke("spike:resume-agent", provider, sessionId),
  openNativeBrowser: (pane) => ipcRenderer.invoke("spike:open-native-browser", pane),
}));
