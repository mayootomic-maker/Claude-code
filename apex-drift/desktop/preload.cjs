// The same bridge the Android shell provides, minus what a computer lacks.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('ApexNative', {
  desktop: true,
  version: () => '3.0.0',
  vibrate: () => {},
  exitApp: () => ipcRenderer.send('apex:exit'),
})
