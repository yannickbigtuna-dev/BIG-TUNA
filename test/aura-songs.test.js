'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classify, sameSong, norm } = require('../lib/aura-songs');

test('classify recognises each service and rejects the rest', () => {
  assert.deepEqual(classify(new URL('https://open.spotify.com/intl-fr/track/4cOdK2wGLETKBW3PvgPWqT?si=x')), { service: 'spotify', id: '4cOdK2wGLETKBW3PvgPWqT' });
  assert.deepEqual(classify(new URL('https://music.youtube.com/watch?v=lYBUbBu4W08&si=x')), { service: 'youtubeMusic', id: 'lYBUbBu4W08' });
  assert.deepEqual(classify(new URL('https://youtu.be/dQw4w9WgXcQ')), { service: 'youtubeMusic', id: 'dQw4w9WgXcQ' });
  assert.deepEqual(classify(new URL('https://music.apple.com/ca/album/x/1624945511?i=1624945512')), { service: 'appleMusic', id: '1624945512' });
  assert.equal(classify(new URL('https://spotify.link/abc')).service, 'shortlink');
  assert.throws(() => classify(new URL('https://open.spotify.com/album/4cOdK2wGLETKBW3PvgPWqT')), /single Spotify song/);
  assert.throws(() => classify(new URL('https://music.youtube.com/playlist?list=PL1')), /single YouTube/);
  assert.throws(() => classify(new URL('https://example.com/x')), /Spotify, YouTube Music or Apple Music/);
});

test('sameSong ignores remaster/feature noise but not different songs', () => {
  assert.ok(sameSong({ title: 'Never Gonna Give You Up (2022 Remaster)', artist: 'Rick Astley' }, { title: 'Never Gonna Give You Up', artist: 'Rick Astley' }));
  assert.ok(sameSong({ title: 'Song - Remastered 2011', artist: 'The Beatles' }, { title: 'Song', artist: 'Beatles' }));
  assert.ok(!sameSong({ title: 'Never Give You Up', artist: 'Jerry Butler' }, { title: 'Never Gonna Give You Up', artist: 'Rick Astley' }));
  assert.ok(!sameSong({ title: 'Not Gonna Give It Up', artist: 'Peter Tosh' }, { title: 'Never Gonna Give You Up', artist: 'Rick Astley' }));
  assert.equal(norm('Hey (feat. X) [Live]'), 'hey');
});
