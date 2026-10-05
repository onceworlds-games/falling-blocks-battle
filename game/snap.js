// What a page tells the others about its board: the 22 x 10 cells as 4-bit values in a base64 string (147 characters), the falling
// piece, the hold, and a few counters. Everything arrives from other people's browsers, so parseSnap checks every field.
// Pure: no DOM.

import { COLS, ROWS } from './pieces.js';

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Int8Array(128).fill(-1);
for (let i = 0; i < ALPHA.length; i++) LOOKUP[ALPHA.charCodeAt(i)] = i;

export const CELL_COUNT = COLS * ROWS; // 220: 110 bytes, 147 characters
const BYTES = CELL_COUNT / 2;
export const ENCODED_LENGTH = Math.ceil((BYTES * 8) / 6); // 147

/** The cells (values 0-8) as a base64 string, two cells to a byte. */
export function encodeCells(cells) {
  let out = '';
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < BYTES; i++) {
    const byte = ((cells[2 * i] & 15) << 4) | (cells[2 * i + 1] & 15);
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += ALPHA[(acc >> bits) & 63];
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHA[(acc << (6 - bits)) & 63];
  return out;
}

/** Decodes into `out` (a Uint8Array of 220) and returns it, or null for anything that isn't a valid board. */
export function decodeCells(str, out = new Uint8Array(CELL_COUNT)) {
  if (typeof str !== 'string' || str.length !== ENCODED_LENGTH) return null;
  let acc = 0;
  let bits = 0;
  let n = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    const v = code < 128 ? LOOKUP[code] : -1;
    if (v < 0) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      const byte = (acc >> bits) & 255;
      acc &= (1 << bits) - 1;
      if (n < BYTES) {
        const a = byte >> 4;
        const b = byte & 15;
        if (a > 8 || b > 8) return null;
        out[2 * n] = a;
        out[2 * n + 1] = b;
        n++;
      }
    }
  }
  return n === BYTES ? out : null;
}

const int = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);

const cache = new WeakMap();

/**
 * A snapshot as it arrives (presence or the host's record of a bot), checked and decoded:
 * { cells, p: [type, rot, x, y] | null, h, ko, g, k, sn, n, tg, m } or null when the board itself is invalid. Cached per object.
 */
export function parseSnap(raw) {
  if (raw === null || typeof raw !== 'object') return null;
  const hit = cache.get(raw);
  if (hit !== undefined) return hit;
  const cells = decodeCells(raw.c);
  let out = null;
  if (cells) {
    let p = null;
    if (Array.isArray(raw.p) && raw.p.length >= 4) {
      const type = int(raw.p[0], 0, 7, 0);
      if (type >= 1) p = [type, int(raw.p[1], 0, 3, 0), int(raw.p[2], -4, 14, 0), int(raw.p[3], -4, 26, 0)];
    }
    out = {
      cells,
      p,
      h: int(raw.h, 0, 7, 0),
      ko: raw.ko ? 1 : 0,
      g: int(raw.g, 0, 99, 0),
      k: int(raw.k, 0, 99, 0),
      sn: int(raw.sn, 0, 99999, 0),
      n: int(raw.n, 0, 999999, 0),
      tg: int(raw.tg, -1, 11, -1),
      m: typeof raw.m === 'string' ? raw.m.slice(0, 48) : '',
    };
  }
  cache.set(raw, out);
  return out;
}
