import { pcToVita, vitaToPc, pcSlotNumber, isPcPreferences, SaveError } from './convert.js';
import { zip } from './zip.js';

const $ = (sel, root = document) => root.querySelector(sel);
const enc = new TextEncoder();

const state = { pc: new Map(), pcSkipped: [], base: null, src: null };
const urls = { pc2vita: [], vita2pc: [] };

/* ---------- tabs ---------- */
const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab, focus = true) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
  }
  if (focus) tab.focus();
}
for (const t of tabs) {
  t.addEventListener('click', () => selectTab(t));
  t.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const step = e.key === 'ArrowRight' ? 1 : tabs.length - 1;
    selectTab(tabs[(tabs.indexOf(t) + step) % tabs.length]);
  });
}

/* ---------- ingredient intake ---------- */
function li(text, cls) {
  const el = document.createElement('li');
  el.textContent = text;
  if (cls) el.className = cls;
  return el;
}

function setPcFiles(files) {
  state.pc.clear();
  state.pcSkipped = [];
  for (const f of files) {
    const n = pcSlotNumber(f.name);
    if (n !== null) state.pc.set(n, f);
    else state.pcSkipped.push(f.name);
  }
  const ul = $('#pc-chosen');
  ul.replaceChildren();
  for (const [n, f] of [...state.pc].sort((a, b) => a[0] - b[0])) ul.append(li(`[${n}] ${f.name}`));
  for (const name of state.pcSkipped) {
    ul.append(li(`${name} — ${isPcPreferences(name) ? 'settings, not converted' : 'ignored'}`, 'skip'));
  }
  $('[data-drop="pc"]').classList.toggle('filled', state.pc.size > 0);
}

async function setVitaFile(which, file) {
  state[which] = file;
  const ul = $(`#${which}-chosen`);
  ul.replaceChildren(li(`${file.name} · ${file.size} bytes`));
  $(`[data-drop="${which}"]`).classList.add('filled');
  try {
    const { files } = vitaToPc(new Uint8Array(await file.arrayBuffer()));
    ul.append(li(`decrypted OK · ${files.length} save${files.length === 1 ? '' : 's'} (slot${files.length === 1 ? '' : 's'} ${files.map((f) => f.slot).join(', ')})`));
  } catch (e) {
    ul.append(li(e instanceof SaveError ? e.message : `Could not read it: ${e.message}`, 'skip'));
  }
}

$('#pc-files').addEventListener('change', (e) => setPcFiles([...e.target.files]));
$('#pc-dir').addEventListener('change', (e) => setPcFiles([...e.target.files]));
$('#base-file').addEventListener('change', (e) => e.target.files[0] && setVitaFile('base', e.target.files[0]));
$('#src-file').addEventListener('change', (e) => e.target.files[0] && setVitaFile('src', e.target.files[0]));

async function filesFromDrop(dt) {
  // Entries must be taken synchronously, before the first await.
  const entries = [...dt.items].filter((i) => i.kind === 'file').map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (entries.length === 0) return [...dt.files];
  const out = [];
  const walk = async (entry) => {
    if (entry.isFile) {
      out.push(await new Promise((res, rej) => entry.file(res, rej)));
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        if (batch.length === 0) break;
        for (const child of batch) await walk(child);
      }
    }
  };
  for (const entry of entries) await walk(entry);
  return out;
}

for (const zone of document.querySelectorAll('[data-drop]')) {
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', async (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const files = await filesFromDrop(e.dataTransfer);
    const which = zone.dataset.drop;
    if (which === 'pc') setPcFiles(files);
    else {
      const sav = files.find((f) => /\.sav$/i.test(f.name)) ?? files[0];
      if (sav) setVitaFile(which, sav);
    }
  });
}
// A file dropped outside a zone must not navigate away from the page.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

/* ---------- output helpers ---------- */
function logger(id) {
  const pre = $(`#log-${id}`);
  pre.replaceChildren();
  const line = (text, cls) => {
    const span = document.createElement('span');
    span.textContent = `> ${text}\n`;
    if (cls) span.className = cls;
    pre.append(span);
  };
  return { ok: (t) => line(t), warn: (t) => line(t, 'warn'), err: (t) => line(t, 'err') };
}

function resetResult(id) {
  for (const u of urls[id]) URL.revokeObjectURL(u);
  urls[id] = [];
  const box = $(`#result-${id}`);
  box.hidden = false;
  $('.table-wrap', box).hidden = true;
  $('tbody', box).replaceChildren();
  $(`#dl-${id}`).hidden = true;
  return box;
}

function blobUrl(id, bytes, type) {
  const u = URL.createObjectURL(new Blob([bytes], { type }));
  urls[id].push(u);
  return u;
}

function row(cells) {
  const tr = document.createElement('tr');
  for (const c of cells) {
    const td = document.createElement('td');
    if (c instanceof Node) td.append(c);
    else if (typeof c === 'object' && c) { td.textContent = c.text; td.className = c.cls ?? ''; }
    else td.textContent = c ?? '';
    tr.append(td);
  }
  return tr;
}

function shake() {
  const g = $('.glass');
  g.classList.remove('shake');
  void g.getBoundingClientRect();
  g.classList.add('shake');
}

function fail(log, e) {
  log.err(e instanceof SaveError ? e.message : `Unexpected error: ${e.message}`);
  if (!(e instanceof SaveError)) console.error(e);
}

/* ---------- PC -> Vita ---------- */
$('#mix-pc2vita').addEventListener('click', async () => {
  const box = resetResult('pc2vita');
  const log = logger('pc2vita');
  shake();
  try {
    if (state.pc.size === 0) throw new SaveError('Missing ingredient 1: the PC saves (Record of Waifu Wars[N].txt).');
    if (!state.base) throw new SaveError('Missing ingredient 2: the decrypted savefile.sav from the Vita.');
    const mode = $('input[name="mode"]:checked').value;
    log.ok(`Mixing ${state.pc.size} PC save${state.pc.size === 1 ? '' : 's'} with ${state.base.name}…`);
    const pcFiles = await Promise.all([...state.pc.values()].map(async (f) => ({ name: f.name, text: await f.text() })));
    const base = new Uint8Array(await state.base.arrayBuffer());
    const { bytes, report } = pcToVita(base, pcFiles, mode);

    const changed = new Map(report.map((r) => [r.slot, r]));
    const all = vitaToPc(bytes).files;
    const tbody = $('tbody', box);
    for (const f of all) {
      const r = changed.get(f.slot);
      let from = { text: 'Vita (unchanged)', cls: 'from-vita' };
      if (r && r.from.startsWith('Vita')) from = { text: `Vita (was slot ${r.from.slice(5)})`, cls: 'from-vita' };
      else if (r) from = r.replaced ? { text: `${r.from} (replaces the Vita save)`, cls: 'replaced' } : r.from;
      tbody.append(row([String(f.slot), from, f.day, f.saved]));
    }
    $('.table-wrap', box).hidden = false;

    for (const r of report.filter((x) => x.from.startsWith('Vita'))) {
      log.warn(`The Vita save in slot ${r.from.slice(5)} moves to slot ${r.slot}.`);
    }
    for (const r of report.filter((x) => x.replaced)) {
      log.warn(`The Vita save in slot ${r.slot} is replaced.`);
    }
    log.ok(`Done: savefile.sav with ${all.length} save${all.length === 1 ? '' : 's'} (${bytes.length} bytes).`);
    log.ok('Paste it into the game folder opened with "Open decrypted" (steps 2 and 3).');

    const a = $('#dl-pc2vita');
    a.href = blobUrl('pc2vita', bytes, 'application/octet-stream');
    a.hidden = false;
  } catch (e) {
    fail(log, e);
  }
});

/* ---------- Vita -> PC ---------- */
$('#mix-vita2pc').addEventListener('click', async () => {
  const box = resetResult('vita2pc');
  const log = logger('vita2pc');
  shake();
  try {
    if (!state.src) throw new SaveError('Missing ingredient: the decrypted savefile.sav from the Vita.');
    log.ok(`Distilling ${state.src.name}…`);
    const { files } = vitaToPc(new Uint8Array(await state.src.arrayBuffer()), { lowercase: $('#lowercase').checked });

    const tbody = $('tbody', box);
    const zipped = [];
    for (const f of files) {
      const data = enc.encode(f.text);
      zipped.push({ name: f.name, data });
      const a = document.createElement('a');
      a.href = blobUrl('vita2pc', data, 'text/plain');
      a.download = f.name;
      a.textContent = f.name;
      const warn = f.outOfRange ? { text: 'slot > 24', cls: 'tag-warn' } : '';
      tbody.append(row([a, f.day, f.saved, warn]));
    }
    $('.table-wrap', box).hidden = false;

    const out = $('#dl-vita2pc');
    out.href = blobUrl('vita2pc', zip(zipped), 'application/zip');
    out.hidden = false;

    const high = files.filter((f) => f.outOfRange);
    if (high.length) log.warn(`Slots above 24 (${high.map((f) => f.slot).join(', ')}): the PC only shows 24.`);
    log.ok(`Done: ${files.length} file${files.length === 1 ? '' : 's'}. Unzip into the PC saves folder (step 1).`);
  } catch (e) {
    fail(log, e);
  }
});

/* ---------- Glitch City skyline and rain ---------- */
const lcg = (seed) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

function drawCity() {
  const rnd = lcg(1166);
  const W = 1600;
  const H = 220;
  const colors = ['#ff3d8b', '#29e7f2', '#ffd23f', '#b48cff'];
  const layer = (minH, maxH, fill, winRate) => {
    let x = -10;
    let blocks = '';
    let wins = '';
    while (x < W) {
      const w = 36 + Math.floor(rnd() * 90);
      const h = minH + Math.floor(rnd() * (maxH - minH));
      blocks += `<rect x="${x}" y="${H - h}" width="${w}" height="${h}"/>`;
      if (rnd() < 0.3) blocks += `<rect x="${x + Math.floor(w / 2) - 2}" y="${H - h - 18}" width="4" height="18"/>`;
      for (let wy = H - h + 8; wy < H - 6; wy += 11) {
        for (let wx = x + 6; wx < x + w - 6; wx += 9) {
          if (rnd() < winRate) wins += `<rect x="${wx}" y="${wy}" width="4" height="5" fill="${colors[Math.floor(rnd() * colors.length)]}"/>`;
        }
      }
      x += w + Math.floor(rnd() * 8);
    }
    return `<g fill="${fill}">${blocks}</g><g opacity="0.5">${wins}</g>`;
  };
  $('.city').innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice" shape-rendering="crispEdges">` +
    layer(110, 215, '#1a0c30', 0.08) + layer(40, 140, '#0b0515', 0.14) + '</svg>';
}
drawCity();

// One seamless tile of falling streaks: faded tail on top, bright head below.
// Streaks crossing the bottom edge are repeated above the top so tiles join.
function rainTile(seed, { w, h, count, width, minLen, maxLen, color }) {
  const rnd = lcg(seed);
  let drops = '';
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rnd() * (w - width));
    const y = Math.floor(rnd() * h);
    const len = minLen + Math.floor(rnd() * (maxLen - minLen));
    const op = (0.35 + rnd() * 0.65).toFixed(2);
    for (const top of y + len > h ? [y, y - h] : [y]) {
      drops += `<rect x="${x}" y="${top}" width="${width}" height="${len}" opacity="${op}"/>`;
    }
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" shape-rendering="crispEdges">` +
    `<defs><linearGradient id="d" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${color}" stop-opacity="0"/><stop offset="1" stop-color="${color}"/>` +
    `</linearGradient></defs><g fill="url(#d)">${drops}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function drawRain() {
  const rain = $('.rain');
  rain.style.setProperty('--rain-far', rainTile(74, { w: 250, h: 380, count: 34, width: 1, minLen: 8, maxLen: 20, color: '#9d86e8' }));
  rain.style.setProperty('--rain-near', rainTile(11, { w: 330, h: 520, count: 18, width: 2, minLen: 18, maxLen: 42, color: '#d6c9ff' }));
}
drawRain();
