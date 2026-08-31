'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { resolveHomeKitBindAddress } = require('../server');

test('HomeKit bind address uses a valid explicit IPv4 override', () => {
  const bind = resolveHomeKitBindAddress({
    HOMEKIT_BIND_ADDRESS: ' 192.168.2.93 ',
    HOMEKIT_BIND_INTERFACE: 'Wi-Fi',
  }, () => {
    throw new Error('network adapters should not be consulted for an explicit address');
  });

  assert.equal(bind, '192.168.2.93');
});

test('HomeKit bind address selects the first non-internal IPv4 on the configured adapter', () => {
  const bind = resolveHomeKitBindAddress({ HOMEKIT_BIND_INTERFACE: 'BELL198' }, () => ({
    BELL198: [
      { address: 'fe80::1234', family: 'IPv6', internal: false },
      { address: '127.0.0.1', family: 'IPv4', internal: true },
      { address: '192.168.2.93', family: 'IPv4', internal: false },
    ],
    Tailscale: [{ address: '100.64.0.1', family: 'IPv4', internal: false }],
  }));

  assert.equal(bind, '192.168.2.93');
});

test('HomeKit bind address falls back to the interface name when no IPv4 is available', () => {
  assert.equal(
    resolveHomeKitBindAddress({ HOMEKIT_BIND_ADDRESS: 'not-an-ip', HOMEKIT_BIND_INTERFACE: 'Wi-Fi' }, () => ({
      'Wi-Fi': [{ address: 'fe80::1234', family: 'IPv6', internal: false }],
    })),
    'Wi-Fi',
  );
});
