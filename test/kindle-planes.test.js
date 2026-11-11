'use strict';
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const { createKindlePlanes, toGreyscalePng, distanceBearing } = require('../lib/kindle-planes');

function rgbPng(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(pixel, y * (w * 3 + 1) + 1 + x * 3);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('converts RGB PNG to 8-bit greyscale snapped to 16 levels', () => {
  const out = toGreyscalePng(rgbPng(4, 3, [255, 255, 255]));
  assert.strictEqual(out[25], 0); // colour type greyscale
  assert.strictEqual(out.readUInt32BE(16), 4);
  const len = out.readUInt32BE(33);
  const pixels = zlib.inflateSync(out.subarray(41, 41 + len));
  assert.strictEqual(pixels.length, 15);
  assert.strictEqual(pixels[1], 255);
});

test('distance and bearing', () => {
  const { dist, bearing } = distanceBearing(44, -63, 45, -63);
  assert.ok(Math.abs(dist - 60) < 0.5);
  assert.ok(bearing < 0.01 || bearing > 359.99);
});

test('LAN requests are allowed, tunnel requests need the key', () => {
  process.env.KINDLE_PLANES_KEY = 'secret-key';
  const { _test } = createKindlePlanes();
  const q = s => new URLSearchParams(s);
  assert.ok(_test.authorized({ headers: {}, socket: { remoteAddress: '::ffff:192.168.2.50' } }, q('')));
  assert.ok(!_test.authorized({ headers: { 'cf-connecting-ip': '8.8.8.8' }, socket: { remoteAddress: '127.0.0.1' } }, q('')));
  assert.ok(!_test.authorized({ headers: { 'cf-connecting-ip': '8.8.8.8' }, socket: { remoteAddress: '127.0.0.1' } }, q('key=wrong')));
  assert.ok(_test.authorized({ headers: { 'cf-connecting-ip': '8.8.8.8' }, socket: { remoteAddress: '127.0.0.1' } }, q('key=secret-key')));
  assert.ok(!_test.authorized({ headers: {}, socket: { remoteAddress: '8.8.8.8' } }, q('')));
});
