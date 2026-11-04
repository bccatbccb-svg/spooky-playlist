import CONFIG from './config.js?v=1793787376';
export { CONFIG };
export const DEMO = !CONFIG.SUPABASE_URL;

// ---------- small helpers ----------
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const enc = encodeURIComponent;
// Only allow normal web links (blocks javascript: and other tricks), already HTML-escaped.
export const safeUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? esc(x.href) : ''; } catch { return ''; } };

export function deviceId() {
  let id = localStorage.getItem('spooky-device');
  if (!id) { id = (crypto.randomUUID?.() || String(Math.random()).slice(2) + Date.now()); localStorage.setItem('spooky-device', id); }
  return id;
}

export function toast(msg) {
  const t = document.getElementById('toast'); if (!t) return alert(msg);
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3500);
}

export const voteCount = (s) => (s.votes || []).filter(v => v.kind !== 'down').length;
export const downCount = (s) => (s.votes || []).filter(v => v.kind === 'down').length;
export const CRINGE_AT = 3; // downvotes needed for "Certified Cringe"

// ---------- dedupe ----------
export function normalize(s) {
  return (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[([](feat|ft|featuring)\.?[^)\]]*[)\]]/g, '')
    .replace(/[([][^)\]]*\b(remaster(ed)?|4k|hd|hq|official|lyrics?|audio|video|visualizer|explicit|clean|from [^)\]]*)\b[^)\]]*[)\]]/g, '')
    .replace(/\s-\s(\d{4}\s)?remaster(ed)?.*$/g, '')
    .replace(/\s(feat|ft|featuring)\.?\s.*$/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
const firstArtist = (a) => (a || '').split(/,|&| x | and | feat\.? | ft\.? /i)[0];
export const canonicalKey = (artist, title) => normalize(firstArtist(artist)) + '|' + normalize(title);

export function cleanTitle(t) {
  return (t || '')
    .replace(/\s*[([](official\s*(music\s*)?(video|audio|visualizer|lyric video)|lyrics?|audio|hq|hd|4k|visualizer|music video)[)\]]/gi, '')
    .replace(/\s+/g, ' ').trim();
}

// ---------- links ----------
export function detectPlatform(url) {
  let h; try { h = new URL(url).hostname.replace(/^www\.|^m\./, ''); } catch { return null; }
  if (h.endsWith('spotify.com') || h === 'spotify.link') return 'spotify';
  if (h === 'music.apple.com' || h === 'itunes.apple.com') return 'apple';
  if (h === 'music.youtube.com') return 'youtubeMusic';
  if (h === 'youtube.com' || h === 'youtu.be') return 'youtube';
  if (h.endsWith('soundcloud.com') || h === 'snd.sc') return 'soundcloud';
  return null;
}

export const PLATFORM = {
  soundcloud: { label: 'SoundCloud', icon: '☁️' },
  spotify: { label: 'Spotify', icon: '🟢' },
  apple: { label: 'Apple Music', icon: '🍎' },
  youtubeMusic: { label: 'YT Music', icon: '🎵' },
  youtube: { label: 'YouTube', icon: '▶️' },
  youtube_search: { label: 'Find on YouTube', icon: '🔎' },
  spotify_search: { label: 'Find on Spotify', icon: '🔎' },
  manual: { label: 'Typed in', icon: '✍️' },
};
const getJson = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(r.status); return r.json(); };
const itunes = async (term) => (await getJson('https://itunes.apple.com/search?entity=song&limit=5&term=' + enc(term))).results || [];
const bigArt = (u) => (u || '').replace(/\d+x\d+bb/, '600x600bb');

export async function resolveLink(url) {
  url = url.trim();
  const platform = detectPlatform(url);
  if (!platform) throw new Error('That link isn\'t from Spotify, Apple Music, SoundCloud or YouTube.');
  const info = { platform, source_url: url, links: { [platform]: url }, title: '', artist: '', artwork: '', spotify_uri: '' };

  try {
    if (platform === 'soundcloud') {
      const j = await getJson('https://soundcloud.com/oembed?format=json&url=' + enc(url));
      let t = j.title || '', a = j.author_name || '';
      if (a && t.endsWith(' by ' + a)) t = t.slice(0, -(' by ' + a).length);
      const parts = t.split(' - ');
      if (parts.length >= 2) { a = parts[0].trim(); t = parts.slice(1).join(' - ').trim(); }
      Object.assign(info, { title: t, artist: a, artwork: j.thumbnail_url || '' });
    } else if (platform === 'youtube' || platform === 'youtubeMusic') {
      const u = new URL(url);
      const id = u.searchParams.get('v') || (u.hostname.includes('youtu.be') ? u.pathname.slice(1) : '') || (u.pathname.match(/\/(shorts|live)\/([\w-]+)/) || [])[2];
      const watch = id ? 'https://www.youtube.com/watch?v=' + id : url;
      const j = await getJson('https://www.youtube.com/oembed?format=json&url=' + enc(watch));
      let t = cleanTitle(j.title), a = (j.author_name || '').replace(/\s*-\s*Topic$/, '').replace(/VEVO$/i, '').trim();
      const parts = t.split(/ [-–—] /);
      if (parts.length >= 2) { a = parts[0].trim(); t = parts.slice(1).join(' - ').trim(); }
      Object.assign(info, { title: t, artist: a, artwork: j.thumbnail_url || '' });
      if (platform === 'youtubeMusic') info.links.youtube = watch;
    } else if (platform === 'spotify') {
      const m = url.match(/track\/([A-Za-z0-9]+)/);
      if (!m) throw new Error('Please share a Spotify *song* link (not a playlist or album).');
      info.spotify_uri = 'spotify:track:' + m[1];
      const j = await getJson('https://open.spotify.com/oembed?url=' + enc('https://open.spotify.com/track/' + m[1]));
      info.title = j.title || ''; info.artwork = j.thumbnail_url || '';
      // Spotify doesn't tell us the artist here — guess via Apple's catalogue, guest can correct it.
      const hit = (await itunes(info.title)).find(r => normalize(r.trackName) === normalize(info.title));
      if (hit) { info.artist = hit.artistName; info.links.apple = hit.trackViewUrl; }
    } else if (platform === 'apple') {
      const u = new URL(url);
      const id = u.searchParams.get('i') || (u.pathname.includes('/song/') ? u.pathname.split('/').pop() : '');
      if (!id) throw new Error('Please share an Apple Music *song* link (tap ••• on the song → Share).');
      const r = (await getJson('https://itunes.apple.com/lookup?entity=song&id=' + enc(id))).results?.find(x => x.kind === 'song');
      if (r) Object.assign(info, { title: r.trackName, artist: r.artistName, artwork: bigArt(r.artworkUrl100) });
    }
  } catch (e) { if (/share an? /.test(e.message)) throw e; }

  // Enrich: Apple link + nicer artwork when we can find an exact match.
  if (info.title && !info.links.apple) {
    try {
      const hit = (await itunes(`${info.artist} ${info.title}`)).find(r => normalize(r.trackName) === normalize(info.title));
      if (hit) { info.links.apple = hit.trackViewUrl; if (!info.artwork) info.artwork = bigArt(hit.artworkUrl100); }
    } catch { /* fine */ }
  }

  if (!info.title) { const e = new Error('NEEDS_MANUAL'); e.info = info; throw e; }
  return finalize(info);
}

export function finalize(info) {
  info.links = info.links || {};
  const q = `${info.artist} ${info.title}`.trim();
  info.links.youtube_search = 'https://www.youtube.com/results?search_query=' + enc(q);
  if (!info.links.spotify) info.links.spotify_search = 'https://open.spotify.com/search/' + enc(q);
  info.canonical_key = canonicalKey(info.artist, info.title);
  return info;
}

// ---------- data layer ----------
export const api = DEMO ? demoApi() : supaApi();

function supaApi() {
  let sbp;
  const sb = () => sbp ||= import('https://esm.sh/@supabase/supabase-js@2').then(m => m.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY));
  const rpc = async (fn, args) => { const { data, error } = await (await sb()).rpc(fn, args); if (error) throw new Error(error.message); return data; };
  return {
    async load() {
      const { data, error } = await (await sb()).from('songs').select('*, votes(name,device_id,kind,created_at)').order('created_at');
      if (error) throw new Error(error.message); return data;
    },
    async subscribe(cb) {
      let t; const fire = () => { clearTimeout(t); t = setTimeout(cb, 250); };
      (await sb()).channel('party').on('postgres_changes', { event: '*', schema: 'public', table: 'songs' }, fire)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'votes' }, fire).subscribe();
      setInterval(cb, 30000); // safety net
    },
    submit: (name, song) => rpc('submit_song', { p_device: deviceId(), p_name: name, p_song: song }),
    toggleVote: (name, id) => rpc('toggle_vote', { p_device: deviceId(), p_name: name, p_song: id }),
    toggleDown: (name, id) => rpc('toggle_down', { p_device: deviceId(), p_name: name, p_song: id }),
    djCheck: (key) => rpc('dj_check', { p_key: key }),
    djUpdate: (key, id, fields) => rpc('dj_update', { p_key: key, p_id: id, p_fields: fields }),
    djSetOrder: (key, ids) => rpc('dj_set_order', { p_key: key, p_ids: ids }),
  };
}

// Demo mode: everything lives in this browser's localStorage. DJ key is "demo".
function demoApi() {
  const K = 'spooky-demo-db';
  const read = () => JSON.parse(localStorage.getItem(K) || '{"songs":[]}');
  const bc = 'BroadcastChannel' in window ? new BroadcastChannel('spooky') : null;
  const subs = [];
  const write = (db) => { localStorage.setItem(K, JSON.stringify(db)); subs.forEach(f => f()); bc?.postMessage('x'); };
  const ok = (key) => key === 'demo';
  return {
    async load() { return read().songs; },
    async subscribe(cb) { subs.push(cb); if (bc) bc.onmessage = cb; },
    async submit(name, song) {
      if (!name?.trim()) throw new Error('Tell us your name first');
      const db = read(), me = deviceId();
      const ex = db.songs.find(s => s.canonical_key === song.canonical_key);
      if (ex) {
        if (!ex.votes.some(v => v.device_id === me)) ex.votes.push({ name, device_id: me, kind: 'vote', created_at: new Date().toISOString() });
        write(db); return { result: 'duplicate', id: ex.id, status: ex.status };
      }
      const n = db.songs.filter(s => s.submitted_by_device === me).length;
      if (n >= CONFIG.TOTAL_LIMIT) throw new Error(`You've used all ${CONFIG.TOTAL_LIMIT} summons`);
      const wild = n >= CONFIG.AUTO_LIMIT;
      const id = crypto.randomUUID?.() || String(Date.now());
      db.songs.push({
        ...song, id, status: wild ? 'pending' : 'approved', is_wildcard: wild, submitted_by_name: name.trim(),
        submitted_by_device: me, set_position: null, sc_liked: false, spotify_synced: false, bpm: null, camelot: null,
        created_at: new Date().toISOString(), votes: [{ name, device_id: me, kind: 'submit', created_at: new Date().toISOString() }],
      });
      write(db); return { result: wild ? 'wildcard' : 'added', id };
    },
    async toggleVote(name, id) { return this._toggle(name, id, 'vote'); },
    async toggleDown(name, id) { return this._toggle(name, id, 'down'); },
    async _toggle(name, id, kind) {
      const db = read(), me = deviceId(), s = db.songs.find(x => x.id === id);
      const v = s.votes.find(x => x.device_id === me);
      if (v?.kind === 'submit') throw new Error("You can't vote on your own song");
      if (v?.kind === kind) s.votes.splice(s.votes.indexOf(v), 1);
      else if (v) v.kind = kind;
      else s.votes.push({ name, device_id: me, kind, created_at: new Date().toISOString() });
      write(db); return true;
    },
    async djCheck(key) { return ok(key); },
    async djUpdate(key, id, fields) {
      if (!ok(key)) throw new Error('Not the DJ');
      const db = read(), s = db.songs.find(x => x.id === id);
      for (const [k, v] of Object.entries(fields)) s[k] = v === '' ? null : v;
      write(db);
    },
    async djSetOrder(key, ids) {
      if (!ok(key)) throw new Error('Not the DJ');
      const db = read(); ids.forEach((id, i) => { const s = db.songs.find(x => x.id === id); if (s) s.set_position = i + 1; }); write(db);
    },
  };
}
