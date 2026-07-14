// topbar.js — shared navigation bar for BIG TUNA apps
// Usage: <script src="/topbar.js"></script> before <script src="/auth.js"></script>
// API:
//   Topbar.setTitle('My App')  — show text in the centre of the bar
//   Topbar.addLeft(element)    — inject a button to the left of HOME (e.g. sidebar toggle)

const Topbar = (() => {
  'use strict';

  // `color` is the rainbow token each app tints to (matches the homepage grid).
  const APPS = [
    { name: 'Climb Tracker',   href: '/climb-tracker/',   icon: '⛰', color: 'var(--c-red)' },
    { name: 'Workout Timer',   href: '/workout-timer/',   icon: '⏱', color: 'var(--c-orange)' },
    { name: 'Trivia',          href: '/trivia/',          icon: '🧠', color: 'var(--c-yellow)' },
    { name: 'Quizzes',         href: '/quiz-app/',        icon: '❓', color: 'var(--c-yellow)' },
    { name: 'Psych Sheet',     href: '/psych-sheet/',     icon: '🏊', color: 'var(--c-green)' },
    { name: 'Lists',           href: '/list-maker/',      icon: '📋', color: 'var(--c-teal)' },
    { name: 'Weather',         href: '/weather/',         icon: '☀', color: 'var(--c-cyan)' },
    { name: 'Emma',            href: '/eco-ai/',          icon: '✨', color: 'var(--c-cyan)' },
    { name: 'Assignments',     href: '/assignments/',     icon: '✓', color: 'var(--c-blue)' },
    { name: 'World Map',       href: '/world-map/',       icon: '🌍', color: 'var(--c-indigo)' },
    { name: 'Pace Calculator', href: '/pace-calculator/', icon: '🏃', color: 'var(--c-purple)' },
    { name: 'Lights',          href: '/lights/',          icon: '💡', color: 'var(--c-amber)' },
    { name: 'Terminal',        href: '/terminal/',        icon: '🖥', color: 'var(--c-green)' },
  ];

  // Capitals Quiz isn't in the dropdown list above but still gets a tint.
  const EXTRA_COLORS = [
    { href: '/capitals-quiz/', color: 'var(--c-pink)' },
  ];

  // Tint the whole app to its rainbow accent by overriding --accent (every
  // primitive — buttons, focus rings, links — derives from it). Applied as
  // early as possible to avoid a flash of the default brand red.
  (function applyAppAccent() {
    try {
      const path = location.pathname.replace(/\/$/, '') || '/';
      const match = APPS.concat(EXTRA_COLORS).find(a => {
        const p = a.href.replace(/\/$/, '');
        return path === p || path.startsWith(p + '/');
      });
      if (!match || !match.color) return;
      const root = document.documentElement.style;
      root.setProperty('--accent', match.color);
      root.setProperty('--accent-hover', `color-mix(in srgb, ${match.color} 78%, #ffffff)`);
      root.setProperty('--accent-press', `color-mix(in srgb, ${match.color} 82%, #000000)`);
    } catch {}
  })();

  let _leftQueue   = [];   // elements queued before init
  let _titleText   = null; // title queued before init
  let _titleEl     = null;
  let _initialized = false;

  // ── Site-wide tracking beacon ────────────────────────────────────────────────
  // Sends anonymous/attributed pageview + heartbeat + click events to
  // /api/analytics/event so /admin/ (yannick-only) can show real usage. See
  // CODEX_CONTEXT.md for the full data-shape/privacy notes. Explicitly does NOT
  // capture keystrokes, form values, or full DOM selectors — only a click
  // target's tag/id/first-class/trimmed-text plus viewport-relative position.
  let _sessionId      = null;
  let _identifiedUser = null; // set via Topbar.identify(user, token)
  let _identifiedToken = null; // bearer token, carried in-body since sendBeacon can't set headers
  let _pageviewSent   = false;
  let _pendingGeo     = null; // {lat, lon} opportunistically attached to the next beacon
  let _lastClickSent  = 0;

  try {
    _sessionId = sessionStorage.getItem('bt_session_id');
    if (!_sessionId) {
      _sessionId = crypto.randomUUID();
      sessionStorage.setItem('bt_session_id', _sessionId);
    }
  } catch {}

  function sendBtBeacon(payload) {
    try {
      const data = Object.assign({
        sessionId: _sessionId,
        userId: _identifiedUser ? _identifiedUser.id : null,
        // Carried in-body (not a header) because sendBeacon can't set custom
        // headers — the server resolves the real session user from this if
        // no Authorization header is present, so events still attribute
        // correctly to a logged-in user. See server.js's /api/analytics/event.
        token: _identifiedToken || undefined,
        path: location.pathname,
        referrer: document.referrer,
      }, payload);
      if (_pendingGeo) {
        data.lat = _pendingGeo.lat;
        data.lon = _pendingGeo.lon;
        _pendingGeo = null;
      }
      const body = JSON.stringify(data);
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/analytics/event', body);
      } else {
        fetch('/api/analytics/event', {
          method: 'POST',
          body,
          keepalive: true,
          headers: { 'Content-Type': 'text/plain' },
        }).catch(() => {});
      }
    } catch {}
  }

  // Opportunistic geolocation: never triggers a fresh permission prompt. Only
  // reads a position when the permission is already 'granted' (e.g. via the
  // Weather app), and never blocks/delays sending the beacon it's called for.
  function tryEnhanceGeo() {
    try {
      if (!navigator.permissions || !navigator.permissions.query) return;
      navigator.permissions.query({ name: 'geolocation' }).then(status => {
        if (status.state === 'granted') {
          navigator.geolocation.getCurrentPosition(pos => {
            _pendingGeo = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          }, () => {}, { timeout: 2000 });
        }
      }).catch(() => {});
    } catch {}
  }

  function sendPageview() {
    if (_pageviewSent) return;
    _pageviewSent = true;
    tryEnhanceGeo();
    sendBtBeacon({ type: 'pageview' });
  }

  // Fires on Topbar.identify() or after ~300ms, whichever comes first, so
  // pages that never load auth.js (e.g. lights, weather) still get an
  // anonymous pageview instead of losing it.
  setTimeout(sendPageview, 300);

  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    tryEnhanceGeo();
    sendBtBeacon({ type: 'heartbeat' });
  }, 15000);

  document.addEventListener('click', e => {
    const now = Date.now();
    if (now - _lastClickSent < 150) return;
    _lastClickSent = now;
    try {
      const el = e.target.closest('button, a, [role="button"]') || e.target;
      const target = {
        tag:  el.tagName ? el.tagName.toLowerCase() : '',
        id:   el.id || '',
        cls:  (el.className && typeof el.className === 'string' ? el.className.split(' ')[0] : '') || '',
        text: (el.textContent || '').trim().slice(0, 40),
      };
      const xPct = (e.clientX / window.innerWidth) * 100;
      const yPct = (e.clientY / window.innerHeight) * 100;
      tryEnhanceGeo();
      sendBtBeacon({ type: 'click', target, xPct, yPct });
    } catch {}
  }, { capture: true });

  const CSS = `
    #topbar {
      position: sticky;
      top: 0;
      z-index: 200;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      height: calc(52px + env(safe-area-inset-top, 0px));
      padding: env(safe-area-inset-top, 0px) 12px 0;
      background: color-mix(in srgb, var(--bg) 94%, transparent);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--border);
      box-sizing: border-box;
    }

    #tt-left {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }

    #tt-center {
      flex: 1;
      font-family: var(--font-ui);
      font-size: 0.78rem;
      font-weight: 700;
      color: var(--text-dim);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      text-align: center;
      pointer-events: none;
    }

    #tt-right {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }

    /* ── Shared button style ── */
    .tt-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: rgba(255, 255, 255, 0.08);
      border: none;
      border-radius: var(--radius-sm);
      color: var(--text);
      cursor: pointer;
      font-family: var(--font-ui);
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.07em;
      min-height: 34px;
      padding: 7px 12px;
      text-decoration: none;
      touch-action: manipulation;
      transition: background 0.15s;
      white-space: nowrap;
    }
    .tt-btn:hover, .tt-btn:active { background: rgba(255, 255, 255, 0.14); }
    .tt-btn svg { width: 14px; height: 14px; fill: currentColor; flex-shrink: 0; }

    /* ── APPS dropdown ── */
    #tt-apps-wrap { position: relative; }

    #tt-apps-dd {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 6px;
      min-width: 190px;
      display: none;
      box-shadow: var(--shadow-3);
      z-index: 500;
    }
    #tt-apps-dd.open { display: block; }

    .tt-app-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-radius: var(--radius-sm);
      text-decoration: none;
      color: var(--text-muted);
      font-family: var(--font-ui);
      font-size: 0.86rem;
      font-weight: 600;
      transition: background 0.12s, color 0.12s;
    }
    .tt-app-item:hover { background: var(--surface-3); color: var(--text); }
    .tt-app-item.tt-current { color: var(--text-faint); pointer-events: none; cursor: default; }
    .tt-app-item .tt-app-icon { font-size: 1.1rem; width: 24px; text-align: center; flex-shrink: 0; }
  `;

  function init() {
    if (_initialized) return;
    _initialized = true;

    // Inject styles
    const styleEl = document.createElement('style');
    styleEl.id = 'topbar-styles';
    styleEl.textContent = CSS;
    document.head.appendChild(styleEl);

    // Detect current app path to grey it out in the dropdown
    const currentPath = location.pathname.replace(/\/$/, '') || '/';

    const appsHTML = APPS.map(a => {
      const appPath = a.href.replace(/\/$/, '');
      const isCurrent = currentPath === appPath || currentPath.startsWith(appPath + '/');
      return `<a href="${a.href}" class="tt-app-item${isCurrent ? ' tt-current' : ''}">
        <span class="tt-app-icon">${a.icon}</span>${a.name}
      </a>`;
    }).join('');

    // Build the topbar element
    const bar = document.createElement('div');
    bar.id = 'topbar';
    bar.innerHTML = `
      <div id="tt-left">
        <div id="tt-extra-slot"></div>
        <a href="/" class="tt-btn" id="tt-home-btn">
          <svg viewBox="0 0 24 24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
          HOME
        </a>
      </div>
      <div id="tt-center"></div>
      <div id="tt-right">
        <div id="tt-apps-wrap">
          <button class="tt-btn" id="tt-apps-btn">
            <svg viewBox="0 0 24 24"><path d="M4 8h4V4H4v4zm6 12h4v-4h-4v4zm-6 0h4v-4H4v4zm0-6h4v-4H4v4zm6 0h4v-4h-4v4zm6-10v4h4V4h-4zm-6 4h4V4h-4v4zm6 6h4v-4h-4v4zm0 6h4v-4h-4v4z"/></svg>
            APPS
          </button>
          <div id="tt-apps-dd">${appsHTML}</div>
        </div>
        <div data-auth-widget></div>
      </div>
    `;

    // Insert as first child of body so it's part of flex column layouts
    document.body.insertBefore(bar, document.body.firstChild);

    // Wire up title
    _titleEl = document.getElementById('tt-center');
    if (_titleText !== null) _titleEl.textContent = _titleText;

    // Flush queued left-side elements
    const extraSlot = document.getElementById('tt-extra-slot');
    _leftQueue.forEach(el => extraSlot.appendChild(el));

    // APPS dropdown toggle
    const appsBtn = document.getElementById('tt-apps-btn');
    const appsDD  = document.getElementById('tt-apps-dd');
    appsBtn.addEventListener('click', e => {
      e.stopPropagation();
      appsDD.classList.toggle('open');
    });
    document.addEventListener('click', () => appsDD.classList.remove('open'));
  }

  // Public API ─────────────────────────────────────────────────────────────────

  function setTitle(text) {
    _titleText = text;
    if (_titleEl) _titleEl.textContent = text;
  }

  function addLeft(el) {
    if (_initialized) {
      document.getElementById('tt-extra-slot').appendChild(el);
    } else {
      _leftQueue.push(el);
    }
  }

  // Called by auth.js once the current user is known (or confirmed logged
  // out) so beacon events can be attributed. Idempotent — safe to call more
  // than once (e.g. once from cache, again after /api/auth/me resolves).
  function identify(user, token) {
    _identifiedUser = user || null;
    _identifiedToken = token || null;
    sendPageview();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { setTitle, addLeft, identify };
})();
