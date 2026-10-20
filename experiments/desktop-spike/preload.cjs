const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aiWorkspace", Object.freeze({
  selectProvider: (provider, pane) => ipcRenderer.invoke("spike:select-provider", provider, pane),
  setLayout: (layout) => ipcRenderer.invoke("spike:set-layout", layout),
  listAgents: () => ipcRenderer.invoke("spike:list-agents"),
}));
