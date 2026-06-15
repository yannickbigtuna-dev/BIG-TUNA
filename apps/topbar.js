// topbar.js — shared navigation bar for BIG TUNA apps
// Usage: <script src="/topbar.js"></script> before <script src="/auth.js"></script>
// API:
//   Topbar.setTitle('My App')  — show text in the centre of the bar
//   Topbar.addLeft(element)    — inject a button to the left of HOME (e.g. sidebar toggle)

const Topbar = (() => {
  'use strict';

  const APPS = [
    { name: 'Climb Tracker',    href: '/climb-tracker/',      icon: '\u26f0' },
    { name: 'Workout Timer',    href: '/workout-timer/',     icon: '⏱' },
    { name: 'Quizzes',          href: '/quiz-app/',           icon: '❓' },
    { name: 'Psych Sheet',      href: '/psych-sheet/',        icon: '🏊' },
    { name: 'Lists',            href: '/list-maker/',         icon: '📋' },
    { name: 'Eco AI',           href: '/eco-ai/',             icon: '🌱' },
    { name: 'Assignments',      href: '/assignments/',        icon: '✓' },
    { name: 'World Map',        href: '/world-map/',          icon: '🌍' },
    { name: 'Pace Calculator',  href: '/pace-calculator/',    icon: '🏃' },
    { name: 'Lights',           href: '/lights/',             icon: '💡' },
    { name: 'Terminal',         href: '/terminal/',           icon: '🖥' },
  ];
  APPS.splice(5, 0, { name: 'Weather', href: '/weather/', icon: '\u2600' });

  let _leftQueue   = [];   // elements queued before init
  let _titleText   = null; // title queued before init
  let _titleEl     = null;
  let _initialized = false;

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
      background: rgba(10, 10, 10, 0.94);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border-bottom: 1px solid #1a1a1a;
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
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 0.78rem;
      font-weight: 700;
      color: #555;
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
      border-radius: 10px;
      color: #fff;
      cursor: pointer;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
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
      background: #141414;
      border: 1px solid #2a2a2a;
      border-radius: 13px;
      padding: 6px;
      min-width: 190px;
      display: none;
      box-shadow: 0 10px 32px rgba(0, 0, 0, 0.7);
      z-index: 500;
    }
    #tt-apps-dd.open { display: block; }

    .tt-app-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 9px;
      text-decoration: none;
      color: #ccc;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 0.86rem;
      font-weight: 600;
      transition: background 0.12s, color 0.12s;
    }
    .tt-app-item:hover { background: rgba(255, 255, 255, 0.07); color: #fff; }
    .tt-app-item.tt-current { color: #444; pointer-events: none; cursor: default; }
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { setTitle, addLeft };
})();
