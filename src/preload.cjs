const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("loopframe", {
  getMeta: () => ipcRenderer.invoke("meta:get"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  removeConnection: () => ipcRenderer.invoke("settings:remove-connection"),
  removeAll: () => ipcRenderer.invoke("settings:remove-all"),
  listHistory: () => ipcRenderer.invoke("history:list"),
  getDonation: () => ipcRenderer.invoke("donation:get"),
  connect: (credentials) => ipcRenderer.invoke("console:connect", credentials),
  refreshDevices: () => ipcRenderer.invoke("console:refresh-devices"),
  testSavedConnection: () => ipcRenderer.invoke("console:test-saved"),
  processImage: (payload) => ipcRenderer.invoke("image:process", payload),
  publish: (payload) => ipcRenderer.invoke("publish:apply", payload),
  restore: (backup) => ipcRenderer.invoke("publish:restore", backup),
  listBackups: () => ipcRenderer.invoke("backups:list"),
  openExternal: (url) => ipcRenderer.invoke("external:open", url),
  getPathForFile: (file) => webUtils.getPathForFile(file),
});
