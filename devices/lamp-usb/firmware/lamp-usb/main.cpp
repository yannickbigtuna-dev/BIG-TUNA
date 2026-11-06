#include <Arduino.h>
// BIG TUNA lamp controller (USB, no Wi-Fi) + iPhone presence sensor.
//
// Stays plugged into the Mac mini. The Mac-side bridge (devices/lamp-usb/bridge.py)
// streams the lamp state from the local server and sends the PHYSICAL lamp state "lamp 0|1"
// over USB (the bridge undoes the server's inverted lamp value). Lamp ON = relay energized
// (GPIO26 LOW, active-low module), with the lamp on the relay's NO contact, so any power
// loss or reset leaves the lamp OFF.
// The last lamp state is kept in flash and applied first thing at boot, so a USB reset
// or power cycle comes back to the same state without waiting for the Mac.
//
// iPhones advertise over BLE with a "resolvable private address" that changes every ~15 min.
// After pairing once, the ESP32 holds the phone's Identity Resolving Key (IRK) and can
// recognize every one of those rotating addresses, then report its signal strength.
//
// Serial (115200) protocol, one JSON object per line:
//   {"type":"status","enrolled":bool,"enrolling":bool,"irk":"hex"|null}
//   {"type":"tick","rssi":avg|null,"n":matches,"adv":all_adverts}   once per second
//   {"type":"log","msg":"..."}
//   {"type":"enrolled","irk":"hex"}
//   {"type":"lamp","on":bool}      after every lamp command and at boot (physical lamp state)
// Commands in: lamp 0 | lamp 1 | enroll | cancel | forget | status

#include <NimBLEDevice.h>
#include <NimBLEHIDDevice.h>
#include <Preferences.h>
#include "mbedtls/aes.h"

static const char* DEVICE_NAME = "ESP32 Presence";
constexpr uint8_t LAMP_RELAY_PIN = 26;
constexpr bool LAMP_RELAY_ACTIVE_LOW = true;
bool lampOn = false;  // physical lamp state (true = lamp on = relay energized)

Preferences prefs;
uint8_t irk[16];
uint8_t idAddr[6];       // phone's fixed identity address (stack may report this once bonded)
bool haveId = false;
volatile bool dropBonds = false;
bool haveIrk = false;
volatile bool enrolling = false;
mbedtls_aes_context aesA, aesB;  // IRK as stored, and byte-reversed (endianness varies by source)

// Per-second accumulators, written from the BLE host task.
portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;
int32_t rssiSum = 0;
uint32_t rssiCount = 0, advCount = 0;

NimBLEServer* server;
NimBLEHIDDevice* hid;

// ---- helpers -------------------------------------------------------------

void applyLampRelay(bool on) {  // on = energize relay (active-low input)
  digitalWrite(LAMP_RELAY_PIN, on == LAMP_RELAY_ACTIVE_LOW ? LOW : HIGH);
}

String hex(const uint8_t* b, size_t n) {
  String s;
  char buf[3];
  for (size_t i = 0; i < n; i++) { sprintf(buf, "%02x", b[i]); s += buf; }
  return s;
}

void logMsg(const String& m) {
  String esc = m;
  esc.replace("\\", "\\\\");
  esc.replace("\"", "\\\"");
  Serial.printf("{\"type\":\"log\",\"msg\":\"%s\"}\n", esc.c_str());
}

void sendStatus() {
  Serial.printf("{\"type\":\"status\",\"enrolled\":%s,\"enrolling\":%s,\"irk\":%s}\n",
                haveIrk ? "true" : "false", enrolling ? "true" : "false",
                haveIrk ? ("\"" + hex(irk, 16) + "\"").c_str() : "null");
}

void loadKeys() {
  uint8_t rev[16];
  for (int i = 0; i < 16; i++) rev[i] = irk[15 - i];
  mbedtls_aes_setkey_enc(&aesA, irk, 128);
  mbedtls_aes_setkey_enc(&aesB, rev, 128);
}

// addr: NimBLE little-endian 6 bytes (val[5] is the most significant byte).
// RPA = prand (top 24 bits, starts with 0b01) || hash (low 24 bits), hash = AES(IRK, 0^104 || prand).
bool resolves(mbedtls_aes_context* ctx, const uint8_t* a) {
  uint8_t in[16] = {0}, out[16];
  in[13] = a[5]; in[14] = a[4]; in[15] = a[3];
  mbedtls_aes_crypt_ecb(ctx, MBEDTLS_AES_ENCRYPT, in, out);
  return out[13] == a[2] && out[14] == a[1] && out[15] == a[0];
}

bool isMyPhone(const NimBLEAddress& addr) {
  if (!haveIrk) return false;
  const uint8_t* a = addr.getVal();
  if (haveId && memcmp(a, idAddr, 6) == 0) return true;
  if (addr.getType() != BLE_ADDR_RANDOM) return false;
  if ((a[5] & 0xC0) != 0x40) return false;  // not a resolvable private address
  return resolves(&aesA, a) || resolves(&aesB, a);
}

// ---- scanning ------------------------------------------------------------

class ScanCB : public NimBLEScanCallbacks {
  void onResult(const NimBLEAdvertisedDevice* d) override {
    bool mine = isMyPhone(d->getAddress());
    portENTER_CRITICAL(&mux);
    advCount++;
    if (mine) { rssiSum += d->getRSSI(); rssiCount++; }
    portEXIT_CRITICAL(&mux);
  }
  void onScanEnd(const NimBLEScanResults&, int reason) override {
    NimBLEDevice::getScan()->start(0, false, true);  // keep scanning forever
  }
} scanCB;

// ---- pairing (enrollment) ------------------------------------------------

class ServerCB : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* s, NimBLEConnInfo& info) override {
    logMsg("Phone connected (" + String(info.getAddress().toString().c_str()) + "), pairing...");
    NimBLEDevice::startSecurity(info.getConnHandle());
  }
  void onDisconnect(NimBLEServer* s, NimBLEConnInfo& info, int reason) override {
    logMsg("Phone disconnected (reason " + String(reason) + ")");
    if (enrolling) NimBLEDevice::startAdvertising();
  }
  void onAuthenticationComplete(NimBLEConnInfo& info) override {
    if (!info.isEncrypted()) {
      logMsg("Pairing failed. If 'ESP32 Presence' is under My Devices on the iPhone, Forget it and retry.");
      return;
    }
    ble_store_key_sec key = {};
    ble_store_value_sec val = {};
    key.peer_addr = *info.getIdAddress().getBase();
    if (ble_store_read_peer_sec(&key, &val) != 0 || !val.irk_present) {
      logMsg("Paired, but the phone did not share an IRK.");
      return;
    }
    memcpy(irk, val.irk, 16);
    haveIrk = true;
    loadKeys();
    prefs.putBytes("irk", irk, 16);
    memcpy(idAddr, info.getIdAddress().getVal(), 6);
    haveId = true;
    prefs.putBytes("id", idAddr, 6);
    dropBonds = true;  // delete the bond after disconnect so the stack stops auto-resolving

    // Self-test: the address the phone connected with should resolve with this key.
    NimBLEAddress ota = info.getAddress();
    const uint8_t* a = ota.getVal();
    String test = (a[5] & 0xC0) != 0x40 ? "phone used a non-RPA address, skipped self-test"
                : resolves(&aesA, a) ? "self-test OK (key order A)"
                : resolves(&aesB, a) ? "self-test OK (key order B)"
                                     : "self-test FAILED: address did not resolve";
    logMsg("Got IRK from " + String(ota.toString().c_str()) + ": " + test);
    Serial.printf("{\"type\":\"enrolled\",\"irk\":\"%s\"}\n", hex(irk, 16).c_str());

    stopEnroll();
    NimBLEDevice::getServer()->disconnect(info.getConnHandle());
  }

 public:
  void stopEnroll() {
    enrolling = false;
    NimBLEDevice::stopAdvertising();
    sendStatus();
  }
} serverCB;

void startEnroll() {
  enrolling = true;
  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->reset();
  adv->setName(DEVICE_NAME);
  adv->setAppearance(0x03C1);  // HID keyboard, so it shows in iOS Settings > Bluetooth
  adv->addServiceUUID(hid->getHidService()->getUUID());
  adv->enableScanResponse(true);
  NimBLEDevice::startAdvertising();
  logMsg("Pairing mode on: iPhone Settings > Bluetooth > tap 'ESP32 Presence'");
  sendStatus();
}

// ---- setup / loop --------------------------------------------------------

// Minimal keyboard report map: iOS only needs a valid HID service to offer pairing.
static uint8_t reportMap[] = {
  0x05, 0x01, 0x09, 0x06, 0xA1, 0x01, 0x85, 0x01, 0x05, 0x07, 0x19, 0xE0, 0x29, 0xE7,
  0x15, 0x00, 0x25, 0x01, 0x75, 0x01, 0x95, 0x08, 0x81, 0x02, 0x95, 0x01, 0x75, 0x08,
  0x81, 0x01, 0x95, 0x06, 0x75, 0x08, 0x15, 0x00, 0x25, 0x65, 0x05, 0x07, 0x19, 0x00,
  0x29, 0x65, 0x81, 0x00, 0xC0,
};

void setup() {
  // Relay first, before anything slow: restore the last commanded lamp state.
  Preferences lampPrefs;
  lampPrefs.begin("lamp", true);
  lampOn = lampPrefs.getBool("on", false);
  lampPrefs.end();
  applyLampRelay(lampOn);
  pinMode(LAMP_RELAY_PIN, OUTPUT);
  applyLampRelay(lampOn);

  Serial.begin(115200);
  delay(200);

  mbedtls_aes_init(&aesA);
  mbedtls_aes_init(&aesB);
  prefs.begin("presence", false);
  if (prefs.getBytesLength("irk") == 16) {
    prefs.getBytes("irk", irk, 16);
    if (prefs.getBytesLength("id") == 6) { prefs.getBytes("id", idAddr, 6); haveId = true; }
    haveIrk = true;
    loadKeys();
  }

  NimBLEDevice::init(DEVICE_NAME);
  NimBLEDevice::setSecurityAuth(true, false, true);  // bonding, no MITM, secure connections
  NimBLEDevice::setSecurityIOCap(BLE_HS_IO_NO_INPUT_OUTPUT);
  // Bonds are only needed during pairing; a leftover bond makes the stack hide the phone's RPAs.
  if (haveIrk) NimBLEDevice::deleteAllBonds();
  NimBLEDevice::setSecurityInitKey(BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID);
  NimBLEDevice::setSecurityRespKey(BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID);

  server = NimBLEDevice::createServer();
  server->setCallbacks(&serverCB);
  server->advertiseOnDisconnect(false);
  hid = new NimBLEHIDDevice(server);
  hid->setManufacturer("BigTuna");
  hid->setPnp(0x02, 0xe502, 0xa111, 0x0210);
  hid->setHidInfo(0x00, 0x01);
  hid->setReportMap(reportMap, sizeof(reportMap));
  hid->getInputReport(1);
  hid->setBatteryLevel(100);
  server->start();

  NimBLEScan* scan = NimBLEDevice::getScan();
  scan->setScanCallbacks(&scanCB, true);  // want duplicates: every advert = an RSSI sample
  scan->setActiveScan(false);
  scan->setInterval(100);
  scan->setWindow(90);
  scan->setMaxResults(0);  // don't store results, callback only
  scan->start(0, false, true);

  logMsg(String("Booted. ") + (haveIrk ? "Phone key loaded, scanning." : "No phone paired yet."));
  sendStatus();
  Serial.printf("{\"type\":\"lamp\",\"on\":%s}\n", lampOn ? "true" : "false");
}

void setLamp(bool on) {
  if (on != lampOn) {
    lampOn = on;
    applyLampRelay(on);
    Preferences lampPrefs;
    lampPrefs.begin("lamp", false);
    lampPrefs.putBool("on", on);
    lampPrefs.end();
  }
  Serial.printf("{\"type\":\"lamp\",\"on\":%s}\n", lampOn ? "true" : "false");
}

String cmdBuf;
uint32_t lastTick = 0;

void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      cmdBuf.trim();
      if (cmdBuf == "lamp 1") setLamp(true);
      else if (cmdBuf == "lamp 0") setLamp(false);
      else if (cmdBuf == "enroll") startEnroll();
      else if (cmdBuf == "cancel") { serverCB.stopEnroll(); logMsg("Pairing cancelled"); }
      else if (cmdBuf == "forget") {
        prefs.remove("irk");
        prefs.remove("id");
        haveId = false;
        haveIrk = false;
        NimBLEDevice::deleteAllBonds();
        logMsg("Phone forgotten. Also Forget 'ESP32 Presence' on the iPhone before pairing again.");
        sendStatus();
      } else if (cmdBuf == "status") {
        sendStatus();
        Serial.printf("{\"type\":\"lamp\",\"on\":%s}\n", lampOn ? "true" : "false");
      }
      cmdBuf = "";
    } else if (cmdBuf.length() < 32) cmdBuf += c;
  }

  if (dropBonds && server->getConnectedCount() == 0) {
    dropBonds = false;
    NimBLEDevice::deleteAllBonds();
    logMsg("Bond cleared, now tracking by IRK");
  }

  if (millis() - lastTick >= 1000) {
    lastTick = millis();
    portENTER_CRITICAL(&mux);
    int32_t sum = rssiSum; uint32_t n = rssiCount, adv = advCount;
    rssiSum = 0; rssiCount = 0; advCount = 0;
    portEXIT_CRITICAL(&mux);
    if (n) Serial.printf("{\"type\":\"tick\",\"rssi\":%.1f,\"n\":%u,\"adv\":%u}\n", (float)sum / n, n, adv);
    else Serial.printf("{\"type\":\"tick\",\"rssi\":null,\"n\":0,\"adv\":%u}\n", adv);
  }
  delay(10);
}
