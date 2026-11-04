import { safeUrl, CONFIG, DEMO, api, deviceId, resolveLink, finalize, canonicalKey, esc, toast, voteCount, downCount, CRINGE_AT, PLATFORM } from './shared.js?v=1793793557';

const $ = (id) => document.getElementById(id);
const me = deviceId();
let songs = [];
let preview = null;

$('party-name').textContent = CONFIG.PARTY_NAME;
$('party-sub').textContent = CONFIG.PARTY_SUB;
$('demo-banner').hidden = !DEMO;
document.title = '🎃 ' + CONFIG.PARTY_NAME;

const nameInput = $('name');
nameInput.value = localStorage.getItem('spooky-name') || '';
nameInput.addEventListener('input', () => { localStorage.setItem('spooky-name', nameInput.value.trim()); updateSubmit(); });
const myName = () => nameInput.value.trim();

// ---------- badges ----------
function badges(s) {
  const v = voteCount(s), out = [];
  if (downCount(s) >= CRINGE_AT) out.push('<span class="badge cringe">⚰️ Certified Cursed</span>');
  if (s.is_wildcard && s.status === 'approved') out.push('<span class="badge blessed">🦇 Blessed by the DJ</span>');
  if (v >= 5) out.push('<span class="badge cursed">🎃 Certified Banger</span>');
  else if (v >= 3) out.push('<span class="badge hit">🔥 Hit</span>');
  return out.join('');
}

function linkChips(s) {
  const order = ['soundcloud', 'spotify', 'apple', 'youtubeMusic', 'youtube'];
  const l = s.links || {};
  let html = order.filter(k => l[k]).map(k => `<a class="chip" href="${safeUrl(l[k])}" target="_blank" rel="noopener">${PLATFORM[k].icon} ${PLATFORM[k].label}</a>`).join('');
  if (!l.youtube && !l.youtubeMusic && l.youtube_search) html += `<a class="chip" href="${safeUrl(l.youtube_search)}" target="_blank" rel="noopener">${PLATFORM.youtube_search.icon} YouTube</a>`;
  return html;
}

function songCard(s, { canVote = true } = {}) {
  const v = voteCount(s);
  const mine = (s.votes || []).find(x => x.device_id === me);
  const d = downCount(s);
  const others = (s.votes || []).filter(x => x.kind === 'vote').map(x => x.name);
  const voteBtn = !canVote ? '' : mine?.kind === 'submit'
    ? `<div class="votes"><button class="vote mine" disabled title="You summoned this">${v}</button><span class="down-count" title="Cursed votes">💀 ${d}</span></div>`
    : `<div class="votes"><button class="vote ${mine?.kind === 'vote' ? 'on' : ''}" data-vote="${s.id}" title="Upvote">${v}</button><button class="down ${mine?.kind === 'down' ? 'on' : ''}" data-down="${s.id}" title="Cursed vote">💀 ${d}</button></div>`;
  return `<div class="song ${s.submitted_by_device === me ? 'yours' : ''}">
    <img class="art" src="${safeUrl(s.artwork || '')}" alt="" onerror="this.style.visibility='hidden'">
    <div class="meta">
      <div class="title">${esc(s.title)}</div>
      <div class="artist">${esc(s.artist || 'Unknown artist')}</div>
      <div class="by">summoned by <b>${esc(s.submitted_by_name)}</b>${others.length ? ` · also wanted by ${esc(others.slice(0, 4).join(', '))}${others.length > 4 ? ` +${others.length - 4}` : ''}` : ''}</div>
      <div class="chips">${badges(s)}${linkChips(s)}</div>
    </div>
    ${voteBtn}
  </div>`;
}

// ---------- render ----------
function render() {
  const q = $('search').value.trim().toLowerCase();
  const match = (s) => !q || `${s.title} ${s.artist} ${s.submitted_by_name}`.toLowerCase().includes(q);
  const byVotes = (a, b) => (voteCount(b) - downCount(b)) - (voteCount(a) - downCount(a)) || a.created_at.localeCompare(b.created_at);

  const approved = songs.filter(s => s.status === 'approved').sort(byVotes);
  const pending = songs.filter(s => s.status === 'pending').sort(byVotes);
  const grave = songs.filter(s => s.status === 'graveyard');

  $('playlist').innerHTML = approved.filter(match).map(s => songCard(s)).join('') ||
    `<p class="empty">${q ? 'Nothing matches…' : 'The crypt is empty. Be the first to summon a song 👻'}</p>`;
  $('pending-wrap').hidden = !pending.length;
  $('pending').innerHTML = pending.filter(match).map(s => songCard(s)).join('');
  $('graveyard-wrap').hidden = !grave.length;
  $('grave-count').textContent = `(${grave.length})`;
  $('graveyard').innerHTML = grave.map(s => songCard(s, { canVote: false })).join('');

  renderCounter();
  renderBoard();
  renderPreview();
}

function renderCounter() {
  const n = songs.filter(s => s.submitted_by_device === me).length;
  const auto = Math.max(0, CONFIG.AUTO_LIMIT - n);
  const wild = Math.min(CONFIG.TOTAL_LIMIT - CONFIG.AUTO_LIMIT, CONFIG.TOTAL_LIMIT - n);
  $('counter').innerHTML = auto > 0
    ? `${auto} of ${CONFIG.AUTO_LIMIT} summons left`
    : wild > 0 ? `${wild} wildcard${wild > 1 ? 's' : ''} left · DJ decides`
    : `All summons used — upvote ▲`;
  updateSubmit();
}

function renderBoard() {
  const people = {};
  for (const s of songs) {
    if (s.status === 'graveyard') continue;
    const p = people[s.submitted_by_name] ||= { name: s.submitted_by_name, songs: 0, fire: 0 };
    p.songs++; p.fire += voteCount(s) - 1;
  }
  const top = Object.values(people).sort((a, b) => (b.fire + b.songs) - (a.fire + a.songs)).slice(0, 5);
  if (!top.length) { $('board').innerHTML = ''; return; }
  const titles = ['1', '2', '3', '4', '5']; const ranks = ['Head Ghoul', 'Vampire Lord', 'Head Witch', 'Spider Queen', 'Zombie'];
  $('board').innerHTML = `<div class="card board"><div class="title-frame"><h2>Leaderboard</h2><span class="board-sub">of the Damned</span></div>
    ${top.map((p, i) => `<div class="board-row"><span>${titles[i]}</span><b>${ranks[i]}</b><span class="dim">${esc(p.name)} · ${p.songs}♪ ${p.fire}▲</span></div>`).join('')}</div>${renderCursed()}`;
}

function renderCursed() {
  const cursedSongs = songs.filter(s => downCount(s) > 0).sort((a, b) => downCount(b) - downCount(a)).slice(0, 5);
  if (!cursedSongs.length) return '';
  const ghouls = {};
  for (const s of songs) { const d = downCount(s); if (!d) continue; const g = ghouls[s.submitted_by_name] ||= { name: s.submitted_by_name, d: 0 }; g.d += d; }
  const worst = Object.values(ghouls).sort((a, b) => b.d - a.d).slice(0, 3);
  const titles = ['Worst Taste Alive', 'Cursed Soul', 'Lost Spirit'];
  return `<div class="card board cursed-board"><div class="title-frame"><h2>Most Cursed</h2><span class="board-sub">the songs the crowd fears</span></div>
    ${cursedSongs.map((s, i) => `<div class="board-row"><span>${i + 1}</span><b>${esc(s.title)}<small>${esc(s.artist)} · by ${esc(s.submitted_by_name)}</small></b><span class="dim">${downCount(s)}💀</span></div>`).join('')}
    <div class="board-sub cursed-split">Hall of Shame</div>
    ${worst.map((g, i) => `<div class="board-row"><span>${i + 1}</span><b>${titles[i]}</b><span class="dim">${esc(g.name)} · ${g.d}💀</span></div>`).join('')}</div>`;
}

// ---------- search dropdown ----------
let searchTimer, searchSeq = 0, results = [];
$('q').addEventListener('input', () => {
  clearTimeout(searchTimer);
  const term = $('q').value.trim();
  if (term.length < 2) { $('results').hidden = true; return; }
  searchTimer = setTimeout(async () => {
    const seq = ++searchSeq;
    try {
      const r = await fetch('https://itunes.apple.com/search?entity=song&limit=8&term=' + encodeURIComponent(term));
      const j = await r.json();
      if (seq !== searchSeq) return;
      const seen = new Set();
      results = (j.results || []).filter(x => { const k = canonicalKey(x.artistName, x.trackName); if (seen.has(k)) return false; seen.add(k); return true; });
      $('results').innerHTML = results.map((x, i) => {
        const dup = songs.find(s => s.canonical_key === canonicalKey(x.artistName, x.trackName));
        return `<button class="result" data-pick="${i}"><img src="${safeUrl(x.artworkUrl60)}" alt=""><span><b>${esc(x.trackName)}</b><small>${esc(x.artistName)}</small></span>${dup ? '<em>🔥 on list</em>' : ''}</button>`;
      }).join('') + `<button class="result more" data-paste="1">Not here? Paste a link below ↓</button>`;
      $('results').hidden = false;
    } catch { $('results').innerHTML = '<p class="hint" style="padding:8px">Search is resting — paste a link below instead.</p>'; $('results').hidden = false; }
  }, 300);
});
$('results').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pick],[data-paste]'); if (!b) return;
  $('results').hidden = true;
  if (b.dataset.paste) { $('link').focus(); return; }
  const x = results[+b.dataset.pick];
  preview = finalize({ platform: 'search', source_url: x.trackViewUrl, title: x.trackName, artist: x.artistName,
    artwork: (x.artworkUrl100 || '').replace(/\d+x\d+bb/, '600x600bb'), links: { apple: x.trackViewUrl }, spotify_uri: '' });
  $('q').value = `${x.trackName} — ${x.artistName}`;
  $('manual').hidden = true;
  renderPreview();
});
document.addEventListener('click', (e) => { if (!e.target.closest('.search-wrap')) $('results').hidden = true; });

// ---------- link preview ----------
let resolveTimer, resolveSeq = 0;
$('link').addEventListener('input', () => {
  clearTimeout(resolveTimer);
  preview = null; $('manual').hidden = true; renderPreview();
  const url = $('link').value.trim();
  if (!url) return;
  $('preview').innerHTML = '<p class="hint">🔮 Consulting the spirits…</p>';
  resolveTimer = setTimeout(async () => {
    const seq = ++resolveSeq;
    try {
      const info = await resolveLink(url);
      if (seq === resolveSeq) { preview = info; showFields(info, 'Look right? Fix the artist/title if needed:'); }
    } catch (e) {
      if (seq !== resolveSeq) return;
      if (e.message === 'NEEDS_MANUAL') { preview = e.info; showFields(e.info, "Couldn't read that link — type it in:"); }
      else { $('preview').innerHTML = `<p class="error">${esc(e.message)}</p>`; }
    }
  }, 400);
});

function showFields(info, msg) {
  $('manual').hidden = false;
  $('manual-msg').textContent = msg;
  $('m-artist').value = info.artist || '';
  $('m-title').value = info.title || '';
  manualUpdate();
}

function manualUpdate() {
  if (!preview) return;
  preview.artist = $('m-artist').value.trim();
  preview.title = $('m-title').value.trim();
  if (preview.title) finalize(preview);
  renderPreview();
}
$('m-artist').addEventListener('input', manualUpdate);
$('m-title').addEventListener('input', manualUpdate);

function findDup() {
  if (!preview?.title) return null;
  const key = preview.canonical_key || canonicalKey(preview.artist, preview.title);
  return songs.find(s => s.canonical_key === key);
}

function renderPreview() {
  if (!preview) { if (!$('link').value.trim()) $('preview').innerHTML = ''; $('manual').hidden = true; updateSubmit(); return; }
  if (!preview.title) { $('preview').innerHTML = ''; updateSubmit(); return; }
  const dup = findDup();
  let note = '';
  if (dup?.status === 'graveyard') note = '<p class="error">🪦 This one\'s in the graveyard — the DJ buried it.</p>';
  else if (dup) note = `<p class="dup">👻 Already summoned by <b>${esc(dup.submitted_by_name)}</b> — submitting will upvote it instead (doesn't use a summon).</p>`;
  $('preview').innerHTML = `<div class="song preview">
    <img class="art" src="${safeUrl(preview.artwork || '')}" alt="" onerror="this.style.visibility='hidden'">
    <div class="meta"><div class="title">${esc(preview.title)}</div><div class="artist">${esc(preview.artist || 'Unknown artist')}</div>
    <div class="chips">${linkChips(preview)}</div></div></div>${note}`;
  updateSubmit();
}

function updateSubmit() {
  $('freedl-wrap').hidden = preview?.platform !== 'soundcloud';
  const btn = $('submit');
  const n = songs.filter(s => s.submitted_by_device === me).length;
  const dup = findDup();
  btn.disabled = !myName() || !preview?.title || dup?.status === 'graveyard' || (!dup && n >= CONFIG.TOTAL_LIMIT);
  btn.textContent = !myName() ? 'Enter your name first' : dup ? 'Upvote it instead' : n >= CONFIG.AUTO_LIMIT ? 'Send as wildcard' : 'Summon it';
}

$('submit').addEventListener('click', async () => {
  const btn = $('submit'); btn.disabled = true;
  try {
    const dup = findDup();
    if (dup) {
      if ((dup.votes || []).some(v => v.device_id === me)) toast('You already backed this one 🔥');
      else { await api.toggleVote(myName(), dup.id); toast('Already on the list — counted as your upvote 🔥'); }
    } else {
      const song = { ...preview, free_download: $('freedl').value.trim() };
      const r = await api.submit(myName(), song);
      toast(r.result === 'wildcard' ? '🕯️ Wildcard sent to the DJ for judgment' : r.result === 'duplicate' ? 'Someone beat you to it — counted as an upvote 🔥' : '🎃 Summoned!');
    }
    $('link').value = ''; $('q').value = ''; $('freedl').value = ''; $('m-artist').value = ''; $('m-title').value = '';
    $('manual').hidden = true; preview = null;
    await refresh();
  } catch (e) { toast('💀 ' + e.message); }
  updateSubmit();
});

// ---------- votes ----------
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-vote],[data-down]'); if (!b) return;
  if (!myName()) { toast('Enter your name first 👻'); nameInput.focus(); return; }
  b.disabled = true;
  try { if (b.dataset.down) await api.toggleDown(myName(), b.dataset.down); else await api.toggleVote(myName(), b.dataset.vote); await refresh(); } catch (err) { toast('💀 ' + err.message); b.disabled = false; }
});
$('search').addEventListener('input', render);
document.querySelectorAll('[data-plat]').forEach(b => b.addEventListener('click', () => { $('link').focus(); $('link').placeholder = 'Paste your ' + b.getAttribute('aria-label') + ' link…'; }));

async function refresh() {
  try { songs = await api.load(); render(); } catch (e) { toast('💀 Could not load playlist: ' + e.message); }
}
refresh();
api.subscribe(refresh);
