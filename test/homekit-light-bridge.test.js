'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const { createHomeKitLightBridge, loadOrCreateConfig } = require('../lib/homekit-light-bridge');

const temporaryDirs = [];
afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function temporaryDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'big-tuna-homekit-'));
  temporaryDirs.push(dir);
  return dir;
}

function fakeHap() {
  const state = { characteristic: null, published: null, storagePath: null };
  class Characteristic {
    onGet(handler) { this.get = handler; return this; }
    onSet(handler) { this.set = handler; return this; }
    updateValue(value) { this.value = value; return this; }
  }
  class Accessory {
    constructor() { this.isPaired = false; state.accessory = this; }
    addService() { return { getCharacteristic: () => (state.characteristic = new Characteristic()) }; }
    async publish(info) { state.published = info; }
    paired() { return this.isPaired; }
    setupURI() { return 'X-HM://0023ISYWYBTNA'; }
  }
  return {
    Accessory,
    Service: { Lightbulb: 'lightbulb' },
    Characteristic: { On: 'on' },
    Categories: { LIGHTBULB: 5 },
    MDNSAdvertiser: { CIAO: 'ciao' },
    HAPStorage: { setCustomStoragePath(value) { state.storagePath = value; } },
    uuid: { generate(value) { return value; } },
    state,
  };
}

test('HomeKit On maps directly to physical ON and reads current physical state', async () => {
  const hap = fakeHap();
  let physicalOn = false;
  const bridge = createHomeKitLightBridge({
    dataDir: temporaryDir(), hap, bind: '192.168.2.10',
    readOn: () => physicalOn,
    writeOn: value => { physicalOn = value; },
  });
  assert.equal(bridge.getPairingInfo().setupUri, undefined);
  await bridge.start();
  assert.equal(await hap.state.characteristic.get(), false);
  await hap.state.characteristic.set(true);
  assert.equal(physicalOn, true);
  assert.equal(hap.state.published.port, 51826);
  assert.deepEqual(hap.state.published.bind, ['0.0.0.0', '192.168.2.10']);
  assert.equal(hap.state.published.advertiser, 'ciao');
  assert.equal(hap.state.published.setupID, 'BTNA');
  assert.deepEqual(bridge.getPairingInfo(), {
    available: true,
    paired: false,
    name: 'BIG TUNA Lights',
    setupCode: hap.state.published.pincode,
    setupUri: 'X-HM://0023ISYWYBTNA',
  });
  hap.state.accessory.isPaired = true;
  assert.deepEqual(bridge.getPairingInfo(), {
    available: true,
    paired: true,
    name: 'BIG TUNA Lights',
  });
});

test('external physical state changes update the HomeKit characteristic', async () => {
  const hap = fakeHap();
  const bridge = createHomeKitLightBridge({
    dataDir: temporaryDir(), hap, bind: ['192.168.2.10', 'Wi-Fi'], readOn: () => false, writeOn: () => {},
  });
  await bridge.start();
  assert.deepEqual(hap.state.published.bind, ['192.168.2.10', 'Wi-Fi']);
  bridge.update(true);
  assert.equal(hap.state.characteristic.value, true);
  bridge.update(false);
  assert.equal(hap.state.characteristic.value, false);
});

test('non-IPv4 interface bind remains unchanged', async () => {
  const hap = fakeHap();
  const bridge = createHomeKitLightBridge({
    dataDir: temporaryDir(), hap, bind: 'Wi-Fi', readOn: () => false, writeOn: () => {},
  });
  await bridge.start();
  assert.equal(hap.state.published.bind, 'Wi-Fi');
});

test('pairing secret is created once and remains stable', () => {
  const dataDir = temporaryDir();
  const first = loadOrCreateConfig(dataDir);
  const second = loadOrCreateConfig(dataDir);
  assert.equal(first.setupCode, second.setupCode);
  assert.equal(first.username, second.username);
  assert.match(first.setupCode, /^\d{3}-\d{2}-\d{3}$/);
});

test('HomeKit bridge requires a nonempty bind interface or address', () => {
  const requiredOptions = {
    dataDir: temporaryDir(),
    readOn: () => false,
    writeOn: () => {},
  };
  for (const bind of [undefined, null, '', '   ', [], ['192.168.2.10', ''], [51826]]) {
    assert.throws(
      () => createHomeKitLightBridge({ ...requiredOptions, bind }),
      /requires a nonempty bind interface or address/,
    );
  }
});
