import { safeUrl, CONFIG, DEMO, api, esc, toast, voteCount, PLATFORM, enc } from './shared.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
if (params.get('key')) localStorage.setItem('spooky-dj-key', params.get('key'));
const KEY = params.get('key') || localStorage.getItem('spooky-dj-key') || '';

let songs = [];
let tab = localStorage.getItem('spooky-dj-tab') || 'set';
let renderQueued = false;

// =====================================================================
// Camelot / harmonic mixing
// =====================================================================
const MAJ = { B: 1, Cb: 1, 'F#': 2, Gb: 2, Db: 3, 'C#': 3, Ab: 4, 'G#': 4, Eb: 5, 'D#': 5, Bb: 6, 'A#': 6, F: 7, C: 8, G: 9, D: 10, A: 11, E: 12 };
const MIN = { 'G#': 1, Ab: 1, 'D#': 2, Eb: 2, Bb: 3, 'A#': 3, F: 4, C: 5, G: 6, D: 7, A: 8, E: 9, B: 10, Cb: 10, 'F#': 11, Gb: 11, 'C#': 12, Db: 12 };

export function toCamelot(k) {
  if (!k) return '';
  k = String(k).trim().replace(/♭/g, 'b').replace(/♯/g, '#');
  let m = k.match(/^(\d{1,2})\s*([AaBb])$/);
  if (m) { const n = +m[1]; return n >= 1 && n <= 12 ? n + m[2].toUpperCase() : ''; }
  m = k.match(/^([A-Ga-g])([#b]?)\s*(m|min|minor|maj|major)?$/);
  if (!m) return '';
  const root = m[1].toUpperCase() + m[2];
  const minor = ['m', 'min', 'minor'].includes(m[3] || '');
  const n = (minor ? MIN : MAJ)[root];
  return n ? n + (minor ? 'A' : 'B') : '';
}
const parseCam = (c) => { const m = String(c || '').match(/^(\d{1,2})([AB])$/); return m ? { n: +m[1], l: m[2] } : null; };

// 0 = same key, 1 = neighbour / relative major-minor, 2 = energy boost (+2), higher = clash
function keyDist(a, b) {
  const pa = parseCam(a), pb = parseCam(b);
  if (!pa || !pb) return null;
  const d = Math.min((pa.n - pb.n + 12) % 12, (pb.n - pa.n + 12) % 12);
  if (pa.l === pb.l) return d <= 2 ? d : 3 + d;
  return d === 0 ? 1 : 4 + d;
}
function bpmPct(a, b) {
  a = +a; b = +b; if (!a || !b) return null;
  return Math.min(...[b, b * 2, b / 2].map(x => Math.abs(a - x) / a * 100));
}
function transition(a, b) {
  const kd = keyDist(a.camelot, b.camelot), bp = bpmPct(a.bpm, b.bpm);
  if (kd === null || bp === null) return { cls: '', text: '· need BPM + key to rate this transition' };
  const delta = (+b.bpm - +a.bpm);
  const keyTxt = kd === 0 ? 'same key' : kd === 1 ? 'harmonic neighbour' : kd === 2 ? 'energy boost' : 'key clash';
  const desc = `${a.camelot} → ${b.camelot} (${keyTxt}) · ${+a.bpm} → ${+b.bpm} BPM (${delta >= 0 ? '+' : ''}${bp.toFixed(1)}%)`;
  if (kd <= 1 && bp <= 6) return { cls: 'good', text: '✅ smooth · ' + desc };
  if (kd <= 2 && bp <= 8) return { cls: 'ok', text: '👍 workable · ' + desc };
  return { cls: 'bad', text: '⚠️ rough — try a cut, echo out or loop · ' + desc };
}

// Smart set: warm-up → build → peak (most-voted) → cool-down, chained by key + BPM.
function buildSmartSet(list) {
  const ready = list.filter(s => +s.bpm && parseCam(s.camelot));
  const rest = list.filter(s => !(+s.bpm && parseCam(s.camelot)));
  if (ready.length < 2) return [...ready, ...rest];
  const bpms = ready.map(s => +s.bpm);
  const lo = Math.min(...bpms), hi = Math.max(...bpms), range = Math.max(hi - lo, 1);
  const maxV = Math.max(...ready.map(voteCount), 1);
  const N = ready.length;
  const t = (i) => i / (N - 1);
  const targetBpm = (i) => t(i) <= 0.75 ? lo + range * (t(i) / 0.75) : hi - range * 0.4 * ((t(i) - 0.75) / 0.25);
  const peak = (i) => Math.max(0, 1 - Math.abs(t(i) - 0.68) / 0.22);

  const pool = [...ready].sort((a, b) => a.bpm - b.bpm || voteCount(a) - voteCount(b));
  const out = [pool.shift()];
  while (pool.length) {
    const i = out.length, prev = out[i - 1];
    let best = null, bestCost = Infinity;
    for (const c of pool) {
      const pop = voteCount(c) / maxV;
      const cost = (keyDist(prev.camelot, c.camelot) ?? 6) * 2.2
        + Math.min(bpmPct(prev.bpm, c.bpm) ?? 20, 20) * 0.5
        + Math.abs(+c.bpm - targetBpm(i)) / range * 6
        - pop * peak(i) * 5 + pop * (1 - peak(i)) * 1.5;
      if (cost < bestCost) { bestCost = cost; best = c; }
    }
    out.push(best); pool.splice(pool.indexOf(best), 1);
  }
  return [...out, ...rest];
}

// =====================================================================
// Data helpers
// =====================================================================
const approved = () => songs.filter(s => s.status === 'approved');
const setOrder = () => approved().sort((a, b) => (a.set_position ?? 1e9) - (b.set_position ?? 1e9) || a.created_at.localeCompare(b.created_at));

async function update(id, fields, quiet) {
  try { await api.djUpdate(KEY, id, fields); if (!quiet) await refresh(); }
  catch (e) { toast('💀 ' + e.message); }
}

// =====================================================================
// Rendering
// =====================================================================
function links(s) {
  const l = s.links || {}, out = [];
  for (const k of ['soundcloud', 'spotify', 'apple', 'youtubeMusic', 'youtube']) if (l[k]) out.push(`<a class="chip" href="${safeUrl(l[k])}" target="_blank" rel="noopener">${PLATFORM[k].icon}</a>`);
  if (!l.spotify && l.spotify_search) out.push(`<a class="chip" href="${safeUrl(l.spotify_search)}" target="_blank" rel="noopener" title="Search Spotify">🟢🔎</a>`);
  if (!l.youtube && l.youtube_search) out.push(`<a class="chip" href="${safeUrl(l.youtube_search)}" target="_blank" rel="noopener" title="Search YouTube">🔎</a>`);
  if (s.free_download) out.push(`<a class="chip" href="${safeUrl(s.free_download)}" target="_blank" rel="noopener">⬇️ Free DL</a>`);
  return out.join('');
}

function render() {
  if (document.activeElement?.matches('#main input')) { renderQueued = true; return; }
  renderQueued = false;
  const a = approved(), pend = songs.filter(s => s.status === 'pending'), grave = songs.filter(s => s.status === 'graveyard');
  const scTodo = a.filter(s => s.links?.soundcloud && !s.sc_liked);
  const missing = a.filter(s => !(+s.bpm && s.camelot)).length;
  const people = new Set(songs.flatMap(s => (s.votes || []).map(v => v.device_id))).size;
  const tabs = [['set', 'Set builder', a.length], ['wild', 'Wildcards', pend.length], ['sc', 'SoundCloud', scTodo.length],
    ['spotify', 'Spotify', a.filter(s => s.spotify_uri && !s.spotify_synced).length], ['all', 'All requests', songs.length], ['grave', 'Graveyard', grave.length]];

  $('main').innerHTML = `
    <div class="stats">
      <div class="stat"><b>${a.length}</b><span>Songs</span></div>
      <div class="stat"><b>${pend.length}</b><span>Pending</span></div>
      <div class="stat"><b>${people}</b><span>Guests</span></div>
      <div class="stat"><b>${missing}</b><span>Missing BPM</span></div>
      <div class="stat"><b>${scTodo.length}</b><span>SC likes</span></div>
      <div class="stat"><b>${grave.length}</b><span>Buried</span></div>
    </div>
    <div class="tabs">${tabs.map(([k, l, n]) => `<button class="tab ${tab === k ? 'active' : ''}" data-tab="${k}">${l}<span class="n">${n}</span></button>`).join('')}</div>
    <div id="pane"></div>`;
  ({ set: paneSet, wild: paneWild, sc: paneSC, spotify: paneSpotify, all: paneAll, grave: paneGrave })[tab]?.();
}

function paneSet() {
  const list = setOrder();
  const hasBpmKey = !!CONFIG.GETSONGBPM_API_KEY;
  let html = `<div class="toolbar">
      <button class="btn" id="smart">Build smart set</button>
      ${hasBpmKey ? '<button class="btn ghost" id="autofill">🔍 Auto-fill BPM/key</button>' : ''}
      <button class="btn ghost" id="csv">Export CSV</button>
      <span class="hint">Drag rows to reorder. Key accepts Camelot (8A) or musical (Am, F#).</span>
    </div>`;
  if (!list.length) { $('pane').innerHTML = html + '<p class="empty">No songs yet 👻</p>'; bindSetTools(); return; }
  const N = list.length;
  list.forEach((s, i) => {
    const q = (j) => Math.min(3, Math.floor((N > 1 ? j / (N - 1) : 0) * 4));
    const phase = (i === 0 || q(i) !== q(i - 1)) ? ['Warm-up', 'Build', 'Peak', 'Cool-down'][q(i)] : '';
    if (phase && N >= 6) html += `<div class="phase">${phase}</div>`;
    if (i > 0) { const tr = transition(list[i - 1], s); html += `<div class="trans ${tr.cls}">${esc(tr.text)}</div>`; }
    html += `<div class="set-row" draggable="true" data-id="${s.id}">
      <span class="num">${i + 1}</span>
      <img class="art" src="${safeUrl(s.artwork || '')}" alt="" onerror="this.style.visibility='hidden'">
      <div class="meta"><div class="title">${esc(s.title)}</div><div class="artist">${esc(s.artist || '')} <span class="by">· ${esc(s.submitted_by_name)}${s.is_wildcard ? ' · 🦇' : ''}</span></div></div>
      <input data-bpm="${s.id}" value="${esc(s.bpm ?? '')}" placeholder="BPM" inputmode="decimal">
      <input data-key="${s.id}" value="${esc(s.camelot ?? '')}" placeholder="Key" class="key-pill">
      <span class="votes-col">▲ ${voteCount(s)}</span>
      <div class="acts">${links(s)}<button class="btn ghost small" data-status="graveyard" data-id2="${s.id}" title="Send to graveyard">🪦</button></div>
    </div>`;
  });
  $('pane').innerHTML = html;
  bindSetTools();
  bindDrag();
}

function bindSetTools() {
  $('smart')?.addEventListener('click', async () => {
    const ordered = buildSmartSet(setOrder());
    await api.djSetOrder(KEY, ordered.map(s => s.id));
    const missing = ordered.filter(s => !(+s.bpm && s.camelot)).length;
    toast(missing ? `🧠 Set built! ${missing} song(s) without BPM/key were put at the end.` : '🧠 Set built!');
    await refresh();
  });
  $('autofill')?.addEventListener('click', autofill);
  $('csv')?.addEventListener('click', exportCsv);
}

function bindDrag() {
  let dragged = null;
  document.querySelectorAll('.set-row').forEach(row => {
    row.addEventListener('dragstart', () => { dragged = row; row.classList.add('dragging'); });
    row.addEventListener('dragend', () => { row.classList.remove('dragging'); document.querySelectorAll('.over').forEach(x => x.classList.remove('over')); });
    row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('over'); });
    row.addEventListener('dragleave', () => row.classList.remove('over'));
    row.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (!dragged || dragged === row) return;
      const ids = setOrder().map(s => s.id);
      const from = ids.indexOf(dragged.dataset.id); ids.splice(from, 1);
      ids.splice(ids.indexOf(row.dataset.id) + (from <= ids.indexOf(row.dataset.id) ? 1 : 0), 0, dragged.dataset.id);
      await api.djSetOrder(KEY, ids); await refresh();
    });
  });
}

function songRow(s, actions) {
  return `<div class="song">
    <img class="art" src="${safeUrl(s.artwork || '')}" alt="" onerror="this.style.visibility='hidden'">
    <div class="meta"><div class="title">${esc(s.title)}</div><div class="artist">${esc(s.artist || '')}</div>
      <div class="by">by <b>${esc(s.submitted_by_name)}</b> · 🔥 ${voteCount(s)} · ${new Date(s.created_at).toLocaleString()}</div>
      <div class="chips">${links(s)}</div></div>
    <div class="acts" style="display:flex;gap:6px;flex-wrap:wrap">${actions}</div>
  </div>`;
}

function paneWild() {
  const list = songs.filter(s => s.status === 'pending').sort((a, b) => voteCount(b) - voteCount(a));
  $('pane').innerHTML = `<p class="hint">Songs 6–8 from each guest land here. Bless them onto the playlist or bury them.</p><div class="list">` +
    (list.map(s => songRow(s, `<button class="btn small bless" data-status="approved" data-id2="${s.id}">Bless ●</button><button class="btn small bury" data-status="graveyard" data-id2="${s.id}">Bury ●</button>`)).join('') || '<p class="empty">No wildcards waiting 🕯️</p>') + '</div>';
}

function paneSC() {
  const all = setOrder().filter(s => s.links?.soundcloud);
  const todo = all.filter(s => !s.sc_liked), done = all.filter(s => s.sc_liked);
  $('pane').innerHTML = `<p class="hint">Open each track, hit ❤️ on SoundCloud, then tick it off here. Liked tracks show up in Rekordbox's SoundCloud “Likes”.</p>
    <div class="list">${todo.map(s => songRow(s, `<a class="btn small" href="${safeUrl(s.links.soundcloud)}" target="_blank" rel="noopener">Open ☁️</a><button class="btn ghost small" data-liked="${s.id}">❤️ Liked</button>`)).join('') || '<p class="empty">All SoundCloud tracks liked 🖤</p>'}</div>
    ${done.length ? `<details class="graveyard"><summary>Already liked (${done.length})</summary><div class="list">${done.map(s => songRow(s, `<button class="btn ghost small" data-unliked="${s.id}">Undo</button>`)).join('')}</div></details>` : ''}`;
}

function paneAll() {
  const rows = [...songs].sort((a, b) => voteCount(b) - voteCount(a));
  $('pane').innerHTML = `<div class="card" style="overflow-x:auto"><table>
    <tr><th>Song</th><th>Status</th><th>🔥</th><th>Summoned by</th><th>Upvoted by</th><th>Links</th><th>BPM</th><th>Key</th><th>When</th></tr>
    ${rows.map(s => `<tr><td><b>${esc(s.title)}</b><br><span class="dim" style="margin:0">${esc(s.artist || '')}</span></td>
      <td><span class="status ${s.status}">${s.status === 'pending' ? 'wildcard' : s.status}</span>${s.is_wildcard && s.status === 'approved' ? ' 🦇' : ''}</td>
      <td>${voteCount(s)}</td><td>${esc(s.submitted_by_name)}</td>
      <td>${esc((s.votes || []).filter(v => v.kind !== 'submit').map(v => v.name).join(', '))}</td>
      <td><div class="chips" style="margin:0">${links(s)}</div></td><td>${esc(s.bpm ?? '')}</td><td>${esc(s.camelot ?? '')}</td>
      <td>${new Date(s.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td></tr>`).join('')}
  </table></div>`;
}

function paneGrave() {
  const list = songs.filter(s => s.status === 'graveyard');
  $('pane').innerHTML = '<div class="list">' + (list.map(s => songRow(s, `<button class="btn ghost small" data-status="approved" data-id2="${s.id}">🧟 Resurrect</button>`)).join('') || '<p class="empty">The graveyard is empty… for now.</p>') + '</div>';
}

// =====================================================================
// BPM / key auto-fill (GetSongBPM)
// =====================================================================
async function autofill() {
  const todo = approved().filter(s => !(+s.bpm && s.camelot));
  if (!todo.length) return toast('Everything already has BPM + key ✅');
  toast(`🔍 Looking up ${todo.length} song(s)…`);
  let found = 0;
  for (const s of todo) {
    try {
      const q = `song:${s.title.replace(/\(.*?\)|\[.*?\]/g, '').trim()} artist:${(s.artist || '').split(/,|&| x /i)[0].trim()}`;
      const r = await fetch(`https://api.getsong.co/search/?api_key=${enc(CONFIG.GETSONGBPM_API_KEY)}&type=both&lookup=${enc(q)}`);
      const j = await r.json();
      const hit = Array.isArray(j.search) ? j.search[0] : null;
      if (hit) {
        const fields = {};
        if (!+s.bpm && hit.tempo) fields.bpm = String(Math.round(+hit.tempo));
        if (!s.camelot) { const c = toCamelot(hit.key_of); if (c) fields.camelot = c; }
        if (Object.keys(fields).length) { await api.djUpdate(KEY, s.id, fields); found++; }
      }
    } catch { /* skip */ }
    await new Promise(r => setTimeout(r, 300));
  }
  toast(`Filled ${found} of ${todo.length}. The rest (bootlegs etc.) — Rekordbox will analyze them.`);
  await refresh();
}

function exportCsv() {
  const cols = ['#', 'Title', 'Artist', 'BPM', 'Key', 'Votes', 'Summoned by', 'SoundCloud', 'Spotify', 'Apple Music', 'YouTube', 'Free download'];
  const rows = setOrder().map((s, i) => [i + 1, s.title, s.artist, s.bpm, s.camelot, voteCount(s), s.submitted_by_name,
    s.links?.soundcloud, s.links?.spotify, s.links?.apple, s.links?.youtube || s.links?.youtubeMusic || s.links?.youtube_search, s.free_download]);
  const csv = [cols, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'spooky-set.csv'; a.click();
}

// =====================================================================
// Spotify (runs in your browser only — login stays on this device)
// =====================================================================
const SP = {
  redirect: location.origin + location.pathname,
  get token() { return JSON.parse(localStorage.getItem('spooky-sp-token') || 'null'); },
  set token(v) { localStorage.setItem('spooky-sp-token', JSON.stringify(v)); },
  get playlist() { return localStorage.getItem('spooky-sp-playlist') || ''; },
  set playlist(v) { localStorage.setItem('spooky-sp-playlist', v); },
  get auto() { return localStorage.getItem('spooky-sp-auto') === '1'; },
  set auto(v) { localStorage.setItem('spooky-sp-auto', v ? '1' : '0'); },
};
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function spLogin() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  localStorage.setItem('spooky-sp-verifier', verifier);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  location.href = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
    client_id: CONFIG.SPOTIFY_CLIENT_ID, response_type: 'code', redirect_uri: SP.redirect,
    code_challenge_method: 'S256', code_challenge: challenge,
    scope: 'playlist-modify-public playlist-modify-private playlist-read-private',
  });
}
async function spTokenRequest(body) {
  const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: CONFIG.SPOTIFY_CLIENT_ID, ...body }) });
  const j = await r.json(); if (!r.ok) throw new Error(j.error_description || j.error || 'Spotify login failed');
  SP.token = { access: j.access_token, refresh: j.refresh_token || SP.token?.refresh, exp: Date.now() + (j.expires_in - 60) * 1000 };
}
async function spHandleRedirect() {
  const code = params.get('code'); if (!code) return;
  history.replaceState(null, '', location.pathname);
  try { await spTokenRequest({ grant_type: 'authorization_code', code, redirect_uri: SP.redirect, code_verifier: localStorage.getItem('spooky-sp-verifier') }); tab = 'spotify'; toast('🟢 Spotify connected'); }
  catch (e) { toast('💀 ' + e.message); }
}
async function sp(path, opts = {}) {
  let t = SP.token; if (!t) throw new Error('Connect Spotify first');
  if (Date.now() > t.exp) { await spTokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh }); t = SP.token; }
  const r = await fetch('https://api.spotify.com/v1' + path, { ...opts, headers: { Authorization: 'Bearer ' + t.access, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  if (r.status === 204) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error?.message || `Spotify error ${r.status}`); e.status = r.status; throw e; }
  return j;
}

let spPlaylists = null;
async function paneSpotify() {
  if (!CONFIG.SPOTIFY_CLIENT_ID) { $('pane').innerHTML = '<div class="card"><p>Add your <b>SPOTIFY_CLIENT_ID</b> to <code>config.js</code> to turn this on (see README).</p></div>'; return; }
  if (!SP.token) { $('pane').innerHTML = `<div class="card"><p>Connect your Spotify so approved songs get added to your playlist automatically.</p><button class="btn" id="sp-login">🟢 Connect Spotify</button></div>`; $('sp-login').onclick = spLogin; return; }
  if (!spPlaylists) {
    $('pane').innerHTML = '<p class="hint">Loading your playlists…</p>';
    try { spPlaylists = (await sp('/me/playlists?limit=50')).items.filter(Boolean); }
    catch (e) { $('pane').innerHTML = `<div class="card"><p class="error">${esc(e.message)}</p><button class="btn" id="sp-login">Reconnect Spotify</button></div>`; $('sp-login').onclick = spLogin; return; }
  }
  const todo = setOrder().filter(s => !s.spotify_synced && (s.spotify_uri || s.platform !== 'soundcloud') && !spMiss.has(s.id));
  $('pane').innerHTML = `<div class="card">
    <label>Playlist to fill</label>
    <div class="row"><select id="sp-pl"><option value="">— choose —</option>${spPlaylists.map(p => `<option value="${p.id}" ${p.id === SP.playlist ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
    <button class="btn ghost" id="sp-new">+ New playlist</button></div>
    <p><label style="display:inline-flex;gap:8px;align-items:center;font-weight:600"><input type="checkbox" id="sp-auto" style="width:auto" ${SP.auto ? 'checked' : ''}> Auto-add new approved songs while this page is open</label></p>
    <button class="btn" id="sp-sync">🟢 Add ${todo.length} song(s) now</button>
    <p class="hint">SoundCloud-only tracks are skipped unless they're also on Spotify. Songs pasted from Apple/YouTube get matched by title + artist.</p>
  </div>
  <div class="list">${todo.map(s => songRow(s, s.spotify_uri ? '<span class="chip">🟢 ready</span>' : '<span class="chip">🔎 will search</span>')).join('')}</div>`;
  $('sp-pl').onchange = (e) => { SP.playlist = e.target.value; };
  $('sp-auto').onchange = (e) => { SP.auto = e.target.checked; if (SP.auto) spSync(true); };
  $('sp-sync').onclick = () => spSync(false);
  $('sp-new').onclick = async () => {
    const name = prompt('Playlist name', CONFIG.PARTY_NAME + ' 🎃'); if (!name) return;
    try {
      let pl;
      try { pl = await sp('/me/playlists', { method: 'POST', body: JSON.stringify({ name, public: false }) }); }
      catch { const me = await sp('/me'); pl = await sp(`/users/${me.id}/playlists`, { method: 'POST', body: JSON.stringify({ name, public: false }) }); }
      SP.playlist = pl.id; spPlaylists = null; paneSpotify(); toast('Playlist created 🎃');
    } catch (e) { toast('💀 ' + e.message); }
  };
}

let syncing = false;
const spMiss = new Set(); // songs with no Spotify match (don't re-search every refresh)
async function spSync(quiet) {
  if (syncing || !SP.token) return;
  if (!SP.playlist) { if (!quiet) toast('Choose a playlist first'); return; }
  syncing = true;
  try {
    const todo = setOrder().filter(s => !s.spotify_synced);
    const uris = [], done = [];
    for (const s of todo) {
      let uri = s.spotify_uri;
      if (!uri && s.platform !== 'soundcloud' && !spMiss.has(s.id)) {
        try {
          const q = `track:${s.title.replace(/\(.*?\)|\[.*?\]/g, '').trim()} artist:${(s.artist || '').split(/,|&| x /i)[0].trim()}`;
          uri = (await sp('/search?type=track&limit=1&q=' + enc(q))).tracks?.items?.[0]?.uri;
          if (uri) await api.djUpdate(KEY, s.id, { spotify_uri: uri });
        } catch { /* no match */ }
        if (!uri) spMiss.add(s.id);
      }
      if (uri) { uris.push(uri); done.push(s.id); }
    }
    for (let i = 0; i < uris.length; i += 100) {
      const body = JSON.stringify({ uris: uris.slice(i, i + 100) });
      try { await sp(`/playlists/${SP.playlist}/items`, { method: 'POST', body }); }
      catch (e) { if (e.status === 404 || e.status === 405) await sp(`/playlists/${SP.playlist}/tracks`, { method: 'POST', body }); else throw e; }
    }
    for (const id of done) await api.djUpdate(KEY, id, { spotify_synced: true });
    if (uris.length || !quiet) toast(`🟢 Added ${uris.length} song(s) to Spotify`);
    await refresh();
  } catch (e) { toast('💀 Spotify: ' + e.message); }
  syncing = false;
}

// =====================================================================
// Events + boot
// =====================================================================
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-tab],[data-status],[data-liked],[data-unliked]'); if (!t) return;
  if (t.dataset.tab) { tab = t.dataset.tab; localStorage.setItem('spooky-dj-tab', tab); render(); return; }
  if (t.dataset.status) { t.disabled = true; await update(t.dataset.id2, { status: t.dataset.status }); toast(t.dataset.status === 'graveyard' ? '🪦 Buried' : '🦇 Blessed'); }
  if (t.dataset.liked) await update(t.dataset.liked, { sc_liked: true });
  if (t.dataset.unliked) await update(t.dataset.unliked, { sc_liked: false });
});
document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.bpm) { const v = el.value.trim(); if (v && isNaN(+v)) return toast('BPM should be a number'); await update(el.dataset.bpm, { bpm: v }, true); }
  if (el.dataset.key) {
    const c = toCamelot(el.value); if (el.value.trim() && !c) return toast('Key not recognised — try 8A, 11B, Am, F#…');
    el.value = c; await update(el.dataset.key, { camelot: c }, true);
  }
  if (el.dataset.bpm || el.dataset.key) { songs = await api.load(); render(); }
});
document.addEventListener('focusout', () => setTimeout(() => { if (renderQueued) render(); }, 50));

async function refresh() {
  try { songs = await api.load(); render(); if (SP.auto && SP.playlist && SP.token) spSync(true); }
  catch (e) { toast('💀 ' + e.message); }
}

(async () => {
  $('sub').textContent = DEMO ? 'Backstage · demo mode (key "demo")' : 'Backstage · ' + CONFIG.PARTY_NAME;
  let ok = false;
  try { ok = KEY && await api.djCheck(KEY); } catch { ok = false; }
  if (!ok) { $('main').innerHTML = '<div class="gate"><h2>🚫 The crypt is sealed</h2><p class="sub">This link is missing the DJ\'s secret key.</p></div>'; return; }
  await spHandleRedirect();
  await refresh();
  api.subscribe(refresh);
})();
