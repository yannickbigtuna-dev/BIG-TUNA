const api = window.BigTunaLights;

const switchBtn = document.getElementById('switch');
const stateLabel = document.getElementById('state-label');
const message = document.getElementById('message');
const loginForm = document.getElementById('login-form');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('login-btn');
const sessionRow = document.getElementById('session-row');
const sessionLabel = document.getElementById('session-label');
const logoutBtn = document.getElementById('logout-btn');
const hideBtn = document.getElementById('hide-btn');

let currentOn = false;
let canControl = false;
let pending = false;

function setMessage(text, isError = false) {
  message.textContent = text || '';
  message.style.color = isError ? 'var(--danger)' : '';
}

function setVisual(on) {
  currentOn = on === true;
  document.body.classList.toggle('is-on', currentOn);
  switchBtn.setAttribute('aria-checked', String(currentOn));
  stateLabel.textContent = currentOn ? 'On' : 'Off';
}

function applyAuth(auth) {
  canControl = auth.canControl === true;
  switchBtn.disabled = !canControl || pending;
  loginForm.hidden = auth.loggedIn;
  sessionRow.hidden = !auth.loggedIn;
  sessionLabel.textContent = auth.loggedIn ? `Signed in as ${auth.username}` : '';
  if (!auth.loggedIn) {
    setMessage('Log in to control the light.');
  } else if (!canControl) {
    setMessage('This account cannot control the light.', true);
  } else if (!pending) {
    setMessage('Ready');
  }
}

async function refresh() {
  const result = await api.getState();
  if (result.ok) {
    setVisual(result.on);
  } else {
    setMessage(result.error || 'State unavailable', true);
  }
}

async function toggleLight() {
  if (!canControl || pending) return;
  const nextOn = !currentOn;
  const previous = currentOn;
  pending = true;
  switchBtn.disabled = true;
  setVisual(nextOn);
  setMessage('Saving...');
  const result = await api.setState(nextOn);
  pending = false;
  switchBtn.disabled = !canControl;
  if (result.ok) {
    setVisual(result.on);
    setMessage('Ready');
  } else {
    setVisual(previous);
    setMessage(result.error || 'Save failed', true);
  }
}

switchBtn.addEventListener('click', toggleLight);
switchBtn.addEventListener('keydown', event => {
  if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault();
    toggleLight();
  }
});

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  loginBtn.disabled = true;
  setMessage('Logging in...');
  const result = await api.login({
    username: usernameInput.value.trim(),
    password: passwordInput.value,
  });
  passwordInput.value = '';
  loginBtn.disabled = false;
  if (result.ok) {
    setMessage('Ready');
    await refresh();
  } else {
    setMessage(result.error || 'Login failed', true);
  }
});

logoutBtn.addEventListener('click', async () => {
  await api.logout();
  canControl = false;
  switchBtn.disabled = true;
  setMessage('Log in to control the light.');
});

hideBtn.addEventListener('click', () => api.hideWindow());

api.onState(data => {
  setVisual(data.on);
});

api.onAuth(applyAuth);
api.onError(data => {
  setMessage(data.message || 'Request failed', true);
});

(async function init() {
  applyAuth(await api.getAuth());
  await refresh();
})();
