// The renderer: the background, your board (glossy blocks, ghost piece, clear animation, garbage meter), Hold and Next, the minis of
// the other boards, and the HUD. It draws a "scene" (see main.js and poster.js build one): the same code puts the live game and
// the store pictures on screen. Browser code, but nothing runs at import.

import { CELLS, COLS, HIDDEN, ROWS, SHAPES } from './pieces.js';
import { ACCENT, FONT, INK, PIECE_COLORS, TAU, clamp, drawBlock, easeOutBack, fit, rgba, shade, text } from './gfx.js';
import { drawHead } from './avatars.js';
import { ordinal } from './rules.js';

const CLEAR_FLASH = 0.12; // s the cleared rows flash white
const CLEAR_DROP = 0.2; // s the rows above take to fall (with a small bounce)
export const KO_GREY = '#39415a';

const setFont = (ctx, size, weight = 800, italic = false) => {
  ctx.font = `${italic ? 'italic ' : ''}${weight} ${Math.max(1, size)}px ${FONT}`;
};

// ---------------------------------------------------------------- background
let shapes = null;
function makeShapes() {
  // a fixed set of big soft polygons at different depths (a little pseudo-random, but always the same)
  let s = 12345;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const out = [];
  for (let i = 0; i < 20; i++) {
    out.push({ x: rnd(), y: rnd(), r: 0.05 + rnd() * 0.13, sides: [3, 4, 6, 4][i % 4], rot: rnd() * TAU, vrot: (rnd() - 0.5) * 0.12, depth: 0.25 + rnd() * 0.75, speed: 0.004 + rnd() * 0.012, hue: i % 3 });
  }
  return out;
}

function drawBackground(ctx, Sc) {
  const { w, h } = Sc;
  if (!shapes) shapes = makeShapes();
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#040a22');
  g.addColorStop(0.55, '#07163c');
  g.addColorStop(1, '#0a2252');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const t = Sc.time;
  const m = Math.min(w, h);
  const pulse = Sc.reduced ? 0 : Sc.pulse;
  const stride = Sc.q < 0.5 ? 2 : 1; // low quality draws half of the drifting shapes
  for (let k = 0; k < shapes.length; k += stride) {
    const s = shapes[k];
    const px = (((s.x + t * s.speed * s.depth) % 1.3) + 1.3) % 1.3;
    const x = (px - 0.15) * w;
    const y = (s.y + Math.sin(t * 0.2 * s.depth + s.x * 9) * 0.02) * h;
    const r = s.r * m * (1 + 0.06 * pulse * s.depth);
    const rot = s.rot + (Sc.reduced ? 0 : t * s.vrot);
    ctx.beginPath();
    for (let i = 0; i < s.sides; i++) {
      const a = rot + (i / s.sides) * TAU;
      const px2 = x + Math.cos(a) * r;
      const py2 = y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px2, py2);
      else ctx.lineTo(px2, py2);
    }
    ctx.closePath();
    const a = 0.035 + 0.05 * s.depth + 0.035 * pulse * s.depth;
    ctx.fillStyle = s.hue === 0 ? `rgba(70,130,255,${a})` : s.hue === 1 ? `rgba(60,210,255,${a * 0.8})` : `rgba(150,110,255,${a * 0.8})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(120,200,255,${a * 1.5})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  // a soft light from the middle where the board is
  const cx = w / 2;
  const cy = h * 0.52;
  const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.6);
  rg.addColorStop(0, `rgba(40,110,255,${0.16 + 0.05 * pulse})`);
  rg.addColorStop(1, 'rgba(40,110,255,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, w, h);
}

// ---------------------------------------------------------------- pieces in boxes
/** A piece (state 0) centred in a box, with blocks of `s` px. */
function drawPieceIn(ctx, Sc, type, cx, cy, s, alpha = 1) {
  if (!type) return;
  const cells = SHAPES[type][0];
  let x0 = 9;
  let x1 = -9;
  let y0 = 9;
  let y1 = -9;
  for (const [x, y] of cells) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const ox = cx - ((x1 - x0 + 1) * s) / 2 - x0 * s;
  const oy = cy - ((y1 - y0 + 1) * s) / 2 - y0 * s;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * alpha;
  for (const [x, y] of cells) drawBlock(ctx, ox + x * s, oy + y * s, s, type, Sc.pr, Sc.busy);
  ctx.globalAlpha = prev;
}

function panel(ctx, x, y, w, h, accent, strength = 1) {
  ctx.fillStyle = 'rgba(4,9,26,0.78)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = rgba(accent, 0.55 * strength);
  ctx.fillRect(x, y, w, 2);
  ctx.strokeStyle = rgba(accent, 0.25 * strength);
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function drawHold(ctx, Sc, v) {
  const { hold, c } = Sc.L;
  panel(ctx, hold.x, hold.y, hold.w, hold.h, ACCENT);
  if (Sc.labels !== false) text(ctx, 'HOLD', hold.x + hold.w / 2, hold.y + c * 0.62, Math.max(10, c * 0.6), { align: 'center', color: '#9fc4ff', outline: 0 });
  if (v.hold) drawPieceIn(ctx, Sc, v.hold, hold.x + hold.w / 2, hold.y + hold.h * 0.64, c * 0.78, v.canHold ? 1 : 0.32);
}

function drawNext(ctx, Sc, v) {
  const { next, c } = Sc.L;
  panel(ctx, next.x, next.y, next.w, next.h, ACCENT);
  if (Sc.labels !== false) text(ctx, 'NEXT', next.x + next.w / 2, next.y + c * 0.62, Math.max(10, c * 0.6), { align: 'center', color: '#9fc4ff', outline: 0 });
  let y = next.y + c * 2.4;
  for (let i = 0; i < 5; i++) {
    const t = v.next ? v.next[i] : 0;
    const s = i === 0 ? c * 0.82 : c * 0.62;
    if (t) drawPieceIn(ctx, Sc, t, next.x + next.w / 2, y + (i === 0 ? c * 0.2 : 0), s, i === 0 ? 1 : 0.9);
    y += i === 0 ? c * 3.0 : c * 2.45;
  }
}

// ---------------------------------------------------------------- your board
function drawFrame(ctx, Sc, B, accent, strength = 1) {
  const pad = 6;
  ctx.fillStyle = 'rgba(4,9,26,0.82)';
  ctx.fillRect(B.x - pad, B.y - pad, B.w + 2 * pad, B.h + 2 * pad);
  ctx.fillStyle = 'rgba(1,4,14,0.6)';
  ctx.fillRect(B.x, B.y, B.w, B.h);
  // the faint grid
  const c = B.w / COLS;
  ctx.strokeStyle = 'rgba(150,190,255,0.075)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < COLS; i++) {
    ctx.moveTo(B.x + i * c + 0.5, B.y);
    ctx.lineTo(B.x + i * c + 0.5, B.y + B.h);
  }
  for (let j = 1; j < ROWS - HIDDEN; j++) {
    ctx.moveTo(B.x, B.y + j * c + 0.5);
    ctx.lineTo(B.x + B.w, B.y + j * c + 0.5);
  }
  ctx.stroke();
  // the thin glowing frame
  const pulse = Sc.reduced ? 0 : Sc.pulse;
  ctx.strokeStyle = rgba(accent, (0.1 + 0.06 * pulse) * strength);
  ctx.lineWidth = 8;
  ctx.strokeRect(B.x - 3, B.y - 3, B.w + 6, B.h + 6);
  ctx.strokeStyle = rgba(accent, 0.28 * strength);
  ctx.lineWidth = 4;
  ctx.strokeRect(B.x - 3, B.y - 3, B.w + 6, B.h + 6);
  ctx.strokeStyle = rgba(accent, 0.95 * strength);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(B.x - 2.5, B.y - 2.5, B.w + 5, B.h + 5);
}

function drawMeter(ctx, Sc, v) {
  const { meter, c } = Sc.L;
  ctx.fillStyle = 'rgba(4,9,26,0.85)';
  ctx.fillRect(meter.x, meter.y, meter.w, meter.h);
  const n = clamp(v.pending || 0, 0, 20);
  if (n > 0) {
    const flash = !Sc.reduced && n >= 4 ? 0.78 + 0.22 * Math.sin(Sc.time * 14) : 1;
    ctx.globalAlpha = flash;
    ctx.fillStyle = n >= 8 ? '#ff2d44' : '#ff5468';
    ctx.fillRect(meter.x, meter.y + meter.h - n * c, meter.w, n * c);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(meter.x, meter.y + meter.h - n * c, meter.w, Math.max(1, c * 0.12));
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = 'rgba(2,6,20,0.7)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let j = 1; j < 20; j++) {
    ctx.moveTo(meter.x, meter.y + j * c + 0.5);
    ctx.lineTo(meter.x + meter.w, meter.y + j * c + 0.5);
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,84,104,0.5)';
  ctx.strokeRect(meter.x + 0.5, meter.y + 0.5, meter.w - 1, meter.h - 1);
}

/** Per-row visual offsets (in rows) while the rows above a clear fall into place. */
function rowOffsets(a, time) {
  if (!a || !a.clear) return null;
  const k = a.clear;
  const age = time - k.t0;
  if (age >= CLEAR_FLASH + CLEAR_DROP + 0.12) {
    a.clear = null;
    return null;
  }
  const p = clamp((age - CLEAR_FLASH) / CLEAR_DROP, 0, 1);
  const e = p <= 0 ? 0 : easeOutBack(p, 1.1);
  const off = a.offs;
  for (let r = 0; r < ROWS; r++) off[r] = -k.shift[r] * (1 - e);
  return off;
}

function drawMainBoard(ctx, Sc, v) {
  const { L } = Sc;
  const B = L.board;
  const c = L.c;
  const accent = v.ko ? '#6a748f' : (v.accent ?? ACCENT);
  drawFrame(ctx, Sc, B, accent, v.glow ?? 1);
  drawMeter(ctx, Sc, v);
  const cells = v.cells;
  if (!cells) return;
  const koAge = v.ko ? v.koAge : -1;
  const offs = rowOffsets(v.anim, Sc.time);
  ctx.save();
  ctx.beginPath();
  ctx.rect(B.x, B.y, B.w, B.h);
  ctx.clip();
  // the stack
  for (let y = HIDDEN; y < ROWS; y++) {
    const oy = offs ? offs[y] * c : 0;
    for (let x = 0; x < COLS; x++) {
      const t = cells[y * COLS + x];
      if (!t) continue;
      let px = B.x + x * c;
      let py = B.y + (y - HIDDEN) * c + oy;
      if (koAge >= 0) {
        // knocked out: the stack greys and crumbles
        const k = ((x * 73 + y * 31) % 17) / 17;
        const fall = Math.max(0, koAge - 0.25 - k * 0.5);
        py += fall * fall * c * 7;
        px += (k - 0.5) * fall * c * 2.5;
        const a = clamp(1 - fall * 0.7, 0, 1) * 0.85;
        if (a > 0.02) {
          ctx.globalAlpha = a;
          drawBlock(ctx, px, py, c, 8, Sc.pr, true);
          ctx.globalAlpha = 1;
        }
        continue;
      }
      drawBlock(ctx, px, py, c, t, Sc.pr, Sc.busy);
    }
  }
  if (!v.ko) {
    const a = v.anim;
    // cleared rows flash white where they were, then vanish
    if (a && a.clear) {
      const age = Sc.time - a.clear.t0;
      if (age < CLEAR_FLASH + 0.1) {
        const f = clamp(age / (CLEAR_FLASH + 0.1), 0, 1);
        for (let i = 0; i < a.clear.rows.length; i++) {
          const y = a.clear.rows[i];
          const sq = 1 - f * 0.6;
          const hh = c * sq;
          const yy = B.y + (y - HIDDEN) * c + (c - hh) / 2;
          ctx.globalAlpha = 1 - f * f;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(B.x, yy, B.w, hh);
          ctx.globalAlpha = 0.5 * (1 - f);
          ctx.fillStyle = a.clear.color;
          ctx.fillRect(B.x, yy - c * 0.15, B.w, hh + c * 0.3);
        }
        ctx.globalAlpha = 1;
      }
    }
    const p = v.piece;
    if (p && p[0]) {
      const type = p[0];
      const s = CELLS[type][p[1]];
      // the ghost piece, outlined
      if (v.ghostY !== undefined && v.ghostY > p[3]) {
        const gy = v.ghostY;
        ctx.strokeStyle = rgba(PIECE_COLORS[type], 0.9);
        ctx.fillStyle = rgba(PIECE_COLORS[type], 0.14);
        ctx.lineWidth = Math.max(1.5, c * 0.09);
        for (let i = 0; i < 8; i += 2) {
          const gx = B.x + (p[2] + s[i]) * c;
          const gyy = B.y + (gy + s[i + 1] - HIDDEN) * c;
          ctx.fillRect(gx + 1, gyy + 1, c - 2, c - 2);
          ctx.strokeRect(gx + 1.5, gyy + 1.5, c - 3, c - 3);
        }
      }
      for (let i = 0; i < 8; i += 2) {
        const bx = B.x + (p[2] + s[i]) * c;
        const by = B.y + (p[3] + s[i + 1] - HIDDEN) * c;
        drawBlock(ctx, bx, by, c, type, Sc.pr, Sc.busy);
      }
      // a little shine on the falling piece while it rests (lock delay)
      if (v.resting > 0) {
        ctx.globalAlpha = 0.18 * v.resting;
        ctx.fillStyle = '#ffffff';
        for (let i = 0; i < 8; i += 2) ctx.fillRect(B.x + (p[2] + s[i]) * c, B.y + (p[3] + s[i + 1] - HIDDEN) * c, c, c);
        ctx.globalAlpha = 1;
      }
    }
    // the cells that just locked glow white for a moment
    if (a && a.lock) {
      const age = Sc.time - a.lock.t0;
      if (age < 0.14) {
        ctx.globalAlpha = (1 - age / 0.14) * 0.7;
        ctx.fillStyle = '#ffffff';
        const lc = a.lock.cells;
        for (let i = 0; i < lc.length; i += 2) ctx.fillRect(B.x + lc[i] * c, B.y + (lc[i + 1] - HIDDEN) * c, c, c);
        ctx.globalAlpha = 1;
      } else a.lock = null;
    }
  }
  ctx.restore();
  if (v.ko) {
    ctx.fillStyle = 'rgba(30,6,16,0.35)';
    ctx.fillRect(B.x, B.y, B.w, B.h);
  }
}

// ---------------------------------------------------------------- the other boards
function drawMini(ctx, Sc, v, slot) {
  const { bx, by, bw, bh, mc, lh } = slot;
  const color = v.color;
  const ko = v.ko;
  // name tag: head, name, ready mark
  const hr = lh / 2 - 0.5;
  drawHead(ctx, v.id, v.name, color, slot.x + 3 + hr, slot.y + lh / 2, hr, v.bot);
  setFont(ctx, Math.max(9, lh * 0.74));
  const nameX = slot.x + 3 + hr * 2 + 4;
  const room = slot.w - (nameX - slot.x) - (v.ready ? lh * 0.9 : 0) - 2;
  const label = fit(ctx, String(v.name ?? '').toUpperCase(), room);
  if (Sc.labels !== false) text(ctx, label, nameX, slot.y + lh / 2 + 0.5, Math.max(9, lh * 0.74), { color: ko ? '#7d87a3' : '#ffffff', outline: 0.14 });
  if (v.ready) {
    const rx = slot.x + slot.w - lh * 0.42;
    ctx.beginPath();
    ctx.arc(rx, slot.y + lh / 2, lh * 0.36, 0, TAU);
    ctx.fillStyle = '#31d67b';
    ctx.fill();
    ctx.strokeStyle = '#04200f';
    ctx.lineWidth = Math.max(1.5, lh * 0.12);
    ctx.beginPath();
    ctx.moveTo(rx - lh * 0.17, slot.y + lh / 2);
    ctx.lineTo(rx - lh * 0.04, slot.y + lh / 2 + lh * 0.14);
    ctx.lineTo(rx + lh * 0.2, slot.y + lh / 2 - lh * 0.14);
    ctx.stroke();
  }
  // the board
  ctx.fillStyle = 'rgba(3,8,22,0.82)';
  ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
  const cells = v.cells;
  const gap = mc > 3.2 ? 0.7 : 0;
  if (cells) {
    for (let y = HIDDEN; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const t = cells[y * COLS + x];
        if (!t) continue;
        ctx.fillStyle = ko ? KO_GREY : PIECE_COLORS[t];
        ctx.fillRect(bx + x * mc, by + (y - HIDDEN) * mc, mc - gap, mc - gap);
      }
    }
    const p = v.piece;
    if (p && p[0] && !ko) {
      const s = CELLS[p[0]][p[1]];
      ctx.fillStyle = shade(PIECE_COLORS[p[0]], 0.25);
      const pxo = v.dx ?? p[2];
      const pyo = v.dy ?? p[3];
      for (let i = 0; i < 8; i += 2) {
        const yy = pyo + s[i + 1] - HIDDEN;
        if (yy > -1) ctx.fillRect(bx + (pxo + s[i]) * mc, by + yy * mc, mc - gap, mc - gap);
      }
    }
  }
  // incoming garbage as a red bar on the left edge
  if (v.pending > 0 && !ko) {
    ctx.fillStyle = '#ff4a5e';
    ctx.fillRect(bx - 2, by + bh - Math.min(20, v.pending) * mc, 2, Math.min(20, v.pending) * mc);
  }
  // the frame: their colour; red and pulsing when they are sending garbage my way
  const pulse = Sc.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(Sc.time * 7);
  // a stack nearly at the top: a red glow along it (they are about to go)
  if (cells && !ko) {
    let high = false;
    for (let i = HIDDEN * COLS; i < (HIDDEN + 4) * COLS && !high; i++) high = cells[i] !== 0;
    if (high) {
      ctx.fillStyle = `rgba(255,59,78,${0.18 + 0.22 * pulse})`;
      ctx.fillRect(bx - 2, by - 2, bw + 4, Math.max(4, mc * 4));
      ctx.fillStyle = `rgba(255,59,78,${0.6 + 0.4 * pulse})`;
      ctx.fillRect(bx - 2, by - 2, bw + 4, 2);
    }
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(ko ? '#586179' : color, ko ? 0.5 : 0.55);
  ctx.strokeRect(bx - 2.5, by - 2.5, bw + 5, bh + 5);
  if (v.hot && !ko) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(255,59,78,${0.55 + 0.4 * pulse})`;
    ctx.strokeRect(bx - 3.5, by - 3.5, bw + 7, bh + 7);
    // an arrow toward my board
    const dir = slot.side === 'L' ? 1 : -1;
    const ax = slot.side === 'L' ? bx + bw + 3 : bx - 3;
    const ay = by + bh / 2;
    ctx.fillStyle = '#ff3b4e';
    ctx.beginPath();
    ctx.moveTo(ax, ay - 5);
    ctx.lineTo(ax + dir * 7, ay);
    ctx.lineTo(ax, ay + 5);
    ctx.closePath();
    ctx.fill();
  }
  if (v.target && !ko) {
    // brackets: my attacks go here
    const L2 = Math.max(6, bw * 0.28);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#ffe14d';
    const x0 = bx - 4;
    const y0 = by - 4;
    const x1 = bx + bw + 4;
    const y1 = by + bh + 4;
    ctx.beginPath();
    ctx.moveTo(x0, y0 + L2);
    ctx.lineTo(x0, y0);
    ctx.lineTo(x0 + L2, y0);
    ctx.moveTo(x1 - L2, y0);
    ctx.lineTo(x1, y0);
    ctx.lineTo(x1, y0 + L2);
    ctx.moveTo(x1, y1 - L2);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x1 - L2, y1);
    ctx.moveTo(x0 + L2, y1);
    ctx.lineTo(x0, y1);
    ctx.lineTo(x0, y1 - L2);
    ctx.stroke();
  }
  // knockouts this player has scored
  if (v.kos > 0) {
    const r = Math.max(7, lh * 0.5);
    const kx = bx + bw - r * 0.2;
    const ky = by + bh - r * 0.2;
    ctx.beginPath();
    ctx.arc(kx, ky, r, 0, TAU);
    ctx.fillStyle = '#ff3b4e';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = INK;
    ctx.stroke();
    text(ctx, String(v.kos), kx, ky + 0.5, r * 1.25, { align: 'center', outline: 0 });
  }
  // knocked out: KO and the place they finished
  if (ko) {
    const f = clamp(v.koAge / 0.35, 0, 1);
    if (f < 1 && !Sc.reduced) {
      ctx.globalAlpha = (1 - f) * 0.7;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = 'rgba(14,4,12,0.45)';
    ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
    const pop = easeOutBack(v.koAge / 0.25, 2.5);
    text(ctx, 'KO', bx + bw / 2, by + bh * 0.4, Math.max(11, bw * 0.46) * pop, { align: 'center', color: '#ff4a5e', italic: true, weight: 900, outline: 0.2 });
    if (v.place) text(ctx, ordinal(v.place), bx + bw / 2, by + bh * 0.4 + Math.max(11, bw * 0.46) * 0.8, Math.max(9, bw * 0.3), { align: 'center', color: '#dfe7ff', outline: 0.16 });
  }
}

// ---------------------------------------------------------------- HUD
export function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function drawHud(ctx, Sc) {
  const hud = Sc.hud;
  if (!hud) return;
  const { w, L } = Sc;
  const c = L.c;
  const big = clamp(c * 0.95, 18, 32);
  // time and level, top centre
  const cx = w / 2;
  text(ctx, fmtTime(hud.time), cx, 22, big, { align: 'center', outline: 0.18 });
  const bw = clamp(c * 6, 70, 150);
  ctx.fillStyle = 'rgba(4,9,26,0.8)';
  ctx.fillRect(cx - bw / 2, 42, bw, 5);
  ctx.fillStyle = hud.levelFrac > 0.85 && !Sc.reduced ? '#ffe14d' : ACCENT;
  ctx.fillRect(cx - bw / 2, 42, bw * clamp(hud.levelFrac, 0, 1), 5);
  text(ctx, `LV ${hud.level}`, cx + bw / 2 + 8, 44, Math.max(11, c * 0.55), { color: '#9fc4ff', outline: 0.14 });
  // who is left, top right
  const pw = clamp(c * 7.2, 128, 210);
  const px = w - pw - 10;
  panel(ctx, px, 8, pw, 40, hud.alive <= 3 ? '#ff4a5e' : ACCENT);
  text(ctx, 'ALIVE', px + 10, 20, Math.max(10, c * 0.5), { color: '#9fc4ff', outline: 0 });
  text(ctx, String(hud.alive), px + 10, 36, 22, { outline: 0.14 });
  text(ctx, `/${hud.total}`, px + 10 + String(hud.alive).length * 13 + 4, 38, 13, { color: '#9fc4ff', outline: 0.1 });
  text(ctx, 'KO', px + pw - 52, 20, Math.max(10, c * 0.5), { color: '#9fc4ff', outline: 0 });
  text(ctx, String(hud.kos), px + pw - 52, 36, 22, { color: hud.kos > 0 ? '#ff6b7d' : '#ffffff', outline: 0.14 });
  if (hud.label) text(ctx, hud.label, cx, 64, Math.max(12, c * 0.6), { align: 'center', color: '#ffe14d', outline: 0.16 });
}

/** Under Hold: lines cleared, the combo and back-to-back while they last. */
function drawStats(ctx, Sc, v) {
  const hud = Sc.hud;
  if (!hud) return;
  const { hold, c } = Sc.L;
  let y = hold.y + hold.h + c * 0.9;
  const x = hold.x;
  const size = Math.max(10, c * 0.62);
  text(ctx, 'LINES', x, y, Math.max(10, size * 0.85), { color: '#9fc4ff', outline: 0 });
  text(ctx, String(hud.lines), x + hold.w, y, size * 1.15, { align: 'right' });
  y += c * 1.5;
  if (hud.combo >= 1) {
    text(ctx, `COMBO ×${hud.combo}`, x, y, size * 1.05, { color: '#ffe14d', italic: true, weight: 900 });
    y += c * 1.4;
  }
  if (hud.b2b) text(ctx, 'B2B', x, y, size * 1.05, { color: '#ff9f2b', italic: true, weight: 900 });
}

/** Under Next: who my attacks go to. */
function drawTarget(ctx, Sc) {
  const hud = Sc.hud;
  if (!hud || !hud.target) return;
  const { next, c } = Sc.L;
  const t = hud.target;
  const y = next.y + next.h + c * 0.7;
  const r = Math.max(8, c * 0.55);
  text(ctx, hud.revenge ? 'REVENGE' : 'TARGET', next.x, y, Math.max(10, c * 0.5), { color: hud.revenge ? '#ff6b7d' : '#ffe14d', outline: 0 });
  drawHead(ctx, t.id, t.name, t.color, next.x + r, y + r + c * 0.5, r, t.bot);
  setFont(ctx, Math.max(10, c * 0.62));
  text(ctx, fit(ctx, String(t.name ?? '').toUpperCase(), next.w - r * 2 - 6), next.x + r * 2 + 6, y + r + c * 0.5, Math.max(10, c * 0.62), { outline: 0.14 });
}

// ---------------------------------------------------------------- the whole scene
export function renderScene(ctx, Sc) {
  const { w, h, L } = Sc;
  drawBackground(ctx, Sc);
  const sk = Sc.shake ?? { x: 0, y: 0 };
  ctx.save();
  ctx.translate(sk.x, sk.y);
  // the other boards
  for (let i = 0; i < L.slots.length; i++) {
    const slot = L.slots[i];
    const v = Sc.minis[i];
    if (slot && v) drawMini(ctx, Sc, v, slot);
  }
  const m = Sc.main;
  if (m) {
    drawHold(ctx, Sc, m);
    drawNext(ctx, Sc, m);
    drawMainBoard(ctx, Sc, m);
  }
  ctx.restore();
  if (m) {
    drawStats(ctx, Sc, m);
    drawTarget(ctx, Sc);
  }
  drawHud(ctx, Sc);
  if (Sc.danger > 0 && !Sc.reduced) {
    const a = Sc.danger * (0.12 + 0.1 * Math.sin(Sc.time * 8));
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, `rgba(255,40,70,${a})`);
    g.addColorStop(0.18, 'rgba(255,40,70,0)');
    g.addColorStop(0.82, 'rgba(255,40,70,0)');
    g.addColorStop(1, `rgba(255,40,70,${a})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.save();
  ctx.translate(sk.x, sk.y);
  Sc.fx.draw(ctx);
  ctx.restore();
  const B = L.board;
  Sc.fx.drawCallouts(ctx, B.x + B.w / 2, B.y + B.h * 0.36, L.c);
  Sc.fx.drawFlash(ctx, w, h);
}

export { drawPieceIn, panel };
