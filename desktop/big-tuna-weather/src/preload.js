const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('BigTunaWeather', {
  getState: () => ipcRenderer.invoke('weather:get-state'),
  selectLocation: key => ipcRenderer.invoke('weather:select-location', key),
  searchCity: query => ipcRenderer.invoke('weather:search-city', query),
  refresh: () => ipcRenderer.invoke('weather:refresh'),
  openMain: () => ipcRenderer.invoke('window:open-main'),
  hidePanel: () => ipcRenderer.invoke('window:hide-panel'),
  onState: handler => ipcRenderer.on('weather:state', (_event, data) => handler(data)),
});
