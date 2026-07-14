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
      position: fixed; inset: 0; background: var(--bg);
      z-index: 9999; display: flex; align-items: center;
      justify-content: center;
      font-family: var(--font-ui);
    }
    #auth-card {
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg);
      padding: 36px 32px 32px; width: 100%; max-width: 360px; margin: 20px;
    }
    #auth-card .auth-logo {
      font-size: 2rem; font-weight: 900; letter-spacing: -0.04em;
      background: linear-gradient(135deg, var(--accent) 35%, var(--accent-press) 100%);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text; margin-bottom: 4px; display: block;
    }
    #auth-card .auth-subtitle {
      font-size: 0.72rem; color: var(--text-dim); letter-spacing: 0.15em;
      text-transform: uppercase; margin-bottom: 28px; display: block;
    }
    #auth-card h2 {
      font-size: 1.2rem; font-weight: 700; color: var(--text); margin-bottom: 20px;
    }
    .auth-field { margin-bottom: 12px; }
    .auth-field label {
      display: block; font-size: 0.65rem; text-transform: uppercase;
      letter-spacing: 0.12em; color: var(--text-dim); margin-bottom: 6px;
    }
    .auth-field input {
      width: 100%; background: var(--surface-2); border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm); padding: 12px 14px; color: var(--text); font-size: 1rem;
      outline: none; transition: border-color 0.15s, box-shadow 0.15s; box-sizing: border-box;
      font-family: inherit;
    }
    .auth-field input:focus { border-color: var(--accent); box-shadow: var(--ring); }
    #auth-error {
      color: var(--danger); font-size: 0.8rem; margin-bottom: 14px;
      min-height: 1.2em; line-height: 1.4;
    }
    #auth-submit {
      width: 100%; padding: 14px; background: var(--accent); color: var(--on-accent);
      border: none; border-radius: var(--radius-sm); font-size: 0.88rem; font-weight: 800;
      letter-spacing: 0.1em; cursor: pointer; transition: background 0.15s;
      margin-bottom: 16px; font-family: inherit;
    }
    #auth-submit:hover { background: var(--accent-hover); }
    #auth-submit:disabled { opacity: 0.4; cursor: not-allowed; }
    #auth-toggle { text-align: center; font-size: 0.8rem; color: var(--text-dim); }
    #auth-toggle-link {
      color: var(--accent); cursor: pointer; font-weight: 600;
    }
    #auth-toggle-link:hover { color: var(--accent-hover); }
    #auth-forgot { text-align: center; font-size: 0.75rem; margin-top: 10px; }
    #auth-forgot-link { color: var(--text-dim); cursor: pointer; }
    #auth-forgot-link:hover { color: var(--accent); }
    #auth-info {
      color: var(--text-dim); font-size: 0.8rem; margin-bottom: 14px;
      min-height: 1.2em; line-height: 1.4;
    }

    /* ── Account widget ── */
    #auth-widget { position: relative; }
    #auth-widget-btn {
      background: rgba(255,255,255,0.08); border: none; border-radius: var(--radius-sm);
      color: var(--text); cursor: pointer; display: flex; align-items: center;
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
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
      padding: 6px; min-width: 150px; display: none;
      box-shadow: var(--shadow-3);
      z-index: 500;
    }
    #auth-dropdown.open { display: block; }
    .auth-dd-username {
      font-size: 0.68rem; color: var(--text-dim); padding: 6px 12px 4px;
      letter-spacing: 0.1em; text-transform: uppercase;
    }
    .auth-dd-divider { height: 1px; background: var(--border); margin: 4px 0; }
    .auth-dd-btn {
      display: block; width: 100%; text-align: left; background: none;
      border: none; color: var(--text-muted); font-size: 0.82rem; font-family: inherit;
      padding: 9px 12px; border-radius: var(--radius-sm); cursor: pointer;
      transition: background 0.12s; font-weight: 600;
    }
    .auth-dd-btn:hover { background: var(--surface-3); color: var(--text); }
    .auth-dd-btn.danger { color: var(--danger); }
    .auth-dd-btn.danger:hover { background: var(--accent-soft); }
    .auth-dd-email-row { display: flex; gap: 6px; padding: 4px 12px 6px; }
    .auth-dd-email-row input {
      flex: 1; min-width: 0; background: var(--surface-2); border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm); padding: 6px 8px; color: var(--text); font-size: 0.75rem;
      outline: none; font-family: inherit;
    }
    .auth-dd-email-row input:focus { border-color: var(--accent); }
    .auth-dd-email-row button {
      background: var(--accent); color: var(--on-accent); border: none; border-radius: var(--radius-sm);
      padding: 6px 10px; font-size: 0.7rem; font-weight: 700; cursor: pointer; white-space: nowrap;
      font-family: inherit;
    }
    .auth-dd-email-row button:hover { background: var(--accent-hover); }
    .auth-dd-email-status { padding: 0 12px 6px; font-size: 0.65rem; color: var(--text-dim); min-height: 1em; }

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

  function showModal(initialMode) {
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
        <div class="auth-field" id="auth-password-field">
          <label>Password</label>
          <input type="password" id="auth-password" autocomplete="current-password" />
        </div>
        <div id="auth-error"></div>
        <div id="auth-info"></div>
        <button id="auth-submit">LOG IN</button>
        <div id="auth-toggle">No account? <span id="auth-toggle-link">Create one</span></div>
        <div id="auth-forgot"><span id="auth-forgot-link">Forgot password?</span></div>
      </div>
    `;
    document.body.appendChild(_modal);

    let mode = initialMode || 'login'; // 'login' | 'register' | 'forgot'
    const titleEl    = _modal.querySelector('#auth-title');
    const submitBtn  = _modal.querySelector('#auth-submit');
    const errorDiv   = _modal.querySelector('#auth-error');
    const infoDiv    = _modal.querySelector('#auth-info');
    const toggleDiv  = _modal.querySelector('#auth-toggle');
    const forgotDiv  = _modal.querySelector('#auth-forgot');
    const pwField    = _modal.querySelector('#auth-password-field');
    const unameInput = _modal.querySelector('#auth-username');
    const passInput  = _modal.querySelector('#auth-password');

    function bindToggle() {
      toggleDiv.querySelector('#auth-toggle-link').onclick =
        () => setMode(mode === 'register' ? 'login' : 'register');
    }

    function setMode(next) {
      mode = next;
      errorDiv.textContent = '';
      infoDiv.textContent = '';
      passInput.value = '';
      if (mode === 'register') {
        titleEl.textContent   = 'Create account';
        submitBtn.textContent = 'CREATE ACCOUNT';
        pwField.style.display   = '';
        forgotDiv.style.display = 'none';
        toggleDiv.innerHTML = `Have an account? <span id="auth-toggle-link">Log in</span>`;
        bindToggle();
      } else if (mode === 'forgot') {
        titleEl.textContent   = 'Reset password';
        submitBtn.textContent = 'SEND RESET LINK';
        pwField.style.display   = 'none';
        forgotDiv.style.display = 'none';
        toggleDiv.innerHTML = `<span id="auth-toggle-link">Back to log in</span>`;
        toggleDiv.querySelector('#auth-toggle-link').onclick = () => setMode('login');
      } else {
        titleEl.textContent   = 'Welcome back';
        submitBtn.textContent = 'LOG IN';
        pwField.style.display   = '';
        forgotDiv.style.display = '';
        toggleDiv.innerHTML = `No account? <span id="auth-toggle-link">Create one</span>`;
        bindToggle();
      }
      setTimeout(() => unameInput.focus(), 30);
    }

    forgotDiv.querySelector('#auth-forgot-link').onclick = () => setMode('forgot');

    async function doSubmit() {
      const username = unameInput.value.trim();
      if (!username) { errorDiv.textContent = 'Please enter a username.'; return; }

      if (mode === 'forgot') {
        submitBtn.disabled = true;
        submitBtn.textContent = '...';
        try {
          await fetch('/api/auth/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username }),
          });
        } catch {}
        infoDiv.textContent = 'If that account has a recovery email on file, a reset link has been sent.';
        submitBtn.disabled = false;
        submitBtn.textContent = 'SEND RESET LINK';
        return;
      }

      const password = passInput.value;
      if (!password) { errorDiv.textContent = 'Please fill in all fields.'; return; }

      submitBtn.disabled = true;
      submitBtn.textContent = '...';
      errorDiv.textContent = '';

      try {
        const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        const data = await res.json();
        if (!res.ok) {
          errorDiv.textContent = data.error || 'Something went wrong.';
          submitBtn.disabled = false;
          submitBtn.textContent = mode === 'register' ? 'CREATE ACCOUNT' : 'LOG IN';
          return;
        }
        _token = data.token;
        _user  = { username: data.username, id: data.id, email: data.email || null };
        localStorage.setItem(TOKEN_KEY, _token);
        localStorage.setItem(USER_KEY, JSON.stringify(_user));
        _modal.remove();
        _modal = null;
        injectWidget();
        identifyTopbar();
        fireReady();
      } catch {
        errorDiv.textContent = 'Connection error. Please try again.';
        submitBtn.disabled = false;
        submitBtn.textContent = mode === 'register' ? 'CREATE ACCOUNT' : 'LOG IN';
      }
    }

    submitBtn.onclick = doSubmit;
    passInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSubmit(); });
    unameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { mode === 'forgot' ? doSubmit() : passInput.focus(); }
    });
    setMode(mode);
  }

  // ── Reset-password modal (reached via emailed ?resetToken= link) ─────────────
  function showResetModal(token) {
    _modal = document.createElement('div');
    _modal.id = 'auth-modal-overlay';
    _modal.innerHTML = `
      <div id="auth-card">
        <span class="auth-logo">BIG TUNA</span>
        <span class="auth-subtitle">yannickmorgans.ca</span>
        <h2>Set a new password</h2>
        <div class="auth-field">
          <label>New password</label>
          <input type="password" id="auth-new-password" autocomplete="new-password" />
        </div>
        <div id="auth-error"></div>
        <div id="auth-info"></div>
        <button id="auth-submit">SET PASSWORD</button>
      </div>
    `;
    document.body.appendChild(_modal);

    const submitBtn = _modal.querySelector('#auth-submit');
    const errorDiv  = _modal.querySelector('#auth-error');
    const infoDiv   = _modal.querySelector('#auth-info');
    const pwInput   = _modal.querySelector('#auth-new-password');

    async function doSubmit() {
      const password = pwInput.value;
      if (!password || password.length < 4) {
        errorDiv.textContent = 'Password must be at least 4 characters.';
        return;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = '...';
      errorDiv.textContent = '';
      try {
        const res = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, password }),
        });
        const data = await res.json();
        if (!res.ok) {
          errorDiv.textContent = data.error || 'Something went wrong.';
          submitBtn.disabled = false;
          submitBtn.textContent = 'SET PASSWORD';
          return;
        }
        infoDiv.textContent = 'Password updated. You can now log in.';
        submitBtn.style.display = 'none';
        setTimeout(() => { _modal.remove(); _modal = null; showModal('login'); }, 1500);
      } catch {
        errorDiv.textContent = 'Connection error. Please try again.';
        submitBtn.disabled = false;
        submitBtn.textContent = 'SET PASSWORD';
      }
    }

    submitBtn.onclick = doSubmit;
    pwInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSubmit(); });
    setTimeout(() => pwInput.focus(), 80);
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
        <div class="auth-dd-email-row">
          <input type="email" id="auth-dd-email-input" placeholder="Recovery email" autocomplete="email" />
          <button id="auth-dd-email-save" type="button">Save</button>
        </div>
        <div class="auth-dd-email-status" id="auth-dd-email-status"></div>
        <a href="/admin/" class="auth-dd-btn" id="auth-dd-admin-link" style="display:none">Admin Dashboard</a>
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
    document.getElementById('auth-dd-email-input').value    = _user.email || '';

    // Admin Dashboard link: only ever shown to the site owner's account
    // (yannick), same convention as apps/index.html's #test-email-btn. The
    // real security boundary is server-side (/api/admin/* 403s for everyone
    // else) — this is just a UX nicety to keep the link out of sight.
    if (_user.username.toLowerCase() === 'yannick') {
      const adminLink = document.getElementById('auth-dd-admin-link');
      if (adminLink) adminLink.style.display = '';
    }

    const btn      = document.getElementById('auth-widget-btn');
    const dropdown = document.getElementById('auth-dropdown');

    btn.onclick = e => {
      e.stopPropagation();
      dropdown.classList.toggle('open');
    };
    document.addEventListener('click', () => dropdown.classList.remove('open'));
    dropdown.addEventListener('click', e => e.stopPropagation()); // keep dropdown open while using the email field
    document.getElementById('auth-logout-btn').onclick = () => logout();

    document.getElementById('auth-dd-email-save').onclick = async () => {
      const input    = document.getElementById('auth-dd-email-input');
      const statusEl = document.getElementById('auth-dd-email-status');
      const email    = input.value.trim();
      statusEl.textContent = 'Saving…';
      try {
        const res = await fetch('/api/auth/set-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${_token}` },
          body: JSON.stringify({ email }),
        });
        const data = await res.json();
        if (!res.ok) { statusEl.textContent = data.error || 'Could not save.'; return; }
        _user.email = data.email;
        localStorage.setItem(USER_KEY, JSON.stringify(_user));
        statusEl.textContent = data.email ? 'Recovery email saved.' : 'Recovery email removed.';
      } catch {
        statusEl.textContent = 'Connection error.';
      }
    };
  }

  // Tells topbar.js's tracking beacon which user to attribute events to (or
  // null if logged out). Safe/idempotent to call more than once as _user gets
  // set/refreshed at various points below.
  function identifyTopbar() {
    if (typeof Topbar !== 'undefined' && Topbar.identify) Topbar.identify(_user, _token);
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
    // A password-reset email link takes priority over the normal login/app flow.
    const params = new URLSearchParams(location.search);
    const resetToken = params.get('resetToken');
    if (resetToken) {
      params.delete('resetToken');
      const rest = params.toString();
      history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
      showResetModal(resetToken);
      return;
    }

    if (_token) {
      // If we have a cached user, load the app immediately — no waiting, no flash.
      // Token validity is checked in the background; a genuine 401 forces re-login.
      if (_user) {
        injectWidget();
        identifyTopbar();
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
                _user = { username: data.username, id: data.id, email: data.email || null };
                localStorage.setItem(USER_KEY, JSON.stringify(_user));
                identifyTopbar();
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
          _user = { username: data.username, id: data.id, email: data.email || null };
          localStorage.setItem(USER_KEY, JSON.stringify(_user));
          injectWidget();
          identifyTopbar();
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
