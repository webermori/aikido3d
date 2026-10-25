const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aikido', {
  info: () => ipcRenderer.invoke('assets:info'),
  chooseAssets: () => ipcRenderer.invoke('assets:choose'),
});
