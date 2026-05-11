const api = window.BigTunaWeather;
const mode = new URLSearchParams(location.search).get('mode') || 'main';
document.body.classList.toggle('panel', mode === 'panel');

const els = {
  form: document.getElementById('search-form'),
  input: document.getElementById('city-input'),
  locations: document.getElementById('locations'),
  place: document.getElementById('place'),
  condition: document.getElementById('condition'),
  temp: document.getElementById('temp'),
  feels: document.getElementById('feels'),
  wind: document.getElementById('wind'),
  humidity: document.getElementById('humidity'),
  hourly: document.getElementById('hourly'),
  daily: document.getElementById('daily'),
  message: document.getElementById('message'),
  hide: document.getElementById('hide-btn'),
  openMain: document.getElementById('open-main'),
};

function iconFor(code) {
  if (code === 0) return ['☀', 'Clear'];
  if ([1, 2].includes(code)) return ['🌤', 'Partly cloudy'];
  if (code === 3) return ['☁', 'Cloudy'];
  if ([45, 48].includes(code)) return ['🌫', 'Fog'];
  if ([71, 73, 75].includes(code)) return ['🌨', 'Snow'];
  if ([95, 96, 99].includes(code)) return ['⛈', 'Thunderstorm'];
  return ['🌧', 'Rain'];
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

function keyFor(loc) {
  return `${Number(loc.latitude).toFixed(3)},${Number(loc.longitude).toFixed(3)}`;
}

function renderLocations(state) {
  els.locations.innerHTML = state.locations.map(loc => {
    const active = keyFor(loc) === state.selectedKey;
    return `<button class="loc${active ? ' active' : ''}" type="button" data-key="${keyFor(loc)}">
      <span><span class="loc-name">${loc.name}</span><span class="loc-meta">${[loc.admin, loc.country].filter(Boolean).join(', ')}</span></span>
      <span>${active && state.weather ? fmtTemp(state.weather.current.temperature_2m) : ''}</span>
    </button>`;
  }).join('');
}

function render(state) {
  if (!state || !state.weather || !state.weather.current) return;
  const data = state.weather;
  const loc = state.selectedLocation;
  const [icon, label] = iconFor(data.current.weather_code);
  renderLocations(state);
  els.place.textContent = loc.name;
  els.condition.textContent = `${icon} ${label}`;
  els.temp.textContent = fmtTemp(data.current.temperature_2m);
  els.feels.textContent = fmtTemp(data.current.apparent_temperature);
  els.wind.textContent = `${Math.round(data.current.wind_speed_10m)} km/h`;
  els.humidity.textContent = `${Math.round(data.current.relative_humidity_2m)}%`;

  const nowIndex = Math.max(0, data.hourly.time.findIndex(t => new Date(t) >= new Date()));
  els.hourly.innerHTML = data.hourly.time.slice(nowIndex, nowIndex + (mode === 'panel' ? 5 : 10)).map((time, offset) => {
    const index = nowIndex + offset;
    return `<div class="hour">
      <span class="subtle">${offset === 0 ? 'Now' : fmtTime(time)}</span>
      <span>${iconFor(data.hourly.weather_code[index])[0]}</span>
      <strong>${fmtTemp(data.hourly.temperature_2m[index])}</strong>
    </div>`;
  }).join('');

  const minAll = Math.min(...data.daily.temperature_2m_min);
  const maxAll = Math.max(...data.daily.temperature_2m_max);
  const span = Math.max(1, maxAll - minAll);
  els.daily.innerHTML = data.daily.time.map((day, index) => {
    const max = data.daily.temperature_2m_max[index];
    const min = data.daily.temperature_2m_min[index];
    return `<div class="day">
      <strong>${fmtDay(day, index)}</strong>
      <span>${iconFor(data.daily.weather_code[index])[0]}</span>
      <div class="bar"><span style="width:${Math.max(12, ((max - minAll) / span) * 100)}%"></span></div>
      <span class="subtle">${Math.round(min)}° ${Math.round(max)}°</span>
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
api.onState(render);

(async function init() {
  render(await api.getState());
  render(await api.refresh());
})();
