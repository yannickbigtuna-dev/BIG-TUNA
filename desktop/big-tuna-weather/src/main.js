const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage } = require('electron');
const fs = require('fs');
const https = require('https');
const path = require('path');

const HALIFAX = { name: 'Halifax, NS', admin: 'Nova Scotia', country: 'Canada', latitude: 44.6488, longitude: -63.5752, fallback: true };
const MAIN_SIZE = { width: 1180, height: 760 };
const PANEL_SIZE = { width: 430, height: 610 };

let mainWindow = null;
let panelWindow = null;
let tray = null;
let store = { locations: [HALIFAX], selectedKey: keyFor(HALIFAX), menuBarStyle: 'balanced' };
let weather = null;
let selectedLocation = HALIFAX;
let refreshTimer = null;

function keyFor(loc) {
  return `${Number(loc.latitude).toFixed(3)},${Number(loc.longitude).toFixed(3)}`;
}

function storePath() {
  return path.join(app.getPath('userData'), 'weather.json');
}

function loadStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
    if (Array.isArray(parsed.locations) && parsed.locations.length) {
      store = {
        locations: parsed.locations,
        selectedKey: parsed.selectedKey || keyFor(parsed.locations[0]),
        menuBarStyle: parsed.menuBarStyle || 'balanced',
      };
    }
  } catch {
    store = { locations: [HALIFAX], selectedKey: keyFor(HALIFAX), menuBarStyle: 'balanced' };
  }
  selectedLocation = store.locations.find(loc => keyFor(loc) === store.selectedKey) || store.locations[0] || HALIFAX;
}

function saveStore() {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(storePath(), JSON.stringify(store, null, 2));
}

function requestJson(urlString) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const req = https.get({
      hostname: url.hostname,
      path: url.pathname + url.search,
      protocol: url.protocol,
      headers: { Accept: 'application/json' },
    }, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch {}
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Request failed (${res.statusCode})`));
          return;
        }
        resolve(data);
      });
    });
    req.on('error', reject);
    req.setTimeout(12000, () => req.destroy(new Error('Request timed out')));
  });
}

function weatherIcon(code) {
  if (code === 0) return '☀️';
  if ([1, 2].includes(code)) return '🌤️';
  if (code === 3) return '☁️';
  if ([45, 48].includes(code)) return '🌫️';
  if ([71, 73, 75].includes(code)) return '🌨️';
  if ([95, 96, 99].includes(code)) return '⛈️';
  return '🌧️';
}

function weatherLabel(code) {
  const labels = {
    0: 'Sunny',
    1: 'Mostly Clear',
    2: 'Partly Cloudy',
    3: 'Cloudy',
    45: 'Fog',
    48: 'Fog',
    51: 'Light Drizzle',
    53: 'Drizzle',
    55: 'Heavy Drizzle',
    61: 'Light Rain',
    63: 'Rain',
    65: 'Heavy Rain',
    71: 'Light Snow',
    73: 'Snow',
    75: 'Heavy Snow',
    80: 'Showers',
    81: 'Showers',
    82: 'Heavy Showers',
    95: 'Thunderstorm',
  };
  return labels[code] || 'Partly Cloudy';
}

function compass(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

function displayName(hit) {
  const region = hit.admin1 || hit.country_code || hit.country || '';
  return region ? `${hit.name}, ${region}` : hit.name;
}

function trayImage() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24">
    <path d="M12 4.2a7.8 7.8 0 1 0 0 15.6 7.8 7.8 0 0 0 0-15.6Zm0 2.1a5.7 5.7 0 1 1 0 11.4 5.7 5.7 0 0 1 0-11.4Z" fill="#000"/>
  </svg>`;
  const image = nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`).resize({ width: 18, height: 18 });
  image.setTemplateImage(true);
  return image;
}

function updateTray() {
  if (!tray) return;
  const current = weather && weather.current;
  const wind = current ? `${Math.round(current.wind_speed_10m)} km/h ${compass(current.wind_direction_10m)}` : '';
  const temp = current ? `${Math.round(current.temperature_2m)}°` : '';
  const condition = current ? weatherLabel(current.weather_code) : '';
  const icon = current ? weatherIcon(current.weather_code) : '';
  const title = current
    ? {
      compact: `${icon} ${temp}  ≋ ${Math.round(current.wind_speed_10m)} ${compass(current.wind_direction_10m)}`,
      balanced: `${icon} ${temp}  |  ≋ ${wind}`,
      detailed: `${icon} ${temp} ${condition}  |  ≋ ${wind}`,
    }[store.menuBarStyle || 'balanced']
    : 'Weather';
  if (process.platform === 'darwin') tray.setTitle(title);
  tray.setToolTip(current ? `${selectedLocation.name}: ${condition}` : 'BIG TUNA Weather');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Weather', click: showMainWindow },
    { label: 'Refresh', click: refreshWeather },
    {
      label: 'Menu Bar Style',
      submenu: ['compact', 'balanced', 'detailed'].map(style => ({
        label: style[0].toUpperCase() + style.slice(1),
        type: 'radio',
        checked: (store.menuBarStyle || 'balanced') === style,
        click: () => {
          store.menuBarStyle = style;
          saveStore();
          updateTray();
        },
      })),
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
}

function sendState() {
  const data = {
    locations: store.locations,
    selectedKey: keyFor(selectedLocation),
    selectedLocation,
    menuBarStyle: store.menuBarStyle || 'balanced',
    weather,
  };
  for (const win of [mainWindow, panelWindow]) {
    if (win && !win.isDestroyed()) win.webContents.send('weather:state', data);
  }
  return data;
}

async function fetchWeather(loc) {
  const params = new URLSearchParams({
    latitude: loc.latitude,
    longitude: loc.longitude,
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,pressure_msl,weather_code,wind_speed_10m,wind_direction_10m',
    hourly: 'temperature_2m,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    timezone: 'auto',
    temperature_unit: 'celsius',
    wind_speed_unit: 'kmh',
  });
  return requestJson(`https://api.open-meteo.com/v1/forecast?${params}`);
}

async function refreshWeather() {
  try {
    weather = await fetchWeather(selectedLocation);
  } catch {
    if (keyFor(selectedLocation) !== keyFor(HALIFAX)) {
      selectedLocation = HALIFAX;
      weather = await fetchWeather(HALIFAX);
    }
  }
  updateTray();
  return sendState();
}

async function searchCity(query) {
  const params = new URLSearchParams({ name: query, count: '1', language: 'en', format: 'json' });
  const data = await requestJson(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
  const hit = data.results && data.results[0];
  if (!hit) throw new Error('City not found');
  const loc = {
    name: displayName(hit),
    admin: hit.admin1 || '',
    country: hit.country || '',
    latitude: hit.latitude,
    longitude: hit.longitude,
  };
  const key = keyFor(loc);
  store.locations = [loc, ...store.locations.filter(item => keyFor(item) !== key)].slice(0, 8);
  store.selectedKey = key;
  selectedLocation = loc;
  saveStore();
  await refreshWeather();
  return sendState();
}

async function selectLocation(key) {
  const loc = store.locations.find(item => keyFor(item) === key);
  if (!loc) return sendState();
  selectedLocation = loc;
  store.selectedKey = key;
  saveStore();
  await refreshWeather();
  return sendState();
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    ...MAIN_SIZE,
    minWidth: 920,
    minHeight: 640,
    show: false,
    title: 'BIG TUNA Weather',
    backgroundColor: '#f5f6f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { mode: 'main' } });
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    sendState();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createPanelWindow() {
  panelWindow = new BrowserWindow({
    ...PANEL_SIZE,
    show: false,
    frame: false,
    resizable: false,
    fullscreenable: false,
    title: 'Weather',
    backgroundColor: '#00000000',
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  panelWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { mode: 'panel' } });
  panelWindow.on('blur', () => panelWindow.hide());
  panelWindow.on('closed', () => {
    panelWindow = null;
  });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
  mainWindow.show();
  mainWindow.focus();
  sendState();
}

function togglePanel() {
  if (!panelWindow || panelWindow.isDestroyed()) createPanelWindow();
  if (panelWindow.isVisible()) {
    panelWindow.hide();
    return;
  }
  const bounds = tray.getBounds();
  const x = Math.round(bounds.x + (bounds.width / 2) - (PANEL_SIZE.width / 2));
  const y = Math.round(bounds.y + bounds.height + 6);
  panelWindow.setPosition(x, y, false);
  panelWindow.show();
  panelWindow.focus();
  sendState();
}

ipcMain.handle('weather:get-state', () => sendState());
ipcMain.handle('weather:select-location', (_event, key) => selectLocation(key));
ipcMain.handle('weather:search-city', (_event, query) => searchCity(String(query || '').trim()));
ipcMain.handle('weather:refresh', refreshWeather);
ipcMain.handle('window:open-main', () => showMainWindow());
ipcMain.handle('window:hide-panel', () => panelWindow && panelWindow.hide());

app.whenReady().then(async () => {
  loadStore();
  tray = new Tray(trayImage());
  tray.on('click', togglePanel);
  updateTray();
  createMainWindow();
  createPanelWindow();
  await refreshWeather();
  refreshTimer = setInterval(refreshWeather, 10 * 60 * 1000);
});

app.on('activate', showMainWindow);
app.on('before-quit', () => {
  if (refreshTimer) clearInterval(refreshTimer);
});
