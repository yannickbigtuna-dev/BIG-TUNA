'use strict';

// Song-link resolver for AURA's boombox. Takes a Spotify / YouTube Music /
// Apple Music link and returns the song's metadata plus the matching link on
// every service, so a partner on a different app gets a link their app opens.
//
// No API keys are required: Spotify's public page tags, YouTube's oEmbed and
// the YouTube Music search endpoint, and the iTunes Search API. If
// SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET are set, Spotify search is used
// to find exact Spotify tracks for songs shared from other services;
// otherwise those get a Spotify search link instead.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const YTM_CONTEXT = { client: { clientName: 'WEB_REMIX', clientVersion: '1.20240101.01.00', hl: 'en', gl: 'CA' } };
const YTM_SONGS_FILTER = 'EgWKAQIIAWoKEAoQCRADEAQQBQ%3D%3D';
const TIMEOUT = 8000;
const CACHE_TTL = 6 * 3600_000;
const CACHE_MAX = 500;

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const YT_ID = /^[A-Za-z0-9_-]{11}$/;

class SongError extends Error {
  constructor(message) { super(message); this.status = 400; }
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

function metaTag(html, prop) {
  const m = html.match(new RegExp(`<meta[^>]+(?:property|name)="${prop}"[^>]+content="([^"]*)"`, 'i'))
    || html.match(new RegExp(`<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="${prop}"`, 'i'));
  return m ? decodeEntities(m[1]) : '';
}

// Title/artist normalisation for comparing the same song across services.
function norm(s) {
  return String(s || '').toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b(feat|ft|featuring)\b.*$/, ' ')
    .replace(/\s[-–—]\s.*(remaster|version|edit|mix|live|mono|stereo).*$/, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
// Versions that make it a different recording: a remix must not match the original.
const VERSION_RE = /\b(remix|live|acoustic|instrumental|karaoke|cover|slowed|sped up|nightcore|demo)\b/g;
const versions = s => [...new Set(String(s || '').toLowerCase().match(VERSION_RE) || [])].sort().join(',');

function sameSong(a, b) {
  if (versions(a.title) !== versions(b.title)) return false;
  const t1 = norm(a.title), t2 = norm(b.title);
  if (!t1 || !t2 || !(t1 === t2 || t1.includes(t2) || t2.includes(t1))) return false;
  const a1 = norm(a.artist), a2 = norm(b.artist);
  if (!a1 || !a2) return true;
  const first = x => x.split(' ')[0];
  return a1.includes(a2) || a2.includes(a1) || first(a1) === first(a2);
}

function parseUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { throw new SongError('That is not a link'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new SongError('That is not a link');
  return u;
}

// → { service: 'spotify'|'youtubeMusic'|'appleMusic'|'shortlink', id }
function classify(u) {
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'open.spotify.com' || host === 'play.spotify.com') {
    const m = u.pathname.match(/\/track\/([A-Za-z0-9]{22})/);
    if (m) return { service: 'spotify', id: m[1] };
    throw new SongError('Share a single Spotify song, not an album or playlist');
  }
  if (host === 'spotify.link' || host === 'spotify.app.link') return { service: 'shortlink' };
  if (host === 'music.youtube.com' || host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be') {
    const id = host === 'youtu.be' ? u.pathname.slice(1) : u.searchParams.get('v');
    if (id && YT_ID.test(id)) return { service: 'youtubeMusic', id };
    throw new SongError('Share a single YouTube Music song, not a playlist');
  }
  if (host === 'music.apple.com' || host === 'itunes.apple.com') {
    const id = u.searchParams.get('i') || (u.pathname.match(/\/song\/[^/]*\/(\d+)/) || [])[1];
    if (id && /^\d+$/.test(id)) return { service: 'appleMusic', id };
    throw new SongError('Share a single Apple Music song, not an album');
  }
  throw new SongError('Share a link from Spotify, YouTube Music or Apple Music');
}

function createSongResolver({ fetchImpl = globalThis.fetch, env = process.env, now = () => Date.now() } = {}) {
  const cache = new Map();
  let spotifyToken = null;

  async function get(url, opts = {}) {
    const res = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT), ...opts, headers: { 'User-Agent': UA, ...(opts.headers || {}) } });
    return res;
  }
  async function getJson(url, opts) {
    const res = await get(url, opts);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
  }

  // ── sources ───────────────────────────────────────────────────────────
  async function fromSpotify(id) {
    // Spotify only serves its tag-rich page to a bare UA.
    const res = await get(`https://open.spotify.com/track/${id}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new SongError('Could not read that Spotify song');
    const html = await res.text();
    const title = metaTag(html, 'og:title');
    if (!title) throw new SongError('Could not read that Spotify song');
    const desc = metaTag(html, 'og:description').split(' · ');
    return { title, artist: desc[0] || '', album: desc[1] && desc[1] !== 'Song' ? desc[1] : '', artUrl: metaTag(html, 'og:image'), spotifyId: id };
  }
  async function fromYouTube(id) {
    const o = await getJson(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://music.youtube.com/watch?v=${id}`)}&format=json`).catch(() => null);
    if (!o || !o.title) throw new SongError('Could not read that YouTube song');
    let title = decodeEntities(o.title);
    let artist = decodeEntities(o.author_name || '').replace(/ - Topic$/, '').replace(/VEVO$/i, '');
    // "Artist - Song (Official Video)" style titles from regular uploads.
    const dash = title.match(/^(.+?)\s[-–]\s(.+)$/);
    if (dash && !/ - Topic$/.test(o.author_name || '')) { artist = dash[1]; title = dash[2]; }
    title = title.replace(/\s*[(\[](official|lyric|music video|audio|video|hd|hq)[^)\]]*[)\]]/gi, '').trim();
    return { title, artist, album: '', artUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, youtubeId: id };
  }
  async function fromApple(id) {
    const j = await getJson(`https://itunes.apple.com/lookup?id=${id}&entity=song`).catch(() => null);
    const t = j && j.results && j.results.find(r => r.kind === 'song');
    if (!t) throw new SongError('Could not read that Apple Music song');
    return appleMeta(t);
  }
  const appleMeta = t => ({
    title: t.trackName, artist: t.artistName, album: t.collectionName || '',
    artUrl: (t.artworkUrl100 || '').replace(/\/\d+x\d+bb\./, '/640x640bb.'),
    appleUrl: (t.trackViewUrl || '').replace(/&uo=\d+$/, '').replace(/\?uo=\d+&/, '?'),
    isrc: undefined,
  });

  // ── targets ───────────────────────────────────────────────────────────
  async function findApple(meta) {
    const j = await getJson(`https://itunes.apple.com/search?term=${encodeURIComponent(`${meta.title} ${meta.artist}`)}&entity=song&limit=8&country=CA`).catch(() => null);
    const hit = j && (j.results || []).filter(r => r.kind === 'song').map(appleMeta).find(c => sameSong(c, meta));
    return hit || null;
  }
  async function findYouTube(meta) {
    const j = await getJson('https://music.youtube.com/youtubei/v1/search?prettyPrint=false', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://music.youtube.com' },
      body: JSON.stringify({ context: YTM_CONTEXT, query: `${meta.title} ${meta.artist}`, params: decodeURIComponent(YTM_SONGS_FILTER) }),
    }).catch(() => null);
    const found = [];
    (function walk(o) {
      if (!o || typeof o !== 'object') return;
      const r = o.musicResponsiveListItemRenderer;
      if (r && r.playlistItemData && r.playlistItemData.videoId) {
        const text = c => ((c && c.musicResponsiveListItemFlexColumnRenderer.text.runs) || []).map(x => x.text).join('');
        const cols = (r.flexColumns || []).map(text);
        found.push({ videoId: r.playlistItemData.videoId, title: cols[0] || '', artist: (cols[1] || '').split(' • ')[0] });
      }
      for (const k in o) walk(o[k]);
    })(j);
    const hit = found.slice(0, 8).find(c => sameSong(c, meta));
    return hit ? hit.videoId : null;
  }
  async function spotifyAccess() {
    if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) return null;
    if (spotifyToken && spotifyToken.exp > now() + 60_000) return spotifyToken.value;
    const basic = Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString('base64');
    const j = await getJson('https://accounts.spotify.com/api/token', {
      method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials',
    }).catch(() => null);
    if (!j || !j.access_token) return null;
    spotifyToken = { value: j.access_token, exp: now() + (j.expires_in || 3600) * 1000 };
    return spotifyToken.value;
  }
  async function findSpotify(meta) {
    const token = await spotifyAccess();
    if (!token) return null;
    const j = await getJson(`https://api.spotify.com/v1/search?type=track&limit=8&q=${encodeURIComponent(`track:${meta.title} artist:${meta.artist}`)}`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
    const items = (j && j.tracks && j.tracks.items) || [];
    const hit = items.find(t => sameSong({ title: t.name, artist: (t.artists[0] || {}).name }, meta));
    return hit ? hit.id : null;
  }

  async function resolveUncached(raw) {
    let u = parseUrl(raw);
    let kind = classify(u);
    if (kind.service === 'shortlink') {
      const res = await get(u.toString());
      u = new URL(res.url);
      kind = classify(u);
      if (kind.service === 'shortlink') throw new SongError('Could not open that Spotify link');
    }
    let meta;
    if (kind.service === 'spotify') meta = await fromSpotify(kind.id);
    else if (kind.service === 'youtubeMusic') meta = await fromYouTube(kind.id);
    else meta = await fromApple(kind.id);

    const q = encodeURIComponent(`${meta.title.replace(/\s*[(\[].*?[)\]]/g, '')} ${meta.artist}`.trim());
    const links = {
      spotify: { url: `https://open.spotify.com/search/${q}`, exact: false },
      youtubeMusic: { url: `https://music.youtube.com/search?q=${q}`, exact: false },
      appleMusic: { url: `https://music.apple.com/search?term=${q}`, exact: false },
    };
    const [apple, yt, sp] = await Promise.all([
      kind.service === 'appleMusic' ? meta : findApple(meta),
      kind.service === 'youtubeMusic' ? { videoId: kind.id } : findYouTube(meta).then(v => v && { videoId: v }),
      kind.service === 'spotify' ? meta.spotifyId : findSpotify(meta),
    ]);
    if (apple && apple.appleUrl) links.appleMusic = { url: apple.appleUrl, exact: true };
    if (yt && yt.videoId) links.youtubeMusic = { url: `https://music.youtube.com/watch?v=${yt.videoId}`, exact: true };
    if (sp) links.spotify = { url: `https://open.spotify.com/track/${sp}`, exact: true };

    // Prefer the cleanest metadata: Spotify's own for Spotify shares, Apple's
    // otherwise (YouTube titles are the noisiest), keeping the source's art
    // unless it is only a video thumbnail.
    let { title, artist, album, artUrl } = meta;
    if (kind.service === 'youtubeMusic' && apple) {
      ({ title, artist, album } = apple);
      artUrl = apple.artUrl || artUrl;
    }
    return { title: title.slice(0, 200), artist: (artist || '').slice(0, 200), album: (album || '').slice(0, 200), artUrl: artUrl || null, source: kind.service, links };
  }

  async function resolve(raw) {
    const key = String(raw).trim();
    const hit = cache.get(key);
    if (hit && now() - hit.at < CACHE_TTL) return hit.value;
    const value = await resolveUncached(key);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, { at: now(), value });
    return value;
  }

  // Album art bytes for storage next to the pair's note images.
  async function fetchArt(url) {
    if (!url) return null;
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:') return null;
      const res = await get(url);
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.length > 0 && buf.length < 4 * 1024 * 1024 ? buf : null;
    } catch { return null; }
  }

  return { resolve, fetchArt };
}

module.exports = { createSongResolver, classify, sameSong, norm, SongError };
