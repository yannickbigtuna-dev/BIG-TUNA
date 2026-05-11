const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } = require('electron');
const fs = require('fs');
const https = require('https');
const path = require('path');

const API_BASE_URL = 'https://yannickmorgans.ca';
const WINDOW_SIZE = { width: 318, height: 424 };

let mainWindow = null;
let tray = null;
let currentOn = false;
let currentUpdatedAt = '';
let eventsReq = null;
let eventsBuffer = '';
let reconnectTimer = null;
let credentials = {};

function credentialsPath() {
  return path.join(app.getPath('userData'), 'session.json');
}

function loadCredentials() {
  try {
    credentials = JSON.parse(fs.readFileSync(credentialsPath(), 'utf8'));
  } catch {
    credentials = {};
  }
}

function saveCredentials(nextCredentials) {
  credentials = nextCredentials || {};
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(credentialsPath(), JSON.stringify(credentials, null, 2));
}

function clearCredentials() {
  credentials = {};
  try { fs.unlinkSync(credentialsPath()); } catch {}
}

function requestJson(method, apiPath, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(apiPath, API_BASE_URL);
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      method,
      hostname: url.hostname,
      path: url.pathname + url.search,
      protocol: url.protocol,
      headers: {
        Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch {}
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const err = new Error(data.error || `Request failed (${res.statusCode})`);
          err.statusCode = res.statusCode;
          err.data = data;
          reject(err);
          return;
        }
        resolve(data);
      });
    });
    req.on('error', reject);
    req.setTimeout(12000, () => req.destroy(new Error('Request timed out')));
    if (payload) req.write(payload);
    req.end();
  });
}

function bulbIconSvg(on) {
  const fill = on ? '#ffffff' : 'none';
  const stroke = '#ffffff';
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24">
      <path d="M9 21h6v-1.7H9V21Zm1-3.3h4v-1.35c0-1.22.61-2.35 1.63-3.04A6.1 6.1 0 0 0 18.35 8.2C18.35 4.78 15.5 2 12 2S5.65 4.78 5.65 8.2c0 2.05 1.03 3.96 2.72 5.11A3.65 3.65 0 0 1 10 16.35v1.35Z" fill="${fill}" stroke="${stroke}" stroke-width="1.65" stroke-linejoin="round"/>
    </svg>`;
}

function createBulbImage(on) {
  const svg = bulbIconSvg(on).replace(/\s+/g, ' ').trim();
  const image = nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  return image.resize({ width: 18, height: 18 });
}

function updateTrayIcon() {
  if (!tray) return;
  tray.setImage(createBulbImage(currentOn));
  tray.setToolTip(`BIG TUNA Lights: ${currentOn ? 'On' : 'Off'}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: currentOn ? 'Turn Off' : 'Turn On', click: () => toggleFromTray() },
    { label: 'Show Window', click: showWindow },
    { label: 'Refresh', click: refreshState },
    { type: 'separator' },
    { label: credentials.token ? 'Logout' : 'Login', click: () => credentials.token ? logout() : showWindow() },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
}

function sendToWindow(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function applyState(data) {
  if (!data || typeof data.on !== 'boolean') return;
  if (data.updatedAt) currentUpdatedAt = data.updatedAt;
  currentOn = data.on;
  updateTrayIcon();
  sendToWindow('lights:state', { on: currentOn, updatedAt: currentUpdatedAt });
}

async function refreshState() {
  try {
    const data = await requestJson('GET', '/api/lights');
    applyState(data);
    return { ok: true, ...data };
  } catch (error) {
    sendToWindow('lights:error', { message: error.message || 'State unavailable' });
    return { ok: false, error: error.message || 'State unavailable' };
  }
}

async function setLight(on) {
  if (!credentials.token) return { ok: false, error: 'Login required' };
  try {
    const data = await requestJson('POST', '/api/lights', { on }, credentials.token);
    applyState(data);
    return { ok: true, ...data };
  } catch (error) {
    if (error.statusCode === 401) clearCredentials();
    sendToWindow('lights:error', { message: error.message || 'Save failed' });
    sendAuthState();
    return { ok: false, error: error.message || 'Save failed' };
  }
}

async function toggleFromTray() {
  await setLight(!currentOn);
}

function showWindow() {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
}

function sendAuthState() {
  sendToWindow('auth:state', {
    username: credentials.username || '',
    canControl: (credentials.username || '').toLowerCase() === 'yannick' && !!credentials.token,
    loggedIn: !!credentials.token,
  });
  updateTrayIcon();
}

async function logout() {
  const token = credentials.token;
  clearCredentials();
  sendAuthState();
  if (token) {
    try { await requestJson('POST', '/api/auth/logout', null, token); } catch {}
  }
}

function connectEvents() {
  if (eventsReq) eventsReq.destroy();
  if (reconnectTimer) clearTimeout(reconnectTimer);

  const url = new URL('/api/lights/events', API_BASE_URL);
  eventsReq = https.get({
    hostname: url.hostname,
    path: url.pathname,
    protocol: url.protocol,
    headers: { Accept: 'text/event-stream' },
  }, res => {
    res.setEncoding('utf8');
    res.on('data', chunk => {
      eventsBuffer += chunk;
      const events = eventsBuffer.split('\n\n');
      eventsBuffer = events.pop() || '';
      for (const event of events) {
        const line = event.split('\n').find(part => part.startsWith('data:'));
        if (!line) continue;
        try { applyState(JSON.parse(line.slice(5).trim())); } catch {}
      }
    });
    res.on('end', scheduleReconnect);
  });
  eventsReq.on('error', scheduleReconnect);
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectEvents();
  }, 2000);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    ...WINDOW_SIZE,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'BIG TUNA Lights',
    backgroundColor: '#101216',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    refreshState();
    sendAuthState();
  });
  mainWindow.on('close', event => {
    if (app.isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
  mainWindow.on('minimize', event => {
    event.preventDefault();
    mainWindow.hide();
  });
}

ipcMain.handle('auth:get', () => ({
  username: credentials.username || '',
  canControl: (credentials.username || '').toLowerCase() === 'yannick' && !!credentials.token,
  loggedIn: !!credentials.token,
}));
ipcMain.handle('auth:login', async (_event, { username, password }) => {
  try {
    const data = await requestJson('POST', '/api/auth/login', { username, password });
    saveCredentials({ token: data.token, username: data.username });
    sendAuthState();
    return { ok: true, username: data.username };
  } catch (error) {
    return { ok: false, error: error.message || 'Login failed' };
  }
});
ipcMain.handle('auth:logout', logout);
ipcMain.handle('lights:get', refreshState);
ipcMain.handle('lights:set', (_event, on) => setLight(on === true));
ipcMain.handle('window:hide', () => mainWindow && mainWindow.hide());

app.whenReady().then(() => {
  loadCredentials();
  if (process.platform === 'darwin') app.dock.hide();
  tray = new Tray(createBulbImage(false));
  tray.on('click', toggleFromTray);
  updateTrayIcon();
  createWindow();
  connectEvents();
});

app.on('activate', showWindow);
app.on('before-quit', () => {
  app.isQuitting = true;
  if (eventsReq) eventsReq.destroy();
});
