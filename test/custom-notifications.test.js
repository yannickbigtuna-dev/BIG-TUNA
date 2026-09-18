'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

test('custom notifications admin endpoints, validation, immediate send, and scheduling', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'big-tuna-cnotif-test-'));
  const previousDataDir = process.env.BIG_TUNA_DATA_DIR;
  process.env.BIG_TUNA_DATA_DIR = dataDir;

  const { server, _test } = require('../server');
  const OWNER_TOKEN = 'test-owner-token';
  const OTHER_TOKEN = 'test-other-token';

  const expiresAt = new Date(Date.now() + 120_000).toISOString();
  fs.writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify([
    { id: 'yannick-id', username: 'yannick', email: 'yannick@example.com' },
    { id: 'emma-id', username: 'fishyemma', email: 'emma@example.com' },
    { id: 'other-id', username: 'otheruser', email: 'other@example.com' }
  ], null, 2));
  fs.writeFileSync(path.join(dataDir, 'sessions.json'), JSON.stringify([
    { token: OWNER_TOKEN, userId: 'yannick-id', expiresAt },
    { token: OTHER_TOKEN, userId: 'other-id', expiresAt }
  ], null, 2));

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  function apiReq(method, pathname, { token = OWNER_TOKEN, body } = {}) {
    return new Promise((resolve, reject) => {
      const payload = body !== undefined ? JSON.stringify(body) : null;
      const req = http.request(new URL(pathname, baseUrl), {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {})
        }
      }, res => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { text += chunk; });
        res.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(text); } catch {}
          resolve({ status: res.statusCode, body: parsed, raw: text });
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  try {
    // 1. Authentication guards
    const unauth = await apiReq('GET', '/api/admin/custom-notifications', { token: null });
    assert.equal(unauth.status, 401);

    const forbidden = await apiReq('GET', '/api/admin/custom-notifications', { token: OTHER_TOKEN });
    assert.equal(forbidden.status, 403);

    // 2. GET /api/admin/custom-notifications/recipients
    const recipientsRes = await apiReq('GET', '/api/admin/custom-notifications/recipients');
    assert.equal(recipientsRes.status, 200);
    assert.ok(Array.isArray(recipientsRes.body.recipients));
    // fishyemma must be present and at the top
    assert.equal(recipientsRes.body.recipients[0].username, 'fishyemma');
    assert.equal(recipientsRes.body.recipients[1].username, 'yannick');

    // 3. Validation errors on POST
    const missingUser = await apiReq('POST', '/api/admin/custom-notifications', { body: { title: 'T', body: 'B' } });
    assert.equal(missingUser.status, 400);

    const missingTitle = await apiReq('POST', '/api/admin/custom-notifications', { body: { recipientUsername: 'fishyemma', body: 'B' } });
    assert.equal(missingTitle.status, 400);

    const missingContent = await apiReq('POST', '/api/admin/custom-notifications', { body: { recipientUsername: 'fishyemma', title: 'T' } });
    assert.equal(missingContent.status, 400);

    // 4. Immediate delivery to fishyemma
    const sendRes = await apiReq('POST', '/api/admin/custom-notifications', {
      body: {
        recipientUsername: 'fishyemma',
        title: 'Workout Time!',
        body: 'Yannick just logged 5km. Deploy running shoes! 🏃‍♀️'
      }
    });
    assert.equal(sendRes.status, 201);
    assert.equal(sendRes.body.ok, true);
    assert.equal(sendRes.body.scheduled, false);
    assert.equal(sendRes.body.notification.title, 'Workout Time!');
    assert.equal(sendRes.body.notification.recipientUsername, 'fishyemma');
    assert.equal(sendRes.body.notification.status, 'sent');
    assert.ok(sendRes.body.notification.sentAt);

    // 5. Schedule future delivery
    const futureDate = new Date(Date.now() + 3600_000).toISOString();
    const schedRes = await apiReq('POST', '/api/admin/custom-notifications', {
      body: {
        recipientUsername: 'fishyemma',
        title: 'Scheduled Evening Reminder',
        body: 'Time for evening stretch!',
        scheduledFor: futureDate
      }
    });
    assert.equal(schedRes.status, 201);
    assert.equal(schedRes.body.ok, true);
    assert.equal(schedRes.body.scheduled, true);
    assert.equal(schedRes.body.notification.status, 'scheduled');
    assert.equal(schedRes.body.notification.scheduledFor, futureDate);
    assert.equal(_test.customNotificationDueState({ status: 'scheduled', scheduledFor: new Date(Date.now() - 14 * 60_000).toISOString() }), 'due');
    assert.equal(_test.customNotificationDueState({ status: 'scheduled', scheduledFor: new Date(Date.now() - 16 * 60_000).toISOString() }), 'missed');
    const scheduledFile = path.join(dataDir, 'custom-notifications.json');
    const scheduledRecords = JSON.parse(fs.readFileSync(scheduledFile, 'utf8'));
    scheduledRecords.find(item => item.id === schedRes.body.notification.id).scheduledFor = new Date(Date.now() - 60_000).toISOString();
    fs.writeFileSync(scheduledFile, JSON.stringify(scheduledRecords, null, 2));
    let dispatches = 0;
    const deliver = async item => { dispatches++; await new Promise(resolve => setTimeout(resolve, 10)); item.status = 'sent'; };
    await Promise.all([_test.processScheduledCustomNotifications({ deliver }), _test.processScheduledCustomNotifications({ deliver })]);
    assert.equal(dispatches, 1);
    assert.equal(JSON.parse(fs.readFileSync(scheduledFile, 'utf8')).find(item => item.id === schedRes.body.notification.id).status, 'sent');

    // 6. List custom notifications
    const listRes = await apiReq('GET', '/api/admin/custom-notifications');
    assert.equal(listRes.status, 200);
    assert.equal(listRes.body.notifications.length, 2);

    // 7. Resend notification immediately
    const resendRes = await apiReq('POST', `/api/admin/custom-notifications/${schedRes.body.notification.id}/resend`);
    assert.equal(resendRes.status, 200);
    assert.equal(resendRes.body.ok, true);
    assert.equal(resendRes.body.notification.status, 'sent');

    // 8. Delete notification
    const deleteRes = await apiReq('DELETE', `/api/admin/custom-notifications/${sendRes.body.notification.id}`);
    assert.equal(deleteRes.status, 200);
    assert.equal(deleteRes.body.ok, true);
    assert.equal(deleteRes.body.deleted, true);

    const listAfterDelete = await apiReq('GET', '/api/admin/custom-notifications');
    assert.equal(listAfterDelete.body.notifications.length, 1);
  } finally {
    server.close();
    if (previousDataDir === undefined) delete process.env.BIG_TUNA_DATA_DIR;
    else process.env.BIG_TUNA_DATA_DIR = previousDataDir;
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }
});
