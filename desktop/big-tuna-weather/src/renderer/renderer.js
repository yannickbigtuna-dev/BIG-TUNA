const api = window.BigTunaWeather;
const mode = new URLSearchParams(location.search).get('mode') || 'main';
document.body.classList.toggle('panel', mode === 'panel');
let currentState = null;
let activeDetails = [];

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
  precipIcon: document.getElementById('precip-icon'),
  precipLabel: document.getElementById('precip-label'),
  precip: document.getElementById('precip'),
  humidity: document.getElementById('humidity'),
  pressure: document.getElementById('pressure'),
  hourly: document.getElementById('hourly'),
  hourDetails: document.getElementById('hour-detail-stack'),
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

function windArrowStyle(speed, direction) {
  const size = Math.round(Math.min(112, Math.max(58, 58 + (Number(speed) || 0) * 2.2)));
  const rotation = (((Number(direction) || 0) + 180) % 360).toFixed(0);
  return `--wind-size:${size}px;--wind-rotation:${rotation}deg`;
}

function heading(deg) {
  return `${Math.round((((Number(deg) || 0) % 360) + 360) % 360)}°`;
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

function fmtDateTime(iso) {
  return new Date(iso).toLocaleString([], { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric' });
}

function fmtFullDate(iso) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

function fmtNumber(value, suffix = '', digits = 0) {
  return Number.isFinite(value) ? `${Number(value).toFixed(digits)}${suffix}` : '--';
}

function currentHourlyIndex(data) {
  return Math.max(0, data.hourly.time.findIndex(t => new Date(t) >= new Date()));
}

function detailId(type, value) {
  return `${type}:${value}`;
}

function isDetailOpen(type, value) {
  return activeDetails.includes(detailId(type, value));
}

function toggleDetail(type, value) {
  const id = detailId(type, value);
  activeDetails = activeDetails.includes(id)
    ? activeDetails.filter(item => item !== id)
    : [...activeDetails, id];
}

function metricKeyForCard(card) {
  return card.dataset.metricKey === 'precip' ? detailMetricKey() : card.dataset.metricKey;
}

function detailMetricKey() {
  const data = currentState && currentState.weather;
  if (!data) return 'precip';
  return (Number(data.current.precipitation) || 0) > 0 ? 'precip' : 'uv';
}

function metricValue(key, index = null) {
  const data = currentState && currentState.weather;
  if (!data) return '--';
  if (index === null) index = currentHourlyIndex(data);
  const hourly = data.hourly;
  if (key === 'feels') return fmtTemp(hourly.apparent_temperature?.[index] ?? hourly.temperature_2m?.[index]);
  if (key === 'wind') return `${fmtNumber(hourly.wind_speed_10m?.[index], ' km/h')} · ${heading(hourly.wind_direction_10m?.[index])}`;
  if (key === 'humidity') return fmtNumber(hourly.relative_humidity_2m?.[index], '%');
  if (key === 'pressure') return fmtNumber(hourly.pressure_msl?.[index], ' hPa');
  if (key === 'uv') return fmtNumber(hourly.uv_index?.[index], '', 1);
  return fmtNumber(hourly.precipitation?.[index], ' mm/hr', 1);
}

function metricSeries(key) {
  const data = currentState && currentState.weather;
  if (!data) return [];
  const hourly = data.hourly;
  const start = currentHourlyIndex(data);
  const source = key === 'feels' ? (hourly.apparent_temperature || hourly.temperature_2m)
    : key === 'humidity' ? hourly.relative_humidity_2m
    : key === 'pressure' ? hourly.pressure_msl
    : key === 'uv' ? hourly.uv_index
    : hourly.precipitation;
  return [0, 3, 6, 9, 12, 15, 18, 21].map(offset => {
    const index = Math.min(hourly.time.length - 1, start + offset);
    return { time: offset === 0 ? 'Now' : fmtTime(hourly.time[index]), value: Number(source?.[index]) };
  }).filter(point => Number.isFinite(point.value));
}

function lineChart(points, formatter, yLabel = 'Value') {
  if (!points.length) return '<div class="detail-copy">Detailed timeline data is unavailable for this source.</div>';
  const width = 640;
  const height = 170;
  const pad = { left: 52, right: 18, top: 18, bottom: 42 };
  const values = points.map(point => point.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; }
  const x = index => pad.left + (index * (width - pad.left - pad.right)) / Math.max(1, points.length - 1);
  const y = value => pad.top + ((max - value) * (height - pad.top - pad.bottom)) / (max - min);
  const coords = points.map((point, index) => `${x(index)},${y(point.value)}`).join(' ');
  const fill = `${pad.left},${height - pad.bottom} ${coords} ${x(points.length - 1)},${height - pad.bottom}`;
  const rows = [0, 1, 2, 3, 4].map(row => {
    const value = max - row * ((max - min) / 4);
    const yy = y(value);
    return `<line class="chart-grid" x1="${pad.left}" y1="${yy}" x2="${width - pad.right}" y2="${yy}"></line><text class="chart-axis" x="${pad.left - 7}" y="${yy + 3}" text-anchor="end">${formatter(value)}</text>`;
  }).join('');
  const columns = points.map((point, index) => `<line class="chart-grid" x1="${x(index)}" y1="${pad.top}" x2="${x(index)}" y2="${height - pad.bottom}"></line>`).join('');
  const dots = points.map((point, index) => `<circle class="chart-dot" cx="${x(index)}" cy="${y(point.value)}" r="4"></circle><text class="chart-axis" x="${x(index)}" y="${height - 23}" text-anchor="middle">${point.time}</text>`).join('');
  return `<svg class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${yLabel} timeline chart"><text class="chart-title" x="${pad.left}" y="${height - 6}">Time</text><text class="chart-title" x="13" y="${pad.top}" transform="rotate(-90 13 ${pad.top})">${yLabel}</text><polygon class="chart-fill" points="${fill}"></polygon>${columns}${rows}<polyline class="chart-line" points="${coords}"></polyline>${dots}</svg>`;
}

function detailTile(label, value) {
  return `<div class="detail-tile"><span class="tile-label">${label}</span><span class="tile-value">${value}</span></div>`;
}

function renderMetricDetail(key) {
  const labels = {
    feels: ['Feels Like', 'Temperature adjusted for humidity and wind.'],
    precip: ['Precipitation', 'Expected precipitation over the next day.'],
    uv: ['UV Index', 'Sunlight intensity through the next day.'],
    humidity: ['Humidity', 'Humidity levels over the next 24 hours.'],
    pressure: ['Pressure', 'Barometric pressure over the next 24 hours.'],
  };
  const [title, copy] = labels[key] || labels.feels;
  const formatter = key === 'humidity' ? value => `${Math.round(value)}%`
    : key === 'pressure' ? value => `${Math.round(value)} hPa`
    : key === 'uv' || key === 'precip' ? value => value.toFixed(1)
    : value => `${Math.round(value)}°`;
  const suffix = key === 'precip' ? ' mm/hr' : '';
  const yLabel = key === 'humidity' ? 'Humidity'
    : key === 'pressure' ? 'Pressure'
    : key === 'uv' ? 'UV Index'
    : key === 'precip' ? 'Precipitation'
    : 'Temperature';
  return `<div class="detail-panel"><div class="detail-head"><div><h3 class="detail-title">${title}</h3><p class="detail-copy">${copy}</p></div><div class="detail-current">${metricValue(key)}</div></div>${lineChart(metricSeries(key), value => `${formatter(value)}${suffix}`, yLabel)}</div>`;
}

function renderHourDetail(index) {
  const data = currentState.weather;
  const meta = weatherMeta(data.hourly.weather_code[index]);
  return `<div class="detail-panel"><div class="hour-detail-head"><div><div class="detail-date">${fmtDateTime(data.hourly.time[index])}</div><h3 class="detail-title">${meta[1]}</h3></div><div class="detail-temp">${fmtTemp(data.hourly.temperature_2m[index])}</div><div class="detail-icon">${meta[0]}</div></div>
    <div class="detail-grid">
      ${detailTile('Feels Like', metricValue('feels', index))}
      ${detailTile('Precipitation', fmtNumber(data.hourly.precipitation?.[index], ' mm/hr', 1))}
      ${detailTile('Precip Chance', fmtNumber(data.hourly.precipitation_probability?.[index], '%'))}
      ${detailTile('Wind', metricValue('wind', index))}
      ${detailTile('Humidity', metricValue('humidity', index))}
      ${detailTile('Pressure', metricValue('pressure', index))}
      ${detailTile('UV Index', fmtNumber(data.hourly.uv_index?.[index], '', 1))}
    </div></div>`;
}

function renderDayDetail(index) {
  const data = currentState.weather;
  const day = data.daily.time[index];
  const meta = weatherMeta(data.daily.weather_code[index]);
  const hours = data.hourly.time.map((time, hourIndex) => ({ time, hourIndex })).filter(item => item.time.slice(0, 10) === day).slice(0, 10);
  const hourStrip = hours.map(item => {
    const hMeta = weatherMeta(data.hourly.weather_code[item.hourIndex]);
    return `<div class="day-hour"><span>${fmtTime(item.time)}</span><span>${hMeta[0]}</span><span>${fmtTemp(data.hourly.temperature_2m[item.hourIndex])}</span></div>`;
  }).join('');
  return `<div class="detail-panel day-detail-panel"><div class="day-detail-head"><div><div class="detail-date">${fmtFullDate(day)}</div><h3 class="detail-title">${meta[1]}</h3></div><div class="detail-temp">${fmtTemp(data.daily.temperature_2m_max[index])} / ${fmtTemp(data.daily.temperature_2m_min[index])}</div><div class="detail-icon">${meta[0]}</div></div>
    <p class="day-summary">A compact day view with the key forecast details.</p>
    <div class="detail-grid">
      ${detailTile('Feels Like High', fmtTemp(data.daily.apparent_temperature_max?.[index]))}
      ${detailTile('Feels Like Low', fmtTemp(data.daily.apparent_temperature_min?.[index]))}
      ${detailTile('Precipitation', fmtNumber(data.daily.precipitation_sum?.[index], ' mm', 1))}
      ${detailTile('Wind', fmtNumber(data.daily.wind_speed_10m_max?.[index], ' km/h'))}
      ${detailTile('UV Index', fmtNumber(data.daily.uv_index_max?.[index], '', 1))}
    </div>
    <div class="day-hour-strip">${hourStrip || '<span class="detail-copy">Hourly detail is unavailable for this day.</span>'}</div></div>`;
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
  currentState = state;
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
  els.windMeta.innerHTML = `<span class="wind-compass" style="${windArrowStyle(current.wind_speed_10m, current.wind_direction_10m)}"><span class="wind-arrow"></span></span><span>${Math.round(current.wind_speed_10m)} km/h · ${heading(current.wind_direction_10m)}</span>`;
  const precipitation = Number(current.precipitation) || 0;
  if (precipitation > 0) {
    els.precipIcon.textContent = '☂';
    els.precipLabel.textContent = 'Precipitation';
    els.precip.textContent = `${precipitation.toFixed(1)} mm/hr`;
  } else {
    els.precipIcon.textContent = '☀';
    els.precipLabel.textContent = 'UV Index';
    els.precip.textContent = Number.isFinite(current.uv_index) ? current.uv_index.toFixed(1) : '--';
  }
  els.humidity.textContent = `${Math.round(current.relative_humidity_2m)}%`;
  els.pressure.textContent = `${Math.round(current.pressure_msl)} hPa`;
  els.updated.textContent = data.sourceLabel ? `Source: ${data.sourceLabel}` : 'Updated now';

  const nowIndex = Math.max(0, data.hourly.time.findIndex(t => new Date(t) >= new Date()));
  els.hourly.innerHTML = data.hourly.time.slice(nowIndex, nowIndex + (mode === 'panel' ? 6 : 9)).map((time, offset) => {
    const index = nowIndex + offset;
    const hourMeta = weatherMeta(data.hourly.weather_code[index]);
    return `<button class="hour${isDetailOpen('hour', index) ? ' is-selected' : ''}" type="button" data-hour-index="${index}"><span class="hour-time">${offset === 0 ? 'Now' : fmtTime(time)}</span><span class="hour-icon">${hourMeta[0]}</span><span class="hour-temp">${fmtTemp(data.hourly.temperature_2m[index])}</span></button>`;
  }).join('');
  els.hourDetails.innerHTML = activeDetails
    .filter(id => id.startsWith('hour:'))
    .map(id => Number(id.split(':')[1]))
    .filter(index => Number.isInteger(index) && index >= 0 && index < data.hourly.time.length)
    .map(renderHourDetail)
    .join('');

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
    const selected = isDetailOpen('day', index);
    return `<div class="day-entry"><button class="day${selected ? ' is-selected' : ''}" type="button" data-day-index="${index}">
      <span class="day-name">${fmtDay(day, index)}</span>
      <span class="day-icon">${dayMeta[0]}</span>
      <span class="day-condition">${dayMeta[1]}</span>
      <span class="low">${fmtTemp(min)}</span>
      <span class="range"><span style="left:${left}%;width:${width}%"></span><i style="left:${dot}%"></i></span>
      <span class="high">${fmtTemp(max)}</span>
    </button>${selected ? renderDayDetail(index) : ''}</div>`;
  }).join('');
  document.querySelectorAll('.metric').forEach(card => {
    const key = metricKeyForCard(card);
    const selected = isDetailOpen('metric', key);
    card.classList.toggle('is-selected', selected);
    card.classList.toggle('is-expanded', selected);
    const existing = card.querySelector('.metric-detail');
    if (existing) existing.remove();
    if (selected) card.insertAdjacentHTML('beforeend', `<div class="metric-detail">${renderMetricDetail(key)}</div>`);
  });
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

document.querySelectorAll('.metric').forEach(card => {
  const activate = event => {
    if (event && event.target.closest('.metric-detail')) return;
    if (!currentState) return;
    toggleDetail('metric', metricKeyForCard(card));
    render(currentState);
  };
  card.addEventListener('click', activate);
  card.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate();
    }
  });
});

els.hourly.addEventListener('click', event => {
  const btn = event.target.closest('.hour');
  if (!btn || !currentState) return;
  toggleDetail('hour', Number(btn.dataset.hourIndex));
  render(currentState);
});

els.daily.addEventListener('click', event => {
  const btn = event.target.closest('.day');
  if (!btn || !currentState) return;
  toggleDetail('day', Number(btn.dataset.dayIndex));
  render(currentState);
});

els.hide.addEventListener('click', () => api.hidePanel());
els.openMain.addEventListener('click', () => api.openMain());
els.panelOpenRow.addEventListener('click', () => api.openMain());
api.onState(render);

(async function init() {
  render(await api.getState());
  render(await api.refresh());
})();
