(() => {
  'use strict';
  const KEY = 'challengers_pending_invite';
  const validToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
  const normalizeCode = value => {
    const trimmed = String(value ?? '').trim();
    return /^[A-Za-z]{6}$/.test(trimmed) ? trimmed.toUpperCase() : '';
  };
  const validCode = value => /^[A-Z]{6}$/.test(value);
  const name = document.getElementById('invite-name');
  const meta = document.getElementById('invite-meta');
  const status = document.getElementById('invite-status');
  const actions = document.getElementById('invite-actions');
  const join = document.getElementById('join-btn');
  const later = document.getElementById('later-btn');
  const native = document.getElementById('native-link');
  const codeForm = document.getElementById('code-form');
  const codeInput = document.getElementById('invite-code');
  let credential = readCredential();
  let preview, busy = false, finished = false, previewVersion = 0;

  function readCredential() {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw);
      const code = normalizeCode(value?.code);
      return value && ((validToken(value.token) && { token: value.token }) || (validCode(code) && { code })) || null;
    } catch { return validToken(raw) ? { token: raw } : null; }
  }
  function saveCredential(next) {
    credential = next;
    if (next) sessionStorage.setItem(KEY, JSON.stringify(next));
    else sessionStorage.removeItem(KEY);
  }
  function incomingCredential() {
    const code = normalizeCode(new URLSearchParams(location.search).get('code'));
    if (code) {
      history.replaceState(null, '', location.pathname);
      return { code };
    }
    if (!location.hash) return undefined;
    const fragment = location.hash.slice(1);
    const token = fragment.startsWith('token=') ? fragment.slice(6) : '';
    history.replaceState(null, '', location.pathname + location.search);
    return validToken(token) ? { token } : null;
  }
  function setStatus(text, error = false) {
    status.textContent = text;
    status.className = `status${error ? ' error' : ''}`;
  }
  function button(label, action) {
    const element = document.createElement('button');
    element.type = 'button'; element.className = 'btn btn-primary';
    element.textContent = label; element.onclick = action;
    return element;
  }
  async function api(path, authenticated = false) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(authenticated && Auth.token ? { Authorization: `Bearer ${Auth.token}` } : {}) },
      body: JSON.stringify(credential || {})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const error = new Error(data.error || 'Please try again.'); error.status = res.status; throw error; }
    return data;
  }
  function resetForCredential() {
    preview = null; busy = false; finished = false; actions.hidden = true; native.hidden = true; codeForm.hidden = true;
    name.textContent = 'Checking invitation…'; meta.textContent = '';
  }
  function showNext() {
    if (!preview || finished || busy) return;
    actions.hidden = false;
    if (!Auth.user) {
      setStatus('Sign in or create an account to join.');
      actions.replaceChildren(button('Sign in or create account', () => Auth.showLogin()), later);
    } else {
      setStatus(`Signed in as ${Auth.user.username}. Joining is your choice.`);
      actions.replaceChildren(join, later);
    }
  }
  function showNativeLink() {
    const value = credential?.token || credential?.code;
    if (!value) return;
    const param = credential.token ? 'token' : 'code';
    const link = document.createElement('a');
    link.href = `yannickchallenge://invite?${param}=${encodeURIComponent(value)}`;
    link.textContent = 'Open in the CHALLENGERS app';
    native.replaceChildren(link); native.hidden = false;
  }
  async function loadPreview(version = previewVersion) {
    if (finished || !credential) return;
    const requestedCredential = credential;
    busy = true; actions.hidden = true; native.hidden = true;
    setStatus('Checking invitation…');
    try {
      const nextPreview = await api('/api/challenge-invites/preview');
      if (version !== previewVersion || credential !== requestedCredential) return;
      preview = nextPreview;
      name.textContent = preview.name;
      meta.textContent = `${preview.participantCount} members · Expires ${new Date(preview.expiresAt).toLocaleString()}`;
      codeForm.hidden = true;
      showNativeLink();
      busy = false; showNext();
    } catch (error) {
      if (version !== previewVersion || credential !== requestedCredential) return;
      preview = null; name.textContent = 'This invitation is unavailable';
      setStatus(error.message || 'Check your connection and try again.', true);
      if ([400, 404, 410].includes(error.status)) saveCredential(null);
      else { actions.replaceChildren(button('Try again', () => loadPreview()), later); actions.hidden = false; }
    } finally { if (version === previewVersion && credential === requestedCredential) busy = false; }
  }
  function start(next) {
    const version = ++previewVersion;
    saveCredential(next); resetForCredential();
    if (next) loadPreview(version);
    else {
      name.textContent = 'Enter an invitation code';
      meta.textContent = 'Enter the six-letter invitation code your manager shared.';
      setStatus('Ask your challenge manager for a new link or code.', true);
      codeForm.hidden = false;
    }
  }
  codeForm.onsubmit = event => {
    event.preventDefault();
    const code = normalizeCode(codeInput.value);
    if (!code) { setStatus('Enter the six letters from the invitation code.', true); return; }
    codeInput.value = code;
    start({ code });
  };
  codeInput.oninput = () => {
    const raw = String(codeInput.value ?? '');
    if (/^[A-Za-z\s]*$/.test(raw)) codeInput.value = raw.toUpperCase();
  };
  join.onclick = async () => {
    if (busy || finished || !preview) return;
    busy = true; join.disabled = true; later.disabled = true;
    setStatus('Joining challenge…');
    const session = Auth.token;
    let sessionChanged = false;
    try {
      const result = await api('/api/challenge-invites/accept', true);
      if (Auth.token !== session) { sessionChanged = true; return; }
      finished = true; saveCredential(null);
      setStatus(result.alreadyMember ? 'You already belong to this challenge.' : 'You joined the challenge.');
      const link = document.createElement('a'); link.className = 'btn btn-primary';
      link.href = `/challengers/#${encodeURIComponent(result.challenge.id)}`;
      link.textContent = 'Open challenge'; actions.replaceChildren(link);
    } catch (error) {
      setStatus(error.status === 401 ? 'Your session expired. Sign in again to join.' : error.message, true);
      if (error.status === 401) Auth.showLogin();
      if ([400, 404, 410].includes(error.status)) {
        saveCredential(null); finished = true; actions.hidden = true; native.hidden = true;
      }
    } finally {
      busy = false; join.disabled = false; later.disabled = false;
      if (sessionChanged) showNext();
    }
  };
  later.onclick = () => {
    if (busy) return;
    finished = true; saveCredential(null);
    setStatus('You have not joined this challenge. You can open the original link or enter its code later.');
    actions.hidden = true; native.hidden = true;
  };
  window.addEventListener('hashchange', () => start(incomingCredential() || null));
  Auth.onReady(showNext);
  window.addEventListener('auth:user-changed', showNext);
  const incoming = incomingCredential();
  start(incoming === undefined ? credential : incoming);
})();
