import { analyzeSong, guessVibe, VIBES } from './analyze.js?v=1793890091';
import { safeUrl, CONFIG, DEMO, api, esc, toast, voteCount, downCount, PLATFORM, enc } from './shared.js?v=1793890091';

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
// How far apart two vibes feel (0 = same world, 3 = jarring).
const VIBE_GAP = { 'clubpop|house': 1, 'clubpop|dancehall': 1, 'clubpop|hiphop': 1, 'clubpop|throwback': 1.5, 'clubpop|latin': 1,
  'house|dancehall': 1.5, 'house|hiphop': 2, 'house|throwback': 2, 'house|latin': 1.5,
  'dancehall|hiphop': 1, 'dancehall|latin': 0.5, 'dancehall|throwback': 3,
  'hiphop|latin': 1.5, 'hiphop|throwback': 2.5, 'throwback|latin': 3 };
function vibeGap(a, b) { return a === b ? 0 : VIBE_GAP[a + '|' + b] ?? VIBE_GAP[b + '|' + a] ?? 2; }

function buildSmartSet(list) {
  const ready = list.filter(s => +s.bpm && parseCam(s.camelot));
  const rest = list.filter(s => !(+s.bpm && parseCam(s.camelot)));
  if (ready.length < 2) return [...ready, ...rest];
  const N = ready.length, t = (i) => i / (N - 1);
  const maxV = Math.max(...ready.map(voteCount), 1);
  const popOf = (s) => (s.birthday ? maxV : voteCount(s)) / maxV;
  // Energy as a rank within this crowd's songs (0 = chillest, 1 = hardest).
  const eRaw = (s) => (+s.energy || 5) + (+s.bpm || 110) / 60;
  const byE = [...ready].sort((a, b) => eRaw(a) - eRaw(b));
  const eRank = new Map(byE.map((s, i) => [s.id, i / (N - 1)]));
  // Energy arc: warm-up → build → first peak → short breather → main peak → strong finish.
  const ARC = [[0, .15], [.2, .4], [.42, .78], [.5, .55], [.6, .8], [.75, 1], [.88, .95], [1, .6]];
  const target = (x) => { for (let k = 1; k < ARC.length; k++) if (x <= ARC[k][0]) { const [x0, y0] = ARC[k - 1], [x1, y1] = ARC[k]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); } return .6; };
  const peak = (x) => Math.max(0, 1 - Math.abs(x - .75) / .2);

  // Vibes: play same-vibe songs in runs of 3–5, move between vibes that sit close together,
  // and sprinkle Latin evenly through the night instead of one big block.
  const vibeOf = (s) => VIBES[s.vibe] ? s.vibe : 'clubpop';
  const latinCount = ready.filter(s => vibeOf(s) === 'latin').length;
  const latinGap = latinCount ? N / latinCount : N;
  const pool = [...ready].sort((a, b) => (vibeOf(a) === 'latin') - (vibeOf(b) === 'latin') || eRank.get(a.id) - eRank.get(b.id));
  const out = [pool.shift()];
  while (pool.length) {
    const i = out.length, prev = out[i - 1], x = t(i);
    // "home" vibe = the last non-Latin vibe, so a Latin song in the middle of a run doesn't break it
    let home = null, run = 0, lastLatin = -1e9;
    for (let k = out.length - 1; k >= 0; k--) { const v = vibeOf(out[k]); if (v === 'latin') { if (lastLatin < 0) lastLatin = k; continue; } if (!home) home = v; if (v === home) run++; else break; }
    for (let k = out.length - 1; k >= 0 && lastLatin < 0; k--) if (vibeOf(out[k]) === 'latin') lastLatin = k;
    let best = null, bestCost = Infinity;
    for (const c of pool) {
      const v = vibeOf(c);
      const kd = keyDist(prev.camelot, c.camelot) ?? 6;
      const bp = Math.min(bpmPct(prev.bpm, c.bpm) ?? 20, 20);
      let vc;
      if (v === 'latin') {
        const since = i - lastLatin;
        vc = since < latinGap * 0.6 ? 9 : since >= latinGap ? -3 : 1;
        if (vibeOf(prev) === 'latin') vc += 6;
      } else if (!home || v === home) {
        vc = run >= 5 ? 10 : run >= 4 ? 3 : -1.5;
      } else {
        vc = vibeGap(home, v) * 2.5 + (run < 3 ? 4 : 0);
      }
      const cost = kd * 2 + bp * 0.45 + vc
        + Math.abs(eRank.get(c.id) - target(x)) * 8
        - popOf(c) * peak(x) * 4 + popOf(c) * (1 - peak(x)) * 1.2;
      if (cost < bestCost) { bestCost = cost; best = c; }
    }
    out.push(best); pool.splice(pool.indexOf(best), 1);
  }
  return [...out, ...rest];
}

// =====================================================================
// Audio analysis + auto ordering
// =====================================================================
let AUTO_ORDER = localStorage.getItem('spooky-auto-order') !== '0';
let analyzing = false; const analyzeMiss = new Set();
async function analyzeMissing(manual) {
  if (analyzing) return;
  const todo = songs.filter(s => s.status !== 'graveyard' && !(+s.bpm && s.camelot && s.energy != null && s.vibe) && !analyzeMiss.has(s.id));
  if (!todo.length) { if (manual) toast('Everything is analyzed ✅'); return; }
  analyzing = true; let n = 0;
  toast(`🎧 Analyzing ${todo.length} song(s)…`);
  for (const s of todo) {
    try {
      const f = {};
      if (!s.vibe) { try { f.vibe = await guessVibe(s.artist, s.title); } catch { /* skip */ } }
      const r = (+s.bpm && s.camelot && s.energy != null) ? {} : await analyzeSong(s.artist, s.title);
      if (!r) { if (f.vibe) await api.djUpdate(KEY, s.id, f); analyzeMiss.add(s.id); continue; }
      if (!+s.bpm && r.bpm) f.bpm = String(r.bpm);
      if (!s.camelot && r.camelot) f.camelot = r.camelot;
      if (s.energy == null && r.energy) f.energy = String(r.energy);
      await api.djUpdate(KEY, s.id, f); n++;
    } catch { analyzeMiss.add(s.id); }
  }
  analyzing = false;
  toast(`🎧 Analyzed ${n} of ${todo.length}${n < todo.length ? ' (no preview for the rest — fill those in by hand)' : ''}`);
  songs = await api.load();
  await autoOrder(n > 0);
  render();
}
// Re-run the smart set when new songs arrive (or analysis changed), unless turned off.
let lastOrderSig = '';
async function autoOrder(force) {
  if (!AUTO_ORDER) return;
  const list = setOrder();
  const sig = list.map(s => s.id + (s.bpm || '') + (s.camelot || '') + (s.energy ?? '') + (s.vibe || '')).sort().join();
  if (!force && (sig === lastOrderSig || !list.some(s => s.set_position == null))) { lastOrderSig = sig; return; }
  lastOrderSig = sig;
  const ordered = buildSmartSet(list);
  await api.djSetOrder(KEY, ordered.map(s => s.id));
  songs = await api.load();
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
      <button class="btn ghost" id="analyze">🎧 Analyze BPM/key/energy</button>
      <label class="hint"><input type="checkbox" id="auto-order" ${AUTO_ORDER ? 'checked' : ''}> Auto-order new songs</label>
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
      <div class="meta"><div class="title">${esc(s.title)}</div><div class="artist">${esc(s.artist || '')} <span class="by">· ${s.birthday ? '🎂 ' : ''}${esc(s.submitted_by_name)}${s.is_wildcard ? ' · 🦇' : ''}</span></div></div>
      <input data-bpm="${s.id}" value="${esc(s.bpm ?? '')}" placeholder="BPM" inputmode="decimal">
      <input data-key="${s.id}" value="${esc(s.camelot ?? '')}" placeholder="Key" class="key-pill">
      <select data-vibe="${s.id}" class="vibe-sel" title="Vibe">${Object.entries(VIBES).map(([k, v]) => `<option value="${k}" ${s.vibe === k ? 'selected' : ''}>${v.label}</option>`).join('')}${s.vibe ? '' : '<option selected value="">? vibe</option>'}</select>
      <span class="energy-pill" title="Energy 1–10">⚡${s.energy ?? '–'}</span>
      <span class="votes-col">▲ ${voteCount(s)} · 💀 ${downCount(s)}</span>
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
  $('analyze')?.addEventListener('click', () => analyzeMissing(true));
  $('auto-order')?.addEventListener('change', (e) => { AUTO_ORDER = e.target.checked; localStorage.setItem('spooky-auto-order', AUTO_ORDER ? '1' : '0'); if (AUTO_ORDER) autoOrder(true); });
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
      <div class="by">by <b>${esc(s.submitted_by_name)}</b> · ▲ ${voteCount(s)} · 💀 ${downCount(s)} · ${new Date(s.created_at).toLocaleString()}</div>
      <div class="chips">${links(s)}</div></div>
    <div class="acts" style="display:flex;gap:6px;flex-wrap:wrap">${actions}</div>
  </div>`;
}

function paneWild() {
  const list = songs.filter(s => s.status === 'pending');
  const blessedBy = (dev) => songs.filter(s => s.submitted_by_device === dev && s.is_wildcard && s.status === 'approved').length;
  const groups = {};
  for (const s of list) (groups[s.submitted_by_device] ||= []).push(s);
  const order = Object.values(groups).sort((a, b) => b.length - a.length);
  const LIM = CONFIG.WILD_BLESS || 3;
  $('pane').innerHTML = `<p class="hint">After 5 songs, guests can send as many wildcards as they like. You bless up to ${LIM} per guest — bury the rest.</p>` +
    (order.map(g => {
      const n = blessedBy(g[0].submitted_by_device), full = n >= LIM;
      g.sort((a, b) => voteCount(b) - voteCount(a));
      return `<h3 class="wild-who">${esc(g[0].submitted_by_name)} <span class="dim">· ${n}/${LIM} blessed${full ? ' — full' : ''}</span></h3><div class="list">` +
        g.map(s => songRow(s, `<button class="btn small bless" data-status="approved" data-id2="${s.id}" ${full ? 'disabled title="Already blessed ' + LIM + '"' : ''}>Bless ●</button><button class="btn small bury" data-status="graveyard" data-id2="${s.id}">Bury ●</button>`)).join('') + '</div>';
    }).join('') || '<p class="empty">No wildcards waiting 🕯️</p>');
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
    <tr><th>Song</th><th>Status</th><th>▲</th><th>💀</th><th>Summoned by</th><th>Upvoted by</th><th>Links</th><th>BPM</th><th>Key</th><th>When</th></tr>
    ${rows.map(s => `<tr><td><b>${s.birthday ? '🎂 ' : ''}${esc(s.title)}</b><br><span class="dim" style="margin:0">${esc(s.artist || '')}</span></td>
      <td><span class="status ${s.status}">${s.status === 'pending' ? 'wildcard' : s.status}</span>${s.is_wildcard && s.status === 'approved' ? ' 🦇' : ''}</td>
      <td>${voteCount(s)}</td><td>${downCount(s)}</td><td>${esc(s.submitted_by_name)}</td>
      <td>${esc((s.votes || []).filter(v => v.kind === 'vote').map(v => v.name).join(', '))}</td>
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
    const removed = await spPrune();
    const moved = await spReorder();
    if (uris.length || removed || moved || !quiet) toast(`🟢 Spotify: +${uris.length} added${removed ? ` · −${removed} removed` : ''}${moved ? ' · reordered to match your set' : ''}`);
    await refresh();
  } catch (e) { toast('💀 Spotify: ' + e.message); }
  syncing = false;
}

// Make the Spotify playlist follow the set order exactly.
async function spReorder() {
  const want = setOrder().map(s => s.spotify_uri).filter(u => u && u.startsWith('spotify:track:'));
  const uniq = [...new Set(want)];
  let base = `/playlists/${SP.playlist}/items`;
  try { await sp(base + '?limit=1'); } catch (e) { if (e.status === 404 || e.status === 405) base = `/playlists/${SP.playlist}/tracks`; else throw e; }
  const have = [];
  for (let off = 0; ; off += 100) {
    const items = (await sp(`${base}?limit=100&offset=${off}`))?.items || [];
    for (const it of items) { const u = (it.track || it.item)?.uri; if (u) have.push(u); }
    if (items.length < 100) break;
  }
  if (have.join() === uniq.join()) return false;
  try { await sp(base, { method: 'PUT', body: JSON.stringify({ uris: uniq.slice(0, 100) }) }); }
  catch (e) { if (base.endsWith('/items') && (e.status === 404 || e.status === 405)) { base = `/playlists/${SP.playlist}/tracks`; await sp(base, { method: 'PUT', body: JSON.stringify({ uris: uniq.slice(0, 100) }) }); } else throw e; }
  for (let i = 100; i < uniq.length; i += 100) await sp(base, { method: 'POST', body: JSON.stringify({ uris: uniq.slice(i, i + 100) }) });
  return true;
}

// Remove anything from the Spotify playlist that is no longer in the set (buried or deleted songs).
async function spPrune() {
  const keep = new Set(setOrder().map(s => s.spotify_uri).filter(Boolean));
  let base = `/playlists/${SP.playlist}/items`, have = [];
  try { await sp(base + '?limit=1'); } catch (e) { if (e.status === 404 || e.status === 405) base = `/playlists/${SP.playlist}/tracks`; else throw e; }
  for (let off = 0; ; off += 100) {
    const page = await sp(`${base}?limit=100&offset=${off}`);
    const items = page?.items || [];
    for (const it of items) { const u = (it.track || it.item)?.uri; if (u) have.push(u); }
    if (items.length < 100) break;
  }
  const gone = [...new Set(have.filter(u => !keep.has(u) && u.startsWith('spotify:track:')))];
  for (let i = 0; i < gone.length; i += 100) {
    const chunk = gone.slice(i, i + 100).map(uri => ({ uri }));
    try { await sp(base, { method: 'DELETE', body: JSON.stringify(base.endsWith('/items') ? { items: chunk } : { tracks: chunk }) }); }
    catch (e) { if (base.endsWith('/items')) await sp(`/playlists/${SP.playlist}/tracks`, { method: 'DELETE', body: JSON.stringify({ tracks: chunk }) }); else throw e; }
  }
  // Buried songs must be re-added if they're ever resurrected.
  for (const s of songs.filter(s => s.status !== 'approved' && s.spotify_synced)) await api.djUpdate(KEY, s.id, { spotify_synced: false });
  return gone.length;
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
  if (el.dataset.vibe) await update(el.dataset.vibe, { vibe: el.value }, true);
  if (el.dataset.bpm || el.dataset.key || el.dataset.vibe) { songs = await api.load(); render(); }
});
document.addEventListener('focusout', () => setTimeout(() => { if (renderQueued) render(); }, 50));

async function refresh() {
  try { songs = await api.load(); await autoOrder(false); render(); analyzeMissing(false); if (SP.auto && SP.playlist && SP.token) spSync(true); }
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
