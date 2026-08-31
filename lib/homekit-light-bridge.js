'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ACCESSORY_NAME = 'BIG TUNA Lights';
const SETUP_ID = 'BTNA';
const PORT = 51826;
const CONFIG_FILE = 'homekit-bridge.json';

function atomicWrite(filePath, value) {
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2));
  fs.renameSync(temporaryPath, filePath);
}

function isValidPin(code) {
  return /^\d{3}-\d{2}-\d{3}$/.test(code)
    && !/^(\d)\1\1-\1\1-\1\1\1$/.test(code)
    && code !== '123-45-678';
}

function createSetupCode() {
  // HomeKit requires an eight-digit code in 3-2-3 form. Rejection avoids the
  // trivial codes which HAP-NodeJS (and HomeKit) refuse.
  for (;;) {
    const digits = crypto.randomInt(0, 100000000).toString().padStart(8, '0');
    const code = `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
    if (isValidPin(code)) return code;
  }
}

function createUsername() {
  const bytes = crypto.randomBytes(6);
  bytes[0] = (bytes[0] & 0xfe) | 0x02; // locally administered, unicast MAC
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0').toUpperCase()).join(':');
}

function loadOrCreateConfig(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const configPath = path.join(dataDir, CONFIG_FILE);
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (parsed && isValidPin(parsed.setupCode) && /^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/.test(parsed.username || '')) {
      return { configPath, setupCode: parsed.setupCode, username: parsed.username };
    }
  } catch {}

  const config = { setupCode: createSetupCode(), username: createUsername() };
  atomicWrite(configPath, config);
  return { configPath, ...config };
}

function createHomeKitLightBridge({ dataDir, readOn, writeOn, hap, logger = console }) {
  if (!dataDir || typeof readOn !== 'function' || typeof writeOn !== 'function') {
    throw new Error('HomeKit bridge requires dataDir, readOn, and writeOn callbacks');
  }

  const config = loadOrCreateConfig(dataDir);
  const library = hap || require('hap-nodejs');
  let accessory;
  let onCharacteristic;
  let started = false;

  function isPaired() {
    if (!accessory) return false;
    if (typeof accessory.paired === 'function') return accessory.paired(); // test adapter compatibility
    return !!(accessory._accessoryInfo && typeof accessory._accessoryInfo.paired === 'function'
      && accessory._accessoryInfo.paired());
  }

  function getPairingInfo() {
    return {
      available: started,
      paired: isPaired(),
      name: ACCESSORY_NAME,
      setupCode: isPaired() ? undefined : config.setupCode,
    };
  }

  async function start() {
    if (started) return getPairingInfo();
    if (library.HAPStorage && typeof library.HAPStorage.setCustomStoragePath === 'function') {
      library.HAPStorage.setCustomStoragePath(dataDir);
    }

    accessory = new library.Accessory(ACCESSORY_NAME, library.uuid.generate('big-tuna-lights-homekit'));
    const service = accessory.addService(library.Service.Lightbulb, ACCESSORY_NAME);
    onCharacteristic = service.getCharacteristic(library.Characteristic.On);
    onCharacteristic.onGet(async () => (await readOn()) === true);
    onCharacteristic.onSet(async value => {
      const desiredOn = value === true || value === 1;
      await writeOn(desiredOn);
    });

    await accessory.publish({
      username: config.username,
      pincode: config.setupCode,
      port: PORT,
      category: library.Categories.LIGHTBULB,
      setupID: SETUP_ID,
      addIdentifyingMaterial: false,
    });
    started = true;
    onCharacteristic.updateValue((await readOn()) === true);
    return getPairingInfo();
  }

  function update(on) {
    if (started && onCharacteristic) onCharacteristic.updateValue(on === true);
  }

  return Object.freeze({ start, update, getPairingInfo, configPath: config.configPath });
}

module.exports = { ACCESSORY_NAME, CONFIG_FILE, PORT, SETUP_ID, createHomeKitLightBridge, createSetupCode, isValidPin, loadOrCreateConfig };
