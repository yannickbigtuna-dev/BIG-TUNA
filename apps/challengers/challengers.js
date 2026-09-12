(() => {
  'use strict';
  const list = document.getElementById('list'), detail = document.getElementById('detail'), status = document.getElementById('status');
  const newDialog = document.getElementById('new-dialog'), shareDialog = document.getElementById('share-dialog');
  const settingsDialog = document.getElementById('settings-dialog'), inboxDialog = document.getElementById('inbox-dialog');
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
      const role = roleFor(challenge);
      card.append(element('h2', challenge.name), element('p', `${challenge.participants.length} members · ${role || 'member'}`, 'muted'));
      if (['owner', 'admin'].includes(role)) {
        const delBtn = document.createElement('button'); delBtn.className = 'btn btn-ghost'; delBtn.type = 'button'; delBtn.style.marginTop = 'var(--space-3)'; delBtn.style.color = 'var(--danger)'; delBtn.textContent = 'Delete challenge';
        delBtn.onclick = async (e) => { e.stopPropagation(); if(confirm(`Delete ${challenge.name}?`)) { try { await request(`/api/challenges/${encodeURIComponent(challenge.id)}`, { method: 'DELETE' }); await load(); } catch(err) { alert(err.message); } } };
        card.append(delBtn);
      }
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
  
  // Dynamic form logic for Template changes
  const tplSelect = document.getElementById('form-template');
  const nameInput = document.querySelector('[name=name]');
  const cadSelect = document.getElementById('form-cadence');
  const scoSelect = document.getElementById('form-scoring');
  tplSelect.onchange = () => {
    if(nameInput.value === 'Weekly challenge' || nameInput.value === '') { nameInput.value = tplSelect.options[tplSelect.selectedIndex].text; }
    if(tplSelect.value === 'season') { cadSelect.value = 'season'; scoSelect.value = 'count'; }
    else if(tplSelect.value === 'distance') { cadSelect.value = 'weekly'; scoSelect.value = 'distance'; }
    else if(tplSelect.value === 'streak') { cadSelect.value = 'weekly'; scoSelect.value = 'streak'; }
    else { cadSelect.value = 'weekly'; scoSelect.value = 'count'; }
  };
  
  let sportRulesCounter = 0;
  function addSportRow() {
    const list = document.getElementById('sports-list');
    const row = document.createElement('div');
    row.style.display = 'flex'; row.style.gap = 'var(--space-2)'; row.style.marginBottom = 'var(--space-2)';
    row.innerHTML = `<select class="field sport-type" required><option value="Run">Run</option><option value="Ride">Ride</option><option value="Swim">Swim</option><option value="Walk">Walk</option><option value="Workout">Workout</option><option value="HighIntensityIntervalTraining">HIIT</option></select>
    <select class="field sport-min-type"><option value="none">No min</option><option value="time">Min time (min)</option><option value="distance">Min dist (km)</option></select>
    <input class="field sport-min-val" type="number" step="any" placeholder="Value" style="display:none">
    <button type="button" class="btn btn-ghost rm-sport" style="color:var(--danger)">X</button>`;
    const sel = row.querySelector('.sport-min-type'), val = row.querySelector('.sport-min-val');
    sel.onchange = () => val.style.display = sel.value === 'none' ? 'none' : 'block';
    row.querySelector('.rm-sport').onclick = () => row.remove();
    list.append(row);
  }
  document.getElementById('add-sport').onclick = addSportRow;

  document.getElementById('new-challenge').onclick = () => {
    document.getElementById('sports-list').innerHTML = ''; addSportRow();
    newDialog.showModal();
  };
  document.getElementById('refresh').onclick = load;
  document.getElementById('new-form').onsubmit = async event => {
    event.preventDefault(); if (createBusy) return;
    const form = event.currentTarget, values = new FormData(form);
    
    const sportRules = Array.from(document.getElementById('sports-list').children).map(row => {
      const type = row.querySelector('.sport-type').value;
      const minType = row.querySelector('.sport-min-type').value;
      let val = null;
      if (minType === 'time') val = (parseFloat(row.querySelector('.sport-min-val').value) || 0) * 60;
      else if (minType === 'distance') val = (parseFloat(row.querySelector('.sport-min-val').value) || 0) * 1000;
      return { sportType: type, minimum: { type: minType, value: val } };
    });
    
    let participants = null;
    const pUser = values.get('participantUsername').trim();
    if(pUser) participants = [{ userId: pUser, role: 'member' }];

    const payload = { 
      name: String(values.get('name')).trim(), 
      template: values.get('template'),
      participants,
      qualifyingActivities: sportRules.map(r => r.sportType),
      sportRules,
      thresholds: { distanceMeters: null, durationSeconds: null, elevationMeters: null, activityCount: null },
      scoring: { mode: values.get('scoringMode'), pointsPerActivity: 1 },
      cadence: { type: values.get('cadenceType') },
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      manualReview: document.getElementById('form-review').checked
    };
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

  // Settings Modal
  const sBtn = document.getElementById('settings-strava-btn');
  const sStat = document.getElementById('settings-status');
  document.getElementById('open-settings').onclick = async () => {
    settingsDialog.showModal(); sStat.textContent = 'Loading account...';
    try {
      const me = await request('/api/challenge-accounts/me');
      document.getElementById('settings-account-name').textContent = `Signed in as ${me.username}`;
      const conn = me.strava?.connected;
      document.getElementById('settings-strava-status').textContent = conn ? 'Strava: Connected' : 'Strava: Not connected';
      sBtn.textContent = conn ? 'Disconnect Strava' : 'Connect Strava';
      sBtn.className = conn ? 'btn btn-ghost' : 'btn btn-primary';
      if(conn) sBtn.style.color = 'var(--danger)'; else sBtn.style.color = '';
      sBtn.onclick = async () => {
        try {
          if(conn) { await request('/api/challenge-accounts/strava/connection', { method: 'DELETE' }); settingsDialog.close(); }
          else { 
            const data = await request('/api/challenge-accounts/strava/connection/start', { method: 'POST', body: '{}' });
            if (data.authorizationUrl) location.href = data.authorizationUrl;
          }
        } catch(e) { sStat.textContent = e.message; }
      };
      sStat.textContent = '';
    } catch(err) { sStat.textContent = err.message; }
  };
  document.getElementById('settings-signout-btn').onclick = async () => {
    try { await request('/api/auth/logout', { method: 'POST', body: '{}' }); Auth.showLogin(); settingsDialog.close(); }
    catch(err) { sStat.textContent = err.message; }
  };
  document.getElementById('settings-inbox-btn').onclick = () => { settingsDialog.close(); document.getElementById('open-inbox').click(); };

  // Review Inbox Modal
  document.getElementById('open-inbox').onclick = async () => {
    inboxDialog.showModal(); const lst = document.getElementById('inbox-list'); lst.replaceChildren(); document.getElementById('inbox-empty').hidden = true;
    try {
      const res = await request('/api/challenge-review-inbox');
      if(!res.reviews || !res.reviews.length) { document.getElementById('inbox-empty').hidden = false; return; }
      res.reviews.forEach(item => {
        const li = document.createElement('li'); li.style.display = 'block';
        const hdr = element('div', `${item.review.requesterDisplayName} requested a review for ${item.challenge.name}`); hdr.style.fontWeight = 'bold';
        const act = element('div', `${item.review.activity.name || item.review.activity.sportType} (${item.review.activity.distanceMeters ? (item.review.activity.distanceMeters/1000).toFixed(1)+' km' : ''})`);
        const acts = element('div', '', 'actions'); acts.style.marginTop = 'var(--space-2)';
        const acc = button('Accept', async () => { try { await request(`/api/challenges/${item.challenge.id}/review-requests/${item.review.id}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'approve' }) }); li.remove(); if(!lst.children.length) document.getElementById('inbox-empty').hidden = false; } catch(e){ alert(e.message); } }); acc.style.background = 'green';
        const rej = button('Decline', async () => { try { await request(`/api/challenges/${item.challenge.id}/review-requests/${item.review.id}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'reject' }) }); li.remove(); if(!lst.children.length) document.getElementById('inbox-empty').hidden = false; } catch(e){ alert(e.message); } }); rej.style.background = 'red';
        acts.append(acc, rej);
        li.append(hdr, act, acts);
        lst.append(li);
      });
    } catch(err) { document.getElementById('inbox-empty').hidden = false; document.getElementById('inbox-empty').textContent = err.message; }
  };

  Auth.onReady(user => { if (user) load(); });
  window.addEventListener('auth:user-changed', () => { if (Auth.user) load(); });
})();