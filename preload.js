const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('islet', {
  onMedia: (cb) => ipcRenderer.on('media', (_e, state) => cb(state)),
  control: (action, value) => ipcRenderer.invoke('media:control', action, value),
  lyrics: (query) => ipcRenderer.invoke('lyrics:get', query),
  onExpand: (cb) => ipcRenderer.on('expand', (_e, on) => cb(on)),
  reportState: (state) => ipcRenderer.send('island:state', state),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
  startDrag: (filePath) => ipcRenderer.send('shelf:drag', filePath),
  reveal: (filePath) => ipcRenderer.send('shelf:reveal', filePath),
  openAutomation: () => ipcRenderer.send('app:openAutomation'),
  menu: () => ipcRenderer.send('app:menu'),
});
