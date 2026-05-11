const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('BigTunaLights', {
  getAuth: () => ipcRenderer.invoke('auth:get'),
  login: credentials => ipcRenderer.invoke('auth:login', credentials),
  logout: () => ipcRenderer.invoke('auth:logout'),
  getState: () => ipcRenderer.invoke('lights:get'),
  setState: on => ipcRenderer.invoke('lights:set', on),
  hideWindow: () => ipcRenderer.invoke('window:hide'),
  onState: handler => ipcRenderer.on('lights:state', (_event, data) => handler(data)),
  onAuth: handler => ipcRenderer.on('auth:state', (_event, data) => handler(data)),
  onError: handler => ipcRenderer.on('lights:error', (_event, data) => handler(data)),
});
