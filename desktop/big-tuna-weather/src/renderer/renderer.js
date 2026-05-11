const api = window.BigTunaWeather;
const mode = new URLSearchParams(location.search).get('mode') || 'main';
document.body.classList.toggle('panel', mode === 'panel');

const els = {
  form: document.getElementById('search-form'),
  input: document.getElementById('city-input'),
  locations: document.getElementById('locations'),
  place: document.getElementById('place'),
  largeIcon: document.getElementById('large-icon'),
  condition: document.getElementById('condition'),
  temp: document.getElementById('temp'),
  high: document.getElementById('high'),
  low: document.getElementById('low'),
  feels: document.getElementById('feels'),
  windMeta: document.getElementById('wind-meta'),
  precip: document.getElementById('precip'),
  humidity: document.getElementById('humidity'),
  pressure: document.getElementById('pressure'),
  hourly: document.getElementById('hourly'),
  daily: document.getElementById('daily'),
  message: document.getElementById('message'),
  hide: document.getElementById('hide-btn'),
  openMain: document.getElementById('open-main'),
  panelOpenRow: document.getElementById('panel-open-row'),
  updated: document.getElementById('updated'),
};

function keyFor(loc) {
  return `${Number(loc.latitude).toFixed(3)},${Number(loc.longitude).toFixed(3)}`;
}

function weatherMeta(code) {
  const map = {
    0: ['☀️', 'Sunny'], 1: ['🌤️', 'Mostly Clear'], 2: ['🌤️', 'Partly Cloudy'], 3: ['☁️', 'Cloudy'],
    45: ['🌫️', 'Fog'], 48: ['🌫️', 'Fog'], 51: ['🌦️', 'Light Drizzle'], 53: ['🌦️', 'Drizzle'],
    55: ['🌧️', 'Heavy Drizzle'], 61: ['🌧️', 'Light Rain'], 63: ['🌧️', 'Rain'], 65: ['🌧️', 'Heavy Rain'],
    71: ['🌨️', 'Light Snow'], 73: ['🌨️', 'Snow'], 75: ['🌨️', 'Heavy Snow'], 80: ['🌦️', 'Showers'],
    81: ['🌦️', 'Showers'], 82: ['⛈️', 'Heavy Showers'], 95: ['⛈️', 'Thunderstorm'],
  };
  return map[code] || ['🌤️', 'Partly Cloudy'];
}

function compass(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

function windArrowStyle(speed, direction) {
  const size = Math.round(Math.min(42, Math.max(17, 17 + (Number(speed) || 0) * 1.1)));
  const rotation = (((Number(direction) || 0) + 180) % 360).toFixed(0);
  return `--wind-size:${size}px;--wind-rotation:${rotation}deg`;
}

function fmtTemp(value) {
  return Number.isFinite(value) ? `${Math.round(value)}°` : '--°';
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric' });
}

function fmtDay(iso, index) {
  if (index === 0) return 'Today';
  return new Date(`${iso}T12:00:00`).toLocaleDateString([], { weekday: 'short' });
}

function renderLocations(state) {
  if (mode === 'panel') return;
  els.locations.innerHTML = state.locations.map(loc => {
    const active = keyFor(loc) === state.selectedKey;
    const current = active && state.weather ? state.weather.current : null;
    const meta = weatherMeta(current ? current.weather_code : 2);
    return `<button class="loc${active ? ' active' : ''}" type="button" data-key="${keyFor(loc)}">
      <span class="loc-icon">${meta[0]}</span>
      <span><span class="loc-name">${loc.name}</span><span class="loc-condition">${current ? meta[1] : 'Saved Location'}</span></span>
      <span class="loc-temp">${current ? fmtTemp(current.temperature_2m) : ''}</span>
    </button>`;
  }).join('');
}

function render(state) {
  if (!state || !state.weather || !state.weather.current) return;
  const data = state.weather;
  const loc = state.selectedLocation;
  const current = data.current;
  const [icon, label] = weatherMeta(current.weather_code);
  const hi = data.daily.temperature_2m_max[0];
  const lo = data.daily.temperature_2m_min[0];
  renderLocations(state);
  els.place.textContent = loc.name;
  els.largeIcon.textContent = icon;
  els.condition.textContent = label;
  els.temp.textContent = fmtTemp(current.temperature_2m);
  els.high.textContent = `H: ${fmtTemp(hi)}`;
  els.low.textContent = `L: ${fmtTemp(lo)}`;
  els.feels.textContent = fmtTemp(current.apparent_temperature);
  els.windMeta.innerHTML = `<span class="wind-arrow" style="${windArrowStyle(current.wind_speed_10m, current.wind_direction_10m)}">➜</span><span>${Math.round(current.wind_speed_10m)} km/h ${compass(current.wind_direction_10m)}</span>`;
  els.precip.textContent = `${(Number(current.precipitation) || 0).toFixed(1)} mm/hr`;
  els.humidity.textContent = `${Math.round(current.relative_humidity_2m)}%`;
  els.pressure.textContent = `${Math.round(current.pressure_msl)} hPa`;
  els.updated.textContent = 'Updated now';

  const nowIndex = Math.max(0, data.hourly.time.findIndex(t => new Date(t) >= new Date()));
  els.hourly.innerHTML = data.hourly.time.slice(nowIndex, nowIndex + (mode === 'panel' ? 6 : 9)).map((time, offset) => {
    const index = nowIndex + offset;
    const hourMeta = weatherMeta(data.hourly.weather_code[index]);
    return `<div class="hour"><span class="hour-time">${offset === 0 ? 'Now' : fmtTime(time)}</span><span class="hour-icon">${hourMeta[0]}</span><span class="hour-temp">${fmtTemp(data.hourly.temperature_2m[index])}</span></div>`;
  }).join('');

  const minAll = Math.min(...data.daily.temperature_2m_min);
  const maxAll = Math.max(...data.daily.temperature_2m_max);
  const span = Math.max(1, maxAll - minAll);
  els.daily.innerHTML = data.daily.time.map((day, index) => {
    const dayMeta = weatherMeta(data.daily.weather_code[index]);
    const min = data.daily.temperature_2m_min[index];
    const max = data.daily.temperature_2m_max[index];
    const left = Math.max(0, ((min - minAll) / span) * 100);
    const width = Math.max(16, ((max - min) / span) * 100);
    const dot = Math.min(96, left + width);
    return `<div class="day">
      <span class="day-name">${fmtDay(day, index)}</span>
      <span class="day-icon">${dayMeta[0]}</span>
      <span class="day-condition">${dayMeta[1]}</span>
      <span class="low">${fmtTemp(min)}</span>
      <span class="range"><span style="left:${left}%;width:${width}%"></span><i style="left:${dot}%"></i></span>
      <span class="high">${fmtTemp(max)}</span>
    </div>`;
  }).join('');
  els.message.textContent = '';
}

els.locations.addEventListener('click', async event => {
  const btn = event.target.closest('.loc');
  if (!btn) return;
  els.message.textContent = 'Updating...';
  render(await api.selectLocation(btn.dataset.key));
});

els.form.addEventListener('submit', async event => {
  event.preventDefault();
  const query = els.input.value.trim();
  if (!query) return;
  els.message.textContent = 'Searching...';
  try {
    const state = await api.searchCity(query);
    els.input.value = '';
    render(state);
  } catch (error) {
    els.message.textContent = error.message || 'Search failed';
  }
});

els.hide.addEventListener('click', () => api.hidePanel());
els.openMain.addEventListener('click', () => api.openMain());
els.panelOpenRow.addEventListener('click', () => api.openMain());
api.onState(render);

(async function init() {
  render(await api.getState());
  render(await api.refresh());
})();
