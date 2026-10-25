const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aiWorkspace", Object.freeze({
  selectProvider: (provider, pane) => ipcRenderer.invoke("spike:select-provider", provider, pane),
  setLayout: (layout) => ipcRenderer.invoke("spike:set-layout", layout),
  listAgents: () => ipcRenderer.invoke("spike:list-agents"),
  resumeAgent: (provider, sessionId) => ipcRenderer.invoke("spike:resume-agent", provider, sessionId),
  openNativeBrowser: (pane) => ipcRenderer.invoke("spike:open-native-browser", pane),
  onProviderStatus: (callback) => {
    if (typeof callback !== "function") throw new TypeError("Expected status callback.");
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("spike:provider-status", listener);
    return () => ipcRenderer.removeListener("spike:provider-status", listener);
  },
}));
