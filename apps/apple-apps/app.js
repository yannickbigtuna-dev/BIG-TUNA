/* global Auth */
(() => {
  'use strict';
  const status = document.getElementById('status');
  const catalogue = document.getElementById('catalogue');

  function text(value) { return typeof value === 'string' ? value : ''; }
  function addText(parent, tag, value, className) {
    const node = document.createElement(tag); node.textContent = value;
    if (className) node.className = className;
    parent.append(node); return node;
  }
  function render(app) {
    const card = document.createElement('article'); card.className = 'app-card';
    const icon = document.createElement('img'); icon.className = 'icon'; icon.alt = '';
    icon.src = `/api/apple-app-factory/apps/${encodeURIComponent(app.slug)}/icon`;
    icon.onerror = () => { const fallback = document.createElement('div'); fallback.className = 'icon-placeholder'; fallback.textContent = text(app.name).slice(0, 1).toUpperCase() || 'A'; icon.replaceWith(fallback); };
    card.append(icon);
    const body = document.createElement('div');
    addText(body, 'h2', text(app.name));
    addText(body, 'p', `Version ${text(app.version) || 'unavailable'} (${text(app.build) || 'build unavailable'}) · ${text(app.releaseDate) || 'release date unavailable'}`, 'meta');
    const requirements = [app.minimumIOS && `iOS ${app.minimumIOS}+`, app.minimumWatchOS && `watchOS ${app.minimumWatchOS}+`].filter(Boolean);
    if (requirements.length) addText(body, 'p', requirements.join(' · '), 'meta');
    if (Array.isArray(app.components) && app.components.length) { const tags = document.createElement('div'); tags.className = 'tags'; app.components.forEach(item => addText(tags, 'span', text(item), 'tag')); body.append(tags); }
    if (app.releaseNotes) addText(body, 'p', text(app.releaseNotes), 'notes');
    const download = document.createElement('a'); download.className = 'download'; download.href = `/api/apple-app-factory/apps/${encodeURIComponent(app.slug)}/download/latest`; download.textContent = 'Download verified IPA'; body.append(download);
    if (app.sha256) addText(body, 'p', `SHA-256 ${text(app.sha256)}`, 'checksum');
    if (app.installationStatus) addText(body, 'p', text(app.installationStatus), 'meta');
    if (Array.isArray(app.releases) && app.releases.length > 1) {
      const history = document.createElement('p'); history.className = 'meta'; history.append(document.createTextNode('Previous releases: '));
      app.releases.slice(1).forEach((release, index) => {
        if (index) history.append(document.createTextNode(' · '));
        const link = document.createElement('a'); link.href = `/api/apple-app-factory/apps/${encodeURIComponent(app.slug)}/download/${encodeURIComponent(text(release.version))}`; link.textContent = `v${text(release.version)} (${text(release.build)})`; history.append(link);
      });
      body.append(history);
    }
    card.append(body); catalogue.append(card);
  }
  async function load() {
    if (!Auth.token) { status.textContent = 'Sign in with the configured owner account to view private releases.'; return; }
    try {
      const response = await fetch('/api/apple-app-factory/catalog', { headers: { Authorization: `Bearer ${Auth.token}` }, cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Private catalogue unavailable');
      const apps = Array.isArray(payload.apps) ? payload.apps : [];
      status.textContent = apps.length ? `${apps.length} private app${apps.length === 1 ? '' : 's'} available.` : 'No published app releases yet.';
      apps.forEach(render);
    } catch (error) { status.textContent = error.message || 'Private catalogue unavailable.'; }
  }
  Auth.onReady(load);
})();
