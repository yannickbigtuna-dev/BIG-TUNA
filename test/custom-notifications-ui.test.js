'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const page = fs.readFileSync(path.join(__dirname, '..', 'apps', 'admin', 'index.html'), 'utf8');

test('custom notifications section exists and provides compose, schedule, and recipient controls', () => {
  // Sidebar nav item
  assert.match(page, /data-view="notifications">Custom Notifications/);

  // Section id
  assert.match(page, /<section id="view-notifications" class="view-section hidden">/);

  // Compose card elements
  assert.match(page, /id="notif-recipient-select"/);
  assert.match(page, /id="notif-quick-recipients"/);
  assert.match(page, /data-username="fishyemma"/);
  assert.match(page, /id="notif-title-input"/);
  assert.match(page, /id="notif-body-input"/);

  // Scheduling options
  assert.match(page, /id="notif-radio-now"/);
  assert.match(page, /id="notif-radio-scheduled"/);
  assert.match(page, /id="notif-schedule-datetime"/);
  assert.match(page, /id="notif-quick-times"/);

  // Live iPhone lockscreen banner preview
  assert.match(page, /id="ios-preview-title"/);
  assert.match(page, /id="ios-preview-body"/);
  assert.match(page, /class="ios-banner"/);

  // History & Queue table
  assert.match(page, /id="notif-history-table"/);
  assert.match(page, /id="notif-history-tbody"/);
  assert.match(page, /id="notif-filter-chips"/);

  // API wiring in JS
  assert.match(page, /\/api\/admin\/custom-notifications\/recipients/);
  assert.match(page, /\/api\/admin\/custom-notifications/);
  assert.match(page, /loadCustomNotificationsView/);
});
