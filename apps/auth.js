// auth.js — Shared authentication library for BIG TUNA
// Usage: <script src="/auth.js"></script>
// The script auto-inits. Use Auth.onReady(fn) to run code after auth is confirmed.
// Place <div data-auth-widget></div> in a topbar to host the account button there,
// otherwise a fixed top-left widget is created automatically.

const Auth = (() => {
  'use strict';

  const TOKEN_KEY = 'auth_token';
  const USER_KEY  = 'auth_user';

  let _token = localStorage.getItem(TOKEN_KEY);
  let _user  = null;
  try { _user = JSON.parse(localStorage.getItem(USER_KEY)); } catch {}

  let _ready = false;
  let _readyCallbacks = [];
  let _beforeLogoutHooks = [];

  // ── Styles ──────────────────────────────────────────────────────────────────
  const css = `
    /* ── Login modal ── */
    #auth-modal-overlay {
      position: fixed; inset: 0; background: #0a0a0a;
      z-index: 9999; display: flex; align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    #auth-card {
      background: #141414; border: 1px solid #222; border-radius: 20px;
      padding: 36px 32px 32px; width: 100%; max-width: 360px; margin: 20px;
    }
    #auth-card .auth-logo {
      font-size: 2rem; font-weight: 900; letter-spacing: -0.04em;
      background: linear-gradient(135deg, #ff0000 40%, #aa0000 100%);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text; margin-bottom: 4px; display: block;
    }
    #auth-card .auth-subtitle {
      font-size: 0.72rem; color: #444; letter-spacing: 0.15em;
      text-transform: uppercase; margin-bottom: 28px; display: block;
    }
    #auth-card h2 {
      font-size: 1.2rem; font-weight: 700; color: #fff; margin-bottom: 20px;
    }
    .auth-field { margin-bottom: 12px; }
    .auth-field label {
      display: block; font-size: 0.65rem; text-transform: uppercase;
      letter-spacing: 0.12em; color: #555; margin-bottom: 6px;
    }
    .auth-field input {
      width: 100%; background: #1e1e1e; border: 1px solid #2a2a2a;
      border-radius: 10px; padding: 12px 14px; color: #fff; font-size: 1rem;
      outline: none; transition: border-color 0.15s; box-sizing: border-box;
      font-family: inherit;
    }
    .auth-field input:focus { border-color: #444; }
    #auth-error {
      color: #ff6b6b; font-size: 0.8rem; margin-bottom: 14px;
      min-height: 1.2em; line-height: 1.4;
    }
    #auth-submit {
      width: 100%; padding: 14px; background: #fff; color: #0a0a0a;
      border: none; border-radius: 10px; font-size: 0.88rem; font-weight: 800;
      letter-spacing: 0.1em; cursor: pointer; transition: opacity 0.15s;
      margin-bottom: 16px; font-family: inherit;
    }
    #auth-submit:hover { opacity: 0.88; }
    #auth-submit:disabled { opacity: 0.4; cursor: not-allowed; }
    #auth-toggle { text-align: center; font-size: 0.8rem; color: #555; }
    #auth-toggle-link {
      color: #4f9eff; cursor: pointer; font-weight: 600;
    }
    #auth-toggle-link:hover { color: #7fb8ff; }

    /* ── Account widget ── */
    #auth-widget { position: relative; }
    #auth-widget-btn {
      background: rgba(255,255,255,0.08); border: none; border-radius: 10px;
      color: #fff; cursor: pointer; display: flex; align-items: center;
      gap: 6px; padding: 8px 12px; font-size: 0.75rem; font-weight: 700;
      letter-spacing: 0.06em; transition: background 0.15s; min-height: 36px;
      font-family: inherit; white-space: nowrap; touch-action: manipulation;
    }
    #auth-widget-btn:hover, #auth-widget-btn:active {
      background: rgba(255,255,255,0.15);
    }
    #auth-widget-btn svg {
      width: 14px; height: 14px; fill: currentColor;
      flex-shrink: 0; opacity: 0.65;
    }
    #auth-dropdown {
      position: absolute; top: calc(100% + 6px); right: 0;
      background: #1c1c1c; border: 1px solid #2a2a2a; border-radius: 12px;
      padding: 6px; min-width: 150px; display: none;
      box-shadow: 0 8px 28px rgba(0,0,0,0.6);
      z-index: 500;
    }
    #auth-dropdown.open { display: block; }
    .auth-dd-username {
      font-size: 0.68rem; color: #555; padding: 6px 12px 4px;
      letter-spacing: 0.1em; text-transform: uppercase;
    }
    .auth-dd-divider { height: 1px; background: #262626; margin: 4px 0; }
    .auth-dd-btn {
      display: block; width: 100%; text-align: left; background: none;
      border: none; color: #bbb; font-size: 0.82rem; font-family: inherit;
      padding: 9px 12px; border-radius: 8px; cursor: pointer;
      transition: background 0.12s; font-weight: 600;
    }
    .auth-dd-btn:hover { background: rgba(255,255,255,0.07); color: #fff; }
    .auth-dd-btn.danger { color: #ff6b6b; }
    .auth-dd-btn.danger:hover { background: rgba(255,80,80,0.1); }

    /* Fixed corner fallback (when no data-auth-widget host) */
    #auth-widget-fixed {
      position: fixed; top: 20px; left: 20px; z-index: 300;
    }
    /* Left-side placement: dropdown opens rightward */
    #auth-widget-fixed #auth-dropdown,
    .auth-widget-left #auth-dropdown {
      right: auto; left: 0;
    }

    /* ── Landscape / short-viewport modal ── */
    @media (max-height: 520px) {
      #auth-card {
        padding: 20px 24px 20px;
        border-radius: 14px;
      }
      #auth-card .auth-logo { font-size: 1.4rem; margin-bottom: 2px; }
      #auth-card .auth-subtitle { margin-bottom: 14px; }
      #auth-card h2 { font-size: 1rem; margin-bottom: 14px; }
      .auth-field { margin-bottom: 8px; }
      .auth-field input { padding: 9px 12px; }
      #auth-submit { padding: 11px; margin-bottom: 10px; }
      #auth-modal-overlay { align-items: flex-start; padding: 16px; overflow-y: auto; }
    }

    /* Prevent iOS font-size inflation on rotation */
    html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
  `;

  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ── Modal ────────────────────────────────────────────────────────────────────
  let _modal = null;

  function showModal() {
    _modal = document.createElement('div');
    _modal.id = 'auth-modal-overlay';
    _modal.innerHTML = `
      <div id="auth-card">
        <span class="auth-logo">BIG TUNA</span>
        <span class="auth-subtitle">yannickmorgans.ca</span>
        <h2 id="auth-title">Welcome back</h2>
        <div class="auth-field">
          <label>Username</label>
          <input type="text" id="auth-username"
                 autocomplete="username" autocapitalize="none" spellcheck="false" />
        </div>
        <div class="auth-field">
          <label>Password</label>
          <input type="password" id="auth-password" autocomplete="current-password" />
        </div>
        <div id="auth-error"></div>
        <button id="auth-submit">LOG IN</button>
        <div id="auth-toggle">No account? <span id="auth-toggle-link">Create one</span></div>
      </div>
    `;
    document.body.appendChild(_modal);

    let isRegister = false;
    const titleEl    = _modal.querySelector('#auth-title');
    const submitBtn  = _modal.querySelector('#auth-submit');
    const errorDiv   = _modal.querySelector('#auth-error');
    const toggleDiv  = _modal.querySelector('#auth-toggle');
    const unameInput = _modal.querySelector('#auth-username');
    const passInput  = _modal.querySelector('#auth-password');

    function setMode(reg) {
      isRegister = reg;
      titleEl.textContent  = reg ? 'Create account' : 'Welcome back';
      submitBtn.textContent = reg ? 'CREATE ACCOUNT' : 'LOG IN';
      toggleDiv.innerHTML  = reg
        ? `Have an account? <span id="auth-toggle-link">Log in</span>`
        : `No account? <span id="auth-toggle-link">Create one</span>`;
      _modal.querySelector('#auth-toggle-link').onclick = () => setMode(!isRegister);
      errorDiv.textContent = '';
    }

    _modal.querySelector('#auth-toggle-link').onclick = () => setMode(!isRegister);

    async function doSubmit() {
      const username = unameInput.value.trim();
      const password = passInput.value;
      if (!username || !password) { errorDiv.textContent = 'Please fill in all fields.'; return; }

      submitBtn.disabled = true;
      submitBtn.textContent = '...';
      errorDiv.textContent = '';

      try {
        const endpoint = isRegister ? '/api/auth/register' : '/api/auth/login';
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        const data = await res.json();
        if (!res.ok) {
          errorDiv.textContent = data.error || 'Something went wrong.';
          submitBtn.disabled = false;
          submitBtn.textContent = isRegister ? 'CREATE ACCOUNT' : 'LOG IN';
          return;
        }
        _token = data.token;
        _user  = { username: data.username, id: data.id };
        localStorage.setItem(TOKEN_KEY, _token);
        localStorage.setItem(USER_KEY, JSON.stringify(_user));
        _modal.remove();
        _modal = null;
        injectWidget();
        fireReady();
      } catch {
        errorDiv.textContent = 'Connection error. Please try again.';
        submitBtn.disabled = false;
        submitBtn.textContent = isRegister ? 'CREATE ACCOUNT' : 'LOG IN';
      }
    }

    submitBtn.onclick = doSubmit;
    passInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSubmit(); });
    unameInput.addEventListener('keydown', e => { if (e.key === 'Enter') passInput.focus(); });
    setTimeout(() => unameInput.focus(), 80);
  }

  // ── Account widget ───────────────────────────────────────────────────────────
  function injectWidget() {
    if (!_user) return;
    if (document.getElementById('auth-widget')) return; // already injected

    const widgetEl = document.createElement('div');
    widgetEl.id = 'auth-widget';
    widgetEl.innerHTML = `
      <button id="auth-widget-btn" aria-label="Account">
        <svg viewBox="0 0 24 24">
          <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4
                   7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6
                   1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
        </svg>
        <span id="auth-widget-name"></span>
      </button>
      <div id="auth-dropdown">
        <div class="auth-dd-username" id="auth-dd-uname"></div>
        <div class="auth-dd-divider"></div>
        <button class="auth-dd-btn danger" id="auth-logout-btn">Log Out</button>
      </div>
    `;

    // Find a host container or fall back to fixed corner
    const host = document.querySelector('[data-auth-widget]');
    if (host) {
      // data-auth-widget="left" means the host is on the left side → open dropdown rightward
      if (host.dataset.authWidget === 'left') widgetEl.classList.add('auth-widget-left');
      host.appendChild(widgetEl);
    } else {
      const fixed = document.createElement('div');
      fixed.id = 'auth-widget-fixed';
      fixed.appendChild(widgetEl);
      document.body.appendChild(fixed);
    }

    document.getElementById('auth-widget-name').textContent = _user.username.toUpperCase();
    document.getElementById('auth-dd-uname').textContent    = _user.username;

    const btn      = document.getElementById('auth-widget-btn');
    const dropdown = document.getElementById('auth-dropdown');

    btn.onclick = e => {
      e.stopPropagation();
      dropdown.classList.toggle('open');
    };
    document.addEventListener('click', () => dropdown.classList.remove('open'));
    document.getElementById('auth-logout-btn').onclick = () => logout();
  }

  // ── Ready callbacks ──────────────────────────────────────────────────────────
  function fireReady() {
    if (_ready) return;
    _ready = true;
    _readyCallbacks.forEach(fn => fn(_user));
    _readyCallbacks = [];
  }

  function onReady(fn) {
    if (_ready) { fn(_user); return; }
    _readyCallbacks.push(fn);
  }

  // ── Core auth actions ────────────────────────────────────────────────────────

  // Register an async function to run before logout (e.g. flush pending syncs).
  // The hook must return a Promise. Logout waits up to 5 s for all hooks.
  function beforeLogout(fn) {
    _beforeLogoutHooks.push(fn);
  }

  async function logout() {
    // Give every registered app a chance to flush unsaved data
    if (_beforeLogoutHooks.length) {
      try {
        await Promise.race([
          Promise.all(_beforeLogoutHooks.map(fn => {
            try { return Promise.resolve(fn()); } catch { return Promise.resolve(); }
          })),
          new Promise(r => setTimeout(r, 5000)), // hard 5 s ceiling
        ]);
      } catch {}
    }
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${_token}` },
      });
    } catch {}
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    _token = null; _user = null;
    window.location.reload();
  }

  async function init() {
    if (_token) {
      // If we have a cached user, load the app immediately — no waiting, no flash.
      // Token validity is checked in the background; a genuine 401 forces re-login.
      if (_user) {
        injectWidget();
        fireReady();
        fetch('/api/auth/me', { headers: { 'Authorization': `Bearer ${_token}` } })
          .then(res => {
            if (res.status === 401) {
              // Token was revoked or expired — clear and reload to show login
              localStorage.removeItem(TOKEN_KEY);
              localStorage.removeItem(USER_KEY);
              window.location.reload();
            } else if (res.ok) {
              res.json().then(data => {
                _user = { username: data.username, id: data.id };
                localStorage.setItem(USER_KEY, JSON.stringify(_user));
              }).catch(() => {});
            }
            // Any other status (5xx, network) — stay logged in with cached creds
          })
          .catch(() => {}); // network error — stay logged in
        return;
      }

      // No cached user — must verify before showing the app
      try {
        const res = await fetch('/api/auth/me', {
          headers: { 'Authorization': `Bearer ${_token}` },
        });
        if (res.ok) {
          const data = await res.json();
          _user = { username: data.username, id: data.id };
          localStorage.setItem(USER_KEY, JSON.stringify(_user));
          injectWidget();
          fireReady();
          return;
        }
      } catch {}
      // Verification failed or network error — clear token and ask to log in
      localStorage.removeItem(TOKEN_KEY);
      _token = null;
    }
    showModal();
  }

  // ── Settings API ─────────────────────────────────────────────────────────────
  async function saveSettings(appId, data) {
    if (!_token) return;
    try {
      await fetch(`/api/settings/${appId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${_token}`,
        },
        body: JSON.stringify(data),
      });
    } catch {}
  }

  async function loadSettings(appId) {
    if (!_token) return null;
    try {
      const res = await fetch(`/api/settings/${appId}`, {
        headers: { 'Authorization': `Bearer ${_token}` },
      });
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  }

  // ── Auto-sync API ─────────────────────────────────────────────────────────────
  function autoSync(appId, getDataFn, options = {}) {
    const interval = options.interval || 30000;
    let _lastSaved = null;
    let _retryCount = 0;
    let _retryTimer = null;

    async function doSave(keepalive) {
      if (!_token) return;
      const data = getDataFn();
      const serialized = JSON.stringify(data);
      if (serialized === _lastSaved) return; // nothing changed

      if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }

      try {
        const res = await fetch(`/api/settings/${appId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${_token}`,
          },
          body: serialized,
          keepalive: !!keepalive,
        });
        if (res.ok) {
          _lastSaved = serialized;
          _retryCount = 0;
        } else {
          scheduleRetry();
        }
      } catch {
        scheduleRetry();
      }
    }

    function scheduleRetry() {
      const delay = Math.min(60000, 5000 * Math.pow(2, _retryCount));
      _retryCount++;
      _retryTimer = setTimeout(() => doSave(), delay);
    }

    setInterval(() => doSave(), interval);
    window.addEventListener('online', () => doSave());
    beforeLogout(() => doSave());
    window.addEventListener('beforeunload', () => doSave(true));

    return { sync: () => doSave() };
  }

  // ── Auto-init after DOM ready ─────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { onReady, logout, beforeLogout, saveSettings, loadSettings, autoSync, get user() { return _user; }, get token() { return _token; } };
})();
