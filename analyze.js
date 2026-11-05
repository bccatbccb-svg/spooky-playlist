// Analyze a song's 30s iTunes preview in the browser: BPM, Camelot key, energy (1–10).
// No external service needed — the audio is decoded and measured right here.

const SR = 22050;

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

function spectra(x, size, hop) {
  const win = new Float32Array(size).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / size));
  const out = [];
  for (let s = 0; s + size <= x.length; s += hop) {
    const re = new Float32Array(size), im = new Float32Array(size);
    for (let i = 0; i < size; i++) re[i] = x[s + i] * win[i];
    fft(re, im);
    const mag = new Float32Array(size / 2);
    for (let i = 0; i < size / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
    out.push(mag);
  }
  return out;
}

function detectBpm(x) {
  const size = 1024, hop = 256, fps = SR / hop;
  const S = spectra(x, size, hop);
  const flux = new Float32Array(S.length);
  for (let t = 1; t < S.length; t++) {
    let f = 0;
    for (let i = 1; i < 200; i++) { const d = Math.log1p(S[t][i] * 10) - Math.log1p(S[t - 1][i] * 10); if (d > 0) f += d; }
    flux[t] = f;
  }
  // remove slow trend
  const w = 16, env = new Float32Array(flux.length);
  for (let t = 0; t < flux.length; t++) {
    let m = 0, c = 0;
    for (let k = Math.max(0, t - w); k < Math.min(flux.length, t + w); k++) { m += flux[k]; c++; }
    env[t] = Math.max(0, flux[t] - m / c);
  }
  let best = 0, bestBpm = 120;
  for (let bpm = 70; bpm <= 180; bpm += 0.5) {
    const lag = fps * 60 / bpm;
    let sc = 0;
    for (const mult of [1, 2, 4]) {
      const L = lag * mult, l0 = Math.floor(L), fr = L - l0;
      let s = 0;
      for (let t = 0; t + l0 + 1 < env.length; t++) s += env[t] * (env[t + l0] * (1 - fr) + env[t + l0 + 1] * fr);
      sc += s / mult;
    }
    sc *= Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2)); // mild preference for dance tempos
    if (sc > best) { best = sc; bestBpm = bpm; }
  }
  let bpm = bestBpm;
  while (bpm < 85) bpm *= 2;
  while (bpm > 175) bpm /= 2;
  return { bpm: Math.round(bpm), flux: env, fps };
}

const MAJ_P = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MIN_P = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
function corr(a, b) {
  const ma = a.reduce((s, v) => s + v, 0) / 12, mb = b.reduce((s, v) => s + v, 0) / 12;
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < 12; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return n / Math.sqrt(da * db || 1);
}
function detectKey(x) {
  const size = 8192, S = spectra(x, size, 4096);
  const chroma = new Float64Array(12);
  for (const mag of S) {
    const frame = new Float64Array(12);
    for (let i = 1; i < size / 2; i++) {
      const f = i * SR / size;
      if (f < 60 || f > 2500) continue;
      const pc = ((Math.round(12 * Math.log2(f / 440)) % 12) + 12 + 9) % 12; // 0 = C
      frame[pc] += mag[i] * mag[i];
    }
    const tot = frame.reduce((s, v) => s + v, 0) || 1;
    for (let k = 0; k < 12; k++) chroma[k] += frame[k] / tot;
  }
  let best = -2, cam = '';
  for (let r = 0; r < 12; r++) {
    const rot = (p) => p.map((_, i) => p[(i - r + 12) % 12]);
    const cMaj = corr(chroma, rot(MAJ_P)), cMin = corr(chroma, rot(MIN_P));
    if (cMaj > best) { best = cMaj; cam = ((r * 7) % 12 + 7) % 12 + 1 + 'B'; }
    if (cMin > best) { best = cMin; cam = ((r * 7) % 12 + 4) % 12 + 1 + 'A'; }
  }
  return cam;
}

function detectEnergy(x, flux, bpm) {
  let sq = 0; for (let i = 0; i < x.length; i++) sq += x[i] * x[i];
  const rmsDb = 10 * Math.log10(sq / x.length + 1e-12);
  const S = spectra(x, 2048, 2048);
  let cen = 0, n = 0;
  for (const m of S) { let a = 0, b = 0; for (let i = 1; i < m.length; i++) { a += i * m[i]; b += m[i]; } if (b > 0) { cen += a / b * SR / 2048; n++; } }
  cen /= n || 1;
  const fluxMean = flux.reduce((s, v) => s + v, 0) / (flux.length || 1);
  const norm = (v, lo, hi) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  const e = 0.4 * norm(rmsDb, -24, -9) + 0.25 * norm(cen, 1200, 3200) + 0.2 * norm(fluxMean, 0.5, 4) + 0.15 * norm(bpm, 90, 135);
  return Math.max(1, Math.min(10, Math.round(1 + e * 9)));
}

export async function findPreviewUrl(artist, title) {
  const clean = (s) => String(s || '').replace(/\(.*?\)|\[.*?\]/g, '').replace(/feat\..*$/i, '').trim();
  const r = await fetch('https://itunes.apple.com/search?entity=song&limit=5&term=' + encodeURIComponent(`${clean(artist).split(/,|&/)[0]} ${clean(title)}`));
  const j = await r.json();
  return (j.results || []).find(x => x.previewUrl)?.previewUrl || '';
}

export async function analyzeSong(artist, title) {
  const url = await findPreviewUrl(artist, title);
  if (!url) return null;
  const buf = await (await fetch(url)).arrayBuffer();
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const decoded = await new Ctx(1, 1, SR).decodeAudioData(buf);
  const off = new Ctx(1, Math.ceil(decoded.duration * SR), SR);
  const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start();
  const x = (await off.startRendering()).getChannelData(0);
  const { bpm, flux } = detectBpm(x);
  return { bpm, camelot: detectKey(x), energy: detectEnergy(x, flux, bpm) };
}

// ---------- vibe tagging ----------
export const VIBES = {
  latin: { label: '🌶️ Latin', sprinkle: true },
  clubpop: { label: '🪩 Club pop' },
  throwback: { label: '📼 Throwback' },
  dancehall: { label: '🌴 Dancehall' },
  house: { label: '🎛️ House / Afro' },
  hiphop: { label: '🎤 Hip-hop / R&B' },
};
export async function guessVibe(artist, title) {
  const clean = (s) => String(s || '').replace(/\(.*?\)|\[.*?\]/g, '').replace(/feat\..*$/i, '').trim();
  const r = await fetch('https://itunes.apple.com/search?entity=song&limit=3&term=' + encodeURIComponent(`${clean(artist).split(/,|&/)[0]} ${clean(title)}`));
  const hit = ((await r.json()).results || [])[0];
  const g = (hit?.primaryGenreName || '').toLowerCase();
  const year = +(hit?.releaseDate || '').slice(0, 4) || 0;
  const text = `${artist} ${title}`.toLowerCase();
  if (/latin|reggaeton|urbano|salsa|bachata|cumbia|regional mexicano/.test(g) || /[áéíóúñ¿¡]/.test(text)) return 'latin';
  if (/reggae|dancehall|soca/.test(g)) return 'dancehall';
  if (/house|dance|electronic|techno|afro/.test(g)) return year && year < 2000 ? 'throwback' : 'house';
  if (year && year < 2000) return 'throwback';
  if (/hip-hop|rap|r&b|soul/.test(g)) return 'hiphop';
  return 'clubpop';
}
