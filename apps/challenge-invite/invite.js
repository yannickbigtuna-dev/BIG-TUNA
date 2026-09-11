(() => {
  'use strict';
  const KEY = 'challengers_pending_invite';
  window.addEventListener('hashchange', () => { if (location.hash) location.reload(); });
  const validToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
  if (location.hash) {
    const fragment = location.hash.slice(1);
    const value = fragment.startsWith('token=') ? fragment.slice(6) : '';
    sessionStorage.removeItem(KEY);
    if (validToken(value)) sessionStorage.setItem(KEY, value);
    history.replaceState(null, '', location.pathname + location.search);
  }
  const token = sessionStorage.getItem(KEY);
  const name = document.getElementById('invite-name');
  const meta = document.getElementById('invite-meta');
  const status = document.getElementById('invite-status');
  const actions = document.getElementById('invite-actions');
  const join = document.getElementById('join-btn');
  const later = document.getElementById('later-btn');
  const native = document.getElementById('native-link');
  let preview, busy = false, finished = false;
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
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated && Auth.token ? { Authorization: `Bearer ${Auth.token}` } : {}) },
      body: JSON.stringify({ token })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const error = new Error(data.error || 'Please try again.'); error.status = res.status; throw error; }
    return data;
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
  async function loadPreview() {
    if (busy || finished) return;
    busy = true; actions.hidden = true; native.hidden = true;
    setStatus('Checking invitation…');
    try {
      preview = await api('/api/challenge-invites/preview');
      name.textContent = preview.name;
      meta.textContent = `${preview.participantCount} members · Expires ${new Date(preview.expiresAt).toLocaleString()}`;
      const link = document.createElement('a');
      link.href = `yannickchallenge://invite?token=${token}`;
      link.textContent = 'Open in the CHALLENGERS app';
      native.replaceChildren(link); native.hidden = false;
      busy = false; showNext();
    } catch (error) {
      preview = null; name.textContent = 'This invitation is unavailable';
      setStatus(error.message || 'Check your connection and try again.', true);
      if ([404, 410].includes(error.status)) sessionStorage.removeItem(KEY);
      else { actions.replaceChildren(button('Try again', loadPreview), later); actions.hidden = false; }
    } finally { busy = false; }
  }
  join.onclick = async () => {
    if (busy || finished || !preview) return;
    busy = true; join.disabled = true; later.disabled = true;
    setStatus('Joining challenge…');
    const session = Auth.token;
    try {
      const result = await api('/api/challenge-invites/accept', true);
      if (Auth.token !== session) return;
      finished = true; sessionStorage.removeItem(KEY);
      setStatus(result.alreadyMember ? 'You already belong to this challenge.' : 'You joined the challenge.');
      const link = document.createElement('a'); link.className = 'btn btn-primary';
      link.href = `/challengers/#${encodeURIComponent(result.challenge.id)}`;
      link.textContent = 'Open challenge'; actions.replaceChildren(link);
    } catch (error) {
      setStatus(error.status === 401 ? 'Your session expired. Sign in again to join.' : error.message, true);
      if (error.status === 401) Auth.showLogin();
      if ([404, 410].includes(error.status)) {
        sessionStorage.removeItem(KEY); finished = true; actions.hidden = true; native.hidden = true;
      }
    } finally { busy = false; join.disabled = false; later.disabled = false; }
  };
  later.onclick = () => {
    if (busy) return;
    finished = true; sessionStorage.removeItem(KEY);
    setStatus('You have not joined this challenge. You can open the original link again later.');
    actions.hidden = true; native.hidden = true;
  };
  Auth.onReady(showNext);
  window.addEventListener('auth:user-changed', showNext);
  if (validToken(token)) loadPreview();
  else { sessionStorage.removeItem(KEY); name.textContent = 'Invitation link missing'; setStatus('Ask your challenge manager for a new link.', true); }
})();
