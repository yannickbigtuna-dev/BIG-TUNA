(() => {
  'use strict';
  const list = document.getElementById('list'), detail = document.getElementById('detail'), status = document.getElementById('status');
  const newDialog = document.getElementById('new-dialog'), shareDialog = document.getElementById('share-dialog');
  const shareStatus = document.getElementById('share-status'), shareURL = document.getElementById('share-url');
  const qr = document.getElementById('share-qr'), copy = document.getElementById('copy-link'), native = document.getElementById('native-open');
  const generate = document.getElementById('generate-link'), revoke = document.getElementById('revoke-link');
  let challenges = [], detailVersion = 0, shareVersion = 0, shareChallenge, shareBusy = false, createBusy = false, createRequest;
  const message = (text, error = false) => { status.textContent = text; status.style.color = error ? 'var(--danger)' : ''; };
  function element(tag, text, className) { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; }
  function button(label, action) { const node = element('button', label, 'btn btn-primary'); node.type = 'button'; node.onclick = action; return node; }
  const roleFor = challenge => challenge.participants.find(person => person.userId === Auth.user?.id)?.role;
  async function request(path, options = {}) {
    const session = Auth.token;
    const response = await fetch(path, { ...options, headers: { Authorization: `Bearer ${session}`, 'Content-Type': 'application/json' } });
    const data = await response.json().catch(() => ({}));
    if (Auth.token !== session) throw new Error('Your account changed. Refresh to continue.');
    if (!response.ok) {
      if (response.status === 401) { newDialog.close(); shareDialog.close(); Auth.showLogin(); }
      throw new Error(data.error || 'Please try again.');
    }
    return data;
  }
  function showList() {
    list.replaceChildren();
    if (!challenges.length) { list.append(element('p', 'Create a challenge, then invite your training partners.', 'card muted')); return; }
    for (const challenge of challenges) {
      const card = button('', () => loadDetail(challenge.id)); card.className = 'card challenge';
      card.append(element('h2', challenge.name), element('p', `${challenge.participants.length} members · ${roleFor(challenge) || 'member'}`, 'muted'));
      list.append(card);
    }
  }
  async function load() {
    try {
      message('Loading challenges…');
      const data = await request('/api/challenges');
      challenges = (data.challenges || []).filter(challenge => challenge.template !== 'yannick-emma-default');
      showList(); detail.hidden = true; message(challenges.length ? '' : 'No challenges yet.');
      const target = location.hash.slice(1);
      if (challenges.some(challenge => challenge.id === target)) await loadDetail(target);
    } catch (error) { message(error.message, true); }
  }
  async function loadDetail(id) {
    const version = ++detailVersion;
    try {
      message('Loading challenge…');
      const challenge = await request(`/api/challenges/${encodeURIComponent(id)}`);
      if (version !== detailVersion) return;
      detail.hidden = false; detail.replaceChildren();
      const scores = element('ul', '', 'score-list');
      challenge.participants.forEach(person => {
        const row = document.createElement('li');
        row.append(element('span', person.userId === Auth.user.id ? Auth.user.username : person.userId), element('strong', String(challenge.currentScore?.[person.userId] ?? 0)));
        scores.append(row);
      });
      const actions = element('div', '', 'actions');
      if (['owner', 'admin'].includes(roleFor(challenge)) && challenge.template !== 'yannick-emma-default') actions.append(button('Invite people', () => openShare(challenge)));
      detail.append(element('h2', challenge.name), element('p', `${challenge.participants.length} members · ${challenge.rules.cadence.type} challenge`, 'muted'), scores, actions);
      history.replaceState(null, '', `#${encodeURIComponent(id)}`); message('');
    } catch (error) { if (version === detailVersion) message(error.message, true); }
  }
  document.querySelectorAll('[data-close]').forEach(node => node.onclick = () => node.closest('dialog').close());
  document.getElementById('new-challenge').onclick = () => newDialog.showModal();
  document.getElementById('refresh').onclick = load;
  document.getElementById('new-form').onsubmit = async event => {
    event.preventDefault(); if (createBusy) return;
    const form = event.currentTarget, values = new FormData(form);
    const payload = { name: String(values.get('name')).trim(), template: values.get('template') };
    if (!createRequest || createRequest.name !== payload.name || createRequest.template !== payload.template) createRequest = { ...payload, idempotencyKey: crypto.randomUUID().replaceAll('-', '') };
    createBusy = true; const submit = form.querySelector('[type=submit],button:not([type])'); submit.disabled = true;
    try {
      const result = await request('/api/challenges', { method: 'POST', body: JSON.stringify(createRequest) });
      createRequest = null; newDialog.close(); form.reset(); await load(); await loadDetail(result.id);
    } catch (error) { document.getElementById('create-status').textContent = error.message; }
    finally { createBusy = false; submit.disabled = false; }
  };
  function clearLink() {
    shareURL.textContent = ''; qr.hidden = true; qr.removeAttribute('src');
    copy.hidden = true; copy.onclick = null; native.hidden = true; native.removeAttribute('href');
  }
  function openShare(challenge) {
    if (shareBusy) return;
    shareChallenge = challenge; shareVersion++; clearLink();
    document.getElementById('share-title').textContent = `Invite people to ${challenge.name}`;
    shareStatus.textContent = 'Generate a seven-day link. Generating another link replaces the previous one.';
    shareDialog.showModal();
  }
  generate.onclick = async () => {
    if (!shareChallenge || shareBusy) return;
    const challenge = shareChallenge, version = shareVersion;
    shareBusy = true; generate.disabled = true; revoke.disabled = true; clearLink(); shareStatus.textContent = 'Creating invitation…';
    try {
      const data = await request(`/api/challenges/${encodeURIComponent(challenge.id)}/invites`, { method: 'POST', body: '{}' });
      if (version !== shareVersion) return;
      if (!/^[A-Za-z0-9_-]{43}$/.test(data.token) || data.url !== `https://yannickmorgans.ca/challenge-invite/#token=${data.token}`) throw new Error('The invitation response was invalid. Try again.');
      shareURL.textContent = data.url; copy.hidden = false;
      copy.onclick = async () => {
        try { await navigator.clipboard.writeText(data.url); shareStatus.textContent = 'Invitation link copied.'; }
        catch { shareStatus.textContent = 'Select and copy the link above.'; }
      };
      native.href = `yannickchallenge://invite?token=${data.token}`; native.hidden = false;
      if (typeof data.qrDataURL === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data.qrDataURL) && data.qrDataURL.length < 1000000) { qr.src = data.qrDataURL; qr.hidden = false; }
      shareStatus.textContent = `Expires ${new Date(data.expiresAt).toLocaleString()}.`;
    } catch (error) { shareStatus.textContent = error.message; }
    finally { shareBusy = false; generate.disabled = false; revoke.disabled = false; }
  };
  revoke.onclick = async () => {
    if (!shareChallenge || shareBusy) return;
    shareBusy = true; generate.disabled = true; revoke.disabled = true;
    try {
      await request(`/api/challenges/${encodeURIComponent(shareChallenge.id)}/invites`, { method: 'DELETE' });
      clearLink(); shareStatus.textContent = 'Invitation revoked.';
    } catch (error) { shareStatus.textContent = error.message; }
    finally { shareBusy = false; generate.disabled = false; revoke.disabled = false; }
  };
  Auth.onReady(user => { if (user) load(); });
  window.addEventListener('auth:user-changed', () => { if (Auth.user) load(); });
})();