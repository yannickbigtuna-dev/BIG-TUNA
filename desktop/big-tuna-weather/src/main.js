const { app, BrowserWindow, Tray, ipcMain, nativeImage } = require('electron');
const fs = require('fs');
const https = require('https');
const path = require('path');

const HALIFAX = { name: 'Halifax, NS', admin: 'Nova Scotia', country: 'Canada', latitude: 44.6488, longitude: -63.5752, fallback: true };
const MAIN_SIZE = { width: 1180, height: 760 };
const PANEL_SIZE = { width: 430, height: 610 };
const SOURCES = {
  'open-meteo': 'Open-Meteo',
  nws: 'NOAA / NWS',
};

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
      headers: { Accept: 'application/json', 'User-Agent': 'BIG-TUNA Weather (https://yannickmorgans.ca)' },
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

function heading(deg) {
  return `${Math.round((((Number(deg) || 0) % 360) + 360) % 360)}°`;
}

function displayName(hit) {
  const region = hit.admin1 || hit.country_code || hit.country || '';
  return region ? `${hit.name}, ${region}` : hit.name;
}

function wmoFromText(text) {
  const value = String(text || '').toLowerCase();
  if (value.includes('thunder')) return 95;
  if (value.includes('snow') || value.includes('sleet')) return 73;
  if (value.includes('rain') || value.includes('shower') || value.includes('drizzle')) return 61;
  if (value.includes('fog') || value.includes('haze')) return 45;
  if (value.includes('cloud') || value.includes('overcast')) return 3;
  if (value.includes('sun') || value.includes('clear')) return 0;
  return 2;
}

function directionDegrees(direction) {
  const map = { N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5, S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5 };
  return map[String(direction || '').toUpperCase()] ?? 0;
}

function emptyDaily() {
  return {
    time: [],
    weather_code: [],
    temperature_2m_max: [],
    temperature_2m_min: [],
    apparent_temperature_max: [],
    apparent_temperature_min: [],
    precipitation_sum: [],
    wind_speed_10m_max: [],
    relative_humidity_2m_mean: [],
    pressure_msl_mean: [],
    uv_index_max: [],
    sunrise: [],
    sunset: [],
  };
}

function groupDailyFromHourly(hourly) {
  const daily = emptyDaily();
  const byDay = new Map();
  hourly.time.forEach((iso, index) => {
    const day = iso.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, { temps: [], feels: [], humidity: [], pressure: [], precip: [], wind: [], uv: [], codes: [] });
    byDay.get(day).temps.push(hourly.temperature_2m[index]);
    byDay.get(day).feels.push(hourly.apparent_temperature?.[index] ?? hourly.temperature_2m[index]);
    byDay.get(day).humidity.push(hourly.relative_humidity_2m?.[index]);
    byDay.get(day).pressure.push(hourly.pressure_msl?.[index]);
    byDay.get(day).precip.push(hourly.precipitation?.[index]);
    byDay.get(day).wind.push(hourly.wind_speed_10m?.[index]);
    byDay.get(day).uv.push(hourly.uv_index?.[index]);
    byDay.get(day).codes.push(hourly.weather_code[index]);
  });
  const clean = values => values.map(Number).filter(Number.isFinite);
  const mean = values => {
    const valid = clean(values);
    return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : NaN;
  };
  Array.from(byDay.entries()).slice(0, 7).forEach(([day, entry]) => {
    const temps = clean(entry.temps);
    const feels = clean(entry.feels);
    daily.time.push(day);
    daily.temperature_2m_min.push(temps.length ? Math.min(...temps) : NaN);
    daily.temperature_2m_max.push(temps.length ? Math.max(...temps) : NaN);
    daily.weather_code.push(entry.codes[0] ?? 2);
    daily.apparent_temperature_min.push(feels.length ? Math.min(...feels) : NaN);
    daily.apparent_temperature_max.push(feels.length ? Math.max(...feels) : NaN);
    daily.precipitation_sum.push(clean(entry.precip).reduce((sum, value) => sum + value, 0));
    daily.wind_speed_10m_max.push(clean(entry.wind).length ? Math.max(...clean(entry.wind)) : NaN);
    daily.relative_humidity_2m_mean.push(mean(entry.humidity));
    daily.pressure_msl_mean.push(mean(entry.pressure));
    daily.uv_index_max.push(clean(entry.uv).length ? Math.max(...clean(entry.uv)) : NaN);
    daily.sunrise.push('');
    daily.sunset.push('');
  });
  return daily;
}

function enrichDailyFromHourly(data) {
  const grouped = groupDailyFromHourly(data.hourly);
  ['relative_humidity_2m_mean', 'pressure_msl_mean'].forEach(key => {
    if (!data.daily[key]) data.daily[key] = grouped[key];
  });
  return data;
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
  const wind = current ? `${Math.round(current.wind_speed_10m)} km/h ${heading(current.wind_direction_10m)}` : '';
  const temp = current ? `${Math.round(current.temperature_2m)}°` : '';
  const condition = current ? weatherLabel(current.weather_code) : '';
  const icon = current ? weatherIcon(current.weather_code) : '';
  const title = current
    ? {
      compact: `${icon} ${temp}  ≋ ${Math.round(current.wind_speed_10m)} ${heading(current.wind_direction_10m)}`,
      balanced: `${icon} ${temp}  |  ≋ ${wind}`,
      detailed: `${icon} ${temp} ${condition}  |  ≋ ${wind}`,
    }[store.menuBarStyle || 'balanced']
    : 'Weather';
  if (process.platform === 'darwin') tray.setTitle(title);
  tray.setToolTip(current ? `${selectedLocation.name}: ${condition}` : 'BIG TUNA Weather');
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

async function fetchOpenMeteo(loc) {
  const params = new URLSearchParams({
    latitude: loc.latitude,
    longitude: loc.longitude,
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,uv_index,pressure_msl,weather_code,wind_speed_10m,wind_direction_10m',
    hourly: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,precipitation,uv_index,pressure_msl,weather_code,wind_speed_10m,wind_direction_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_sum,wind_speed_10m_max,uv_index_max,sunrise,sunset',
    timezone: 'auto',
    temperature_unit: 'celsius',
    wind_speed_unit: 'kmh',
  });
  const data = await requestJson(`https://api.open-meteo.com/v1/forecast?${params}`);
  data.source = 'open-meteo';
  data.sourceLabel = SOURCES['open-meteo'];
  return enrichDailyFromHourly(data);
}

async function fetchNws(loc) {
  const point = await requestJson(`https://api.weather.gov/points/${Number(loc.latitude).toFixed(4)},${Number(loc.longitude).toFixed(4)}`);
  const [hourlyRaw, grid] = await Promise.all([
    requestJson(point.properties.forecastHourly),
    requestJson(point.properties.forecastGridData),
  ]);
  const periods = hourlyRaw.properties.periods.slice(0, 72);
  if (!periods.length) throw new Error('NWS forecast unavailable');
  const gridProps = grid.properties || {};
  const valueAt = (name, index, fallback = NaN) => {
    const values = gridProps[name] && gridProps[name].values;
    return values && values[index] && Number.isFinite(values[index].value) ? values[index].value : fallback;
  };
  const toC = f => (f - 32) * 5 / 9;
  const hourly = {
    time: [],
    temperature_2m: [],
    apparent_temperature: [],
    relative_humidity_2m: [],
    precipitation_probability: [],
    precipitation: [],
    uv_index: [],
    pressure_msl: [],
    weather_code: [],
    wind_speed_10m: [],
    wind_direction_10m: [],
  };
  periods.forEach((period, index) => {
    const temp = period.temperatureUnit === 'F' ? toC(period.temperature) : period.temperature;
    hourly.time.push(period.startTime);
    hourly.temperature_2m.push(temp);
    hourly.apparent_temperature.push(valueAt('apparentTemperature', index, temp));
    hourly.relative_humidity_2m.push(valueAt('relativeHumidity', index, NaN));
    hourly.precipitation_probability.push(valueAt('probabilityOfPrecipitation', index, NaN));
    hourly.precipitation.push(valueAt('quantitativePrecipitation', index, 0));
    hourly.uv_index.push(NaN);
    hourly.pressure_msl.push(valueAt('pressure', index, 1013));
    hourly.weather_code.push(wmoFromText(period.shortForecast));
    hourly.wind_speed_10m.push(parseFloat(period.windSpeed) * 1.60934 || valueAt('windSpeed', index, 0));
    hourly.wind_direction_10m.push(directionDegrees(period.windDirection) || valueAt('windDirection', index, 0));
  });
  const first = periods[0];
  const temp = first.temperatureUnit === 'F' ? toC(first.temperature) : first.temperature;
  return {
    source: 'nws',
    sourceLabel: SOURCES.nws,
    current: {
      temperature_2m: temp,
      apparent_temperature: valueAt('apparentTemperature', 0, temp),
      relative_humidity_2m: valueAt('relativeHumidity', 0, NaN),
      precipitation: valueAt('quantitativePrecipitation', 0, 0),
      uv_index: NaN,
      pressure_msl: 1013,
      weather_code: wmoFromText(first.shortForecast),
      wind_speed_10m: parseFloat(first.windSpeed) * 1.60934 || valueAt('windSpeed', 0, 0),
      wind_direction_10m: directionDegrees(first.windDirection) || valueAt('windDirection', 0, 0),
    },
    hourly,
    daily: groupDailyFromHourly(hourly),
  };
}

async function fetchWeather(loc) {
  try {
    return await fetchNws(loc);
  } catch {
    return fetchOpenMeteo(loc);
  }
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
