// VA-11 HALL-A save conversion between the PC text slots
// ("Record of Waifu Wars[N].txt") and the PS Vita container (savefile.sav,
// already decrypted with VitaShell "Open decrypted").
//
// PC slot: one value per line. Numbers carry a trailing space ("17150 "),
// strings are verbatim. Line 62 holds two values on one line: a number and a
// string ("0   mablast"). Old builds (v1.0) wrote 243 lines; later builds append
// three numbers (246 lines).
//
// Vita container: GameMaker INI. Section [data], keys "0".."29"; each slot key
// stores a whole INI as an escaped string ("\r\n" -> "^r", '"' -> "^q") whose
// keys "0".."246" are the slot values in PC order, numbers formatted "%.6f".
// Key 29 holds the Vita preferences. The file is NUL-padded to 4096 bytes.

export const SLOT_VALUES = 247;
export const PC_SLOTS = 24;
export const PREFS_KEY = '29';
const CONTAINER_KEYS = 30;
const SPLIT_INDEX = 61; // PC line whose number is followed by the string value 62
const V10_VALUES = 244; // values in a 243-line v1.0 PC slot
const PAD = 4096;

// n = number, s = string, for the 247 slot values (Vita order).
export const LAYOUT =
  'snnnnnnssnnnsssnsssnsssssssnsssnsssnssssnsssnssnsssnsssssnsssnssssssssnsssnsssssssssssssssssnsss' +
  'ssssnssssssssssssssssssssssssssssssssssssssssssssssssssssssssnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn' +
  'nnnnnnnnnnnnnnnnnnnnnnnnnnnnssssssssssssnnnnnnnnnnnnnnn';

if (LAYOUT.length !== SLOT_VALUES) throw new Error('LAYOUT length mismatch');

export class SaveError extends Error {}

const NUM = /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i;
const FORBIDDEN = /[\r\n"^]/;

const decoder = new TextDecoder('utf-8', { fatal: false });
const encoder = new TextEncoder();

/** Slot number from "Record of Waifu Wars[N].txt" (any case), or null. */
export function pcSlotNumber(fileName) {
  const m = /record of waifu wars\s*\[(\d+)\]\.txt$/i.exec(fileName.trim());
  return m ? Number(m[1]) : null;
}

export function isPcPreferences(fileName) {
  return /waifu preferences\.txt$/i.test(fileName.trim());
}

function vitaNumber(token, where) {
  if (!NUM.test(token)) throw new SaveError(`${where}: expected a number, found "${token}"`);
  const n = Number(token);
  if (!Number.isFinite(n)) throw new SaveError(`${where}: number out of range "${token}"`);
  return n.toFixed(6);
}

function pcNumber(value, where) {
  const n = Number(value);
  if (!NUM.test(value) || !Number.isFinite(n)) {
    throw new SaveError(`${where}: expected a number, found "${value}"`);
  }
  return String(n);
}

function checkString(value, where) {
  if (FORBIDDEN.test(value)) throw new SaveError(`${where}: text contains unsupported characters`);
  return value;
}

/** PC slot text -> 247 Vita-formatted values. */
export function parsePcSlot(text, label = 'PC') {
  let lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  if (lines.length !== V10_VALUES - 1 && lines.length !== SLOT_VALUES - 1) {
    throw new SaveError(`${label}: ${lines.length} lines; a PC save has 243 or 246`);
  }
  const values = [];
  lines.forEach((line, i) => {
    const where = `${label}, line ${i + 1}`;
    const kind = LAYOUT[values.length];
    if (i === SPLIT_INDEX) {
      const m = /^(\S+)(?: (.*))?$/s.exec(line);
      if (!m) throw new SaveError(`${where}: unexpected format`);
      values.push(vitaNumber(m[1], where), checkString(m[2] ?? '', where));
    } else if (kind === 'n') {
      values.push(vitaNumber(line.trim(), where));
    } else {
      values.push(checkString(line, where));
    }
  });
  // v1.0 slots lack the three trailing numbers that later builds append; pad
  // with 0 so every slot has the 247 values of the Vita layout.
  while (values.length < SLOT_VALUES) values.push((0).toFixed(6));
  return values;
}

/** 247 Vita-formatted values -> PC slot text (246 lines, CRLF). */
export function formatPcSlot(values, label = 'Vita') {
  const lines = [];
  for (let i = 0; i < SLOT_VALUES; i++) {
    const where = `${label}, valor ${i}`;
    if (i === SPLIT_INDEX) {
      lines.push(`${pcNumber(values[i], where)} ${values[i + 1]}`);
      i++;
    } else if (LAYOUT[i] === 'n') {
      lines.push(`${pcNumber(values[i], where)} `);
    } else {
      lines.push(values[i]);
    }
  }
  return lines.join('\r\n') + '\r\n';
}

function unquote(v) {
  return v.length >= 2 && v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v;
}

/** Parse a decrypted Vita savefile.sav -> ordered [key, rawValue] pairs. */
export function parseVitaContainer(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const nul = u8.indexOf(0);
  const text = decoder.decode(nul === -1 ? u8 : u8.subarray(0, nul));
  const lines = text.split('\r\n');
  if (lines[0] !== '[data]') {
    throw new SaveError('Not a decrypted VA-11 HALL-A savefile.sav (the [data] header is missing). Did you copy it via "Open decrypted"?');
  }
  const pairs = [];
  for (const line of lines.slice(1)) {
    if (line === '') continue;
    const eq = line.indexOf('=');
    if (eq < 1) throw new SaveError(`Unexpected line in savefile.sav: "${line.slice(0, 40)}"`);
    pairs.push([line.slice(0, eq), unquote(line.slice(eq + 1))]);
  }
  return pairs;
}

/** Escaped slot string -> ordered [key, value] pairs. */
function parseInner(raw) {
  if (raw === '') return [];
  const parts = raw.split('^r');
  if (parts[0] !== '[data]') throw new SaveError('Slot has an unexpected format');
  const items = [];
  for (const part of parts.slice(1)) {
    if (part === '') continue;
    const eq = part.indexOf('=');
    if (eq < 1) throw new SaveError('Slot has an unexpected format');
    const v = part.slice(eq + 1);
    items.push([part.slice(0, eq), v.startsWith('^q') && v.endsWith('^q') && v.length >= 4 ? v.slice(2, -2) : v]);
  }
  return items;
}

function serializeInner(items) {
  return '[data]^r' + items.map(([k, v]) => `${k}=^q${v}^q^r`).join('');
}

/** Raw slot string -> 247 values, or null if the slot is empty. */
export function slotValues(raw, label) {
  const items = parseInner(raw);
  if (items.length === 0) return null;
  const map = new Map(items);
  const values = [];
  for (let i = 0; i < SLOT_VALUES; i++) {
    if (!map.has(String(i))) throw new SaveError(`${label}: value ${i} is missing`);
    values.push(map.get(String(i)));
  }
  return values;
}

export function slotRaw(values) {
  return serializeInner(values.map((v, i) => [String(i), v]));
}

export function serializeVitaContainer(pairs) {
  const body = encoder.encode('[data]\r\n' + pairs.map(([k, v]) => `${k}="${v}"\r\n`).join(''));
  const out = new Uint8Array(Math.ceil(body.length / PAD) * PAD);
  out.set(body);
  return out;
}

/** Short description of a slot for listings. */
export function describe(values) {
  return { saved: values[0], day: values[7], place: values[8] };
}

/**
 * Merge PC slots into a decrypted Vita savefile.sav.
 * pcFiles: [{ name, text }]. mode: 'move' relocates Vita slots that would be
 * overwritten into free slots 1..24; 'overwrite' replaces them.
 * Returns { bytes, report } where report lists every slot that changed.
 */
export function pcToVita(baseBytes, pcFiles, mode = 'move') {
  const pairs = parseVitaContainer(baseBytes);
  const keys = new Map(pairs);
  const incoming = new Map();
  for (const f of pcFiles) {
    const n = pcSlotNumber(f.name);
    if (n === null) throw new SaveError(`"${f.name}" is not a PC save slot (Record of Waifu Wars[N].txt)`);
    if (n < 1 || n > PC_SLOTS) throw new SaveError(`"${f.name}": slot ${n} is outside 1–${PC_SLOTS}`);
    if (incoming.has(n)) throw new SaveError(`Slot ${n} appears twice`);
    incoming.set(n, parsePcSlot(f.text, f.name));
  }
  if (incoming.size === 0) throw new SaveError('No PC save slots given');

  const existing = new Map();
  for (let n = 1; n < CONTAINER_KEYS - 1; n++) {
    const v = slotValues(keys.get(String(n)) ?? '', `Vita slot ${n}`);
    if (v) existing.set(n, v);
  }

  const result = new Map(existing);
  const report = [];
  const displaced = [];
  for (const [n, values] of incoming) {
    if (existing.has(n)) displaced.push(n);
    result.set(n, values);
    report.push({ slot: n, from: `PC [${n}]`, ...describe(values), replaced: existing.has(n) && mode === 'overwrite' });
  }
  if (mode === 'move') {
    for (const n of displaced) {
      let free = 0;
      for (let s = 1; s <= PC_SLOTS; s++) {
        if (!result.has(s)) { free = s; break; }
      }
      if (!free) throw new SaveError('No free slots (1–24) left to move the Vita saves into. Pick "overwrite" or drop some PC files.');
      result.set(free, existing.get(n));
      report.push({ slot: free, from: `Vita ${n}`, ...describe(existing.get(n)), replaced: false });
    }
  }
  report.sort((a, b) => a.slot - b.slot);

  const out = pairs.map(([k, v]) => {
    const n = Number(k);
    if (n >= 1 && n < CONTAINER_KEYS - 1) return [k, result.has(n) ? slotRaw(result.get(n)) : ''];
    return [k, v];
  });
  // Slot keys the base file lacks: insert them, keeping the game's descending key order.
  let added = false;
  for (const n of result.keys()) {
    if (!keys.has(String(n))) { out.push([String(n), slotRaw(result.get(n))]); added = true; }
  }
  if (added) out.sort((a, b) => Number(b[0]) - Number(a[0]));
  return { bytes: serializeVitaContainer(out), report };
}

/**
 * Decrypted Vita savefile.sav -> PC slot files.
 * Returns { files: [{ name, text, slot, ...describe }] }.
 */
export function vitaToPc(bytes, { lowercase = false } = {}) {
  const pairs = parseVitaContainer(bytes);
  const files = [];
  for (const [k, raw] of pairs) {
    const n = Number(k);
    if (!(n >= 1 && n < CONTAINER_KEYS - 1)) continue;
    const values = slotValues(raw, `Vita slot ${n}`);
    if (!values) continue;
    const base = `Record of Waifu Wars[${n}].txt`;
    files.push({
      slot: n,
      name: lowercase ? base.toLowerCase() : base,
      text: formatPcSlot(values, `Vita slot ${n}`),
      outOfRange: n > PC_SLOTS,
      ...describe(values),
    });
  }
  if (files.length === 0) throw new SaveError('This savefile.sav has no saved games');
  files.sort((a, b) => a.slot - b.slot);
  return { files };
}
