// Screens drawn on the canvas: the logo, the title with one big Play button, the lobby's settings, the countdown, the goal banner,
// the "You" marker, knockout and watching overlays, and the results podium. Browser code; nothing runs at import. Every function
// that has something to tap returns its rectangle so main.js can hit-test.

import { drawHead } from './avatars.js';
import { ACCENT, FONT, INK, clamp, drawBlock, easeOut, easeOutBack, fit, rgba, shade, text } from './gfx.js';
import { ordinal } from './rules.js';

// ---------------------------------------------------------------- logo
/** "FALLING BLOCKS" over "BATTLE", with the seven colours as a row of blocks beneath. (cx, top): top centre; size: type height. */
export function drawLogo(ctx, cx, top, size, time = 0, pr = 1) {
  const s1 = size * 0.74;
  const s2 = size * 1.32;
  const y1 = top + s1 * 0.55;
  const y2 = y1 + s1 * 0.5 + s2 * 0.58;
  ctx.save();
  // an offset shadow in the accent colour, then the dark edge, then the face
  text(ctx, 'FALLING BLOCKS', cx + size * 0.05, y1 + size * 0.06, s1, { align: 'center', color: '#1b6dff', italic: true, weight: 900, outline: 0 });
  text(ctx, 'FALLING BLOCKS', cx, y1, s1, { align: 'center', color: '#ffffff', italic: true, weight: 900, outline: 0.22 });
  const g = ctx.createLinearGradient(cx - s2 * 2, y2 - s2 * 0.5, cx + s2 * 2, y2 + s2 * 0.5);
  g.addColorStop(0, '#27e6ff');
  g.addColorStop(0.55, '#4f8dff');
  g.addColorStop(1, '#b25cff');
  text(ctx, 'BATTLE', cx + size * 0.07, y2 + size * 0.08, s2, { align: 'center', color: '#0a2a8a', italic: true, weight: 900, outline: 0 });
  text(ctx, 'BATTLE', cx, y2, s2, { align: 'center', color: g, italic: true, weight: 900, outline: 0.2 });
  // the seven pieces' colours
  const bs = Math.max(8, size * 0.34);
  const gap = bs * 0.22;
  const total = 7 * bs + 6 * gap;
  const yb = y2 + s2 * 0.62;
  for (let i = 0; i < 7; i++) {
    const bob = Math.sin(time * 2.4 + i * 0.7) * bs * 0.1;
    drawBlock(ctx, cx - total / 2 + i * (bs + gap), yb + bob, bs, i + 1, pr, true);
  }
  ctx.restore();
  return { bottom: yb + bs };
}

// ---------------------------------------------------------------- title
/** The dimmed world, the logo and the Play button. Returns { play: rect }. */
export function drawTitle(ctx, Sc) {
  const { w, h, time } = Sc;
  ctx.fillStyle = 'rgba(2,6,20,0.5)';
  ctx.fillRect(0, 0, w, h);
  const size = clamp(Math.min(w * 0.075, h * 0.12), 22, 92);
  const logo = drawLogo(ctx, w / 2, h * 0.1, size, time, Sc.pr);
  const bw = clamp(w * 0.32, 210, 360);
  const bh = clamp(h * 0.15, 58, 88);
  const by = Math.max(logo.bottom + bh * 0.5, h * 0.66 - bh / 2);
  const pulse = Sc.reduced ? 0 : Math.sin(time * 3) * 0.015;
  const rect = { x: w / 2 - bw / 2, y: by, w: bw, h: bh };
  ctx.save();
  ctx.translate(w / 2, by + bh / 2);
  ctx.scale(1 + pulse, 1 + pulse);
  ctx.translate(-w / 2, -(by + bh / 2));
  ctx.fillStyle = shade(ACCENT, -0.55);
  ctx.fillRect(rect.x, rect.y + 5, bw, bh);
  ctx.fillStyle = ACCENT;
  ctx.fillRect(rect.x, rect.y, bw, bh);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(rect.x, rect.y, bw, 3);
  text(ctx, 'PLAY', w / 2, rect.y + bh * 0.5, bh * 0.52, { align: 'center', color: INK, italic: true, weight: 900, outline: 0 });
  const kh = Math.max(16, bh * 0.28);
  const kw = kh * 3.1;
  ctx.fillStyle = 'rgba(3,8,20,0.22)';
  ctx.fillRect(rect.x + bw - kw - 12, rect.y + bh / 2 - kh / 2, kw, kh);
  text(ctx, 'SPACE', rect.x + bw - kw / 2 - 12, rect.y + bh / 2 + 0.5, kh * 0.55, { align: 'center', color: INK, outline: 0 });
  ctx.restore();
  return { play: rect };
}

// ---------------------------------------------------------------- lobby
/**
 * The settings as big values at the top, a hint under them. The host gets a tap target for each choice. Returns { speed: [{ rect, value }] }.
 * opts: { speed, options: [{ value, label }], host }.
 */
export function drawLobbyTop(ctx, Sc, opts) {
  const { w } = Sc;
  const hits = [];
  const y = 8;
  const hh = 40;
  const segW = clamp(w * 0.14, 84, 130);
  const n = opts.options.length;
  const total = opts.host ? n * segW + (n - 1) * 4 : segW;
  const x0 = w / 2 - total / 2 + 24;
  if (x0 - 12 - 44 >= 136) text(ctx, 'SPEED', x0 - 12, y + hh / 2, 12, { align: 'right', color: '#9fc4ff', outline: 0.1 }); // not under the platform's buttons
  opts.options.forEach((o, i) => {
    const on = o.value === opts.speed;
    if (!opts.host && !on) return;
    const x = x0 + (opts.host ? i * (segW + 4) : 0);
    if (opts.host) hits.push({ rect: { x, y: y - 4, w: segW, h: hh + 8 }, value: o.value });
    if (on) {
      ctx.fillStyle = ACCENT;
      ctx.fillRect(x, y, segW, hh);
      text(ctx, o.label.toUpperCase(), x + segW / 2, y + hh / 2 + 0.5, hh * 0.52, { align: 'center', color: INK, italic: true, weight: 900, outline: 0 });
    } else {
      ctx.fillStyle = 'rgba(4,9,26,0.82)';
      ctx.fillRect(x, y, segW, hh);
      ctx.strokeStyle = rgba(ACCENT, 0.5);
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, segW - 1, hh - 1);
      text(ctx, o.label.toUpperCase(), x + segW / 2, y + hh / 2 + 0.5, hh * 0.46, { align: 'center', color: '#bcd4ff', weight: 800, outline: 0 });
    }
  });
  text(ctx, 'CLEAR LINES TO ATTACK', w / 2, y + hh + 11, 12, { align: 'center', color: '#c8dcff', outline: 0.12 });
  return { speed: hits };
}

// ---------------------------------------------------------------- countdown and banners
/** 3, 2, 1, GO over the board. `left`: seconds until play begins (negative once it has: GO). */
export function drawCountdown(ctx, Sc, left) {
  const B = Sc.L.board;
  const n = Math.ceil(left);
  const frac = left - Math.floor(left);
  const go = left <= 0;
  const label = go ? 'GO' : String(n);
  const age = go ? -left : 1 - frac; // seconds since this number appeared
  const pop = easeOutBack(age / 0.22, 2);
  const size = clamp(Sc.L.c * 7, 60, 300) * (0.8 + 0.2 * pop);
  const cx = B.x + B.w / 2;
  const cy = B.y + B.h * 0.4;
  ctx.save();
  ctx.globalAlpha = go ? clamp(1 - (age - 0.3) / 0.4, 0, 1) : 1;
  text(ctx, label, cx, cy, size, { align: 'center', color: go ? '#4dffb4' : '#ffffff', italic: true, weight: 900, outline: 0.16 });
  ctx.restore();
}

/** A short goal banner across the board: slides in, holds, fades. age in seconds. */
export function drawBanner(ctx, Sc, str, age, dur = 2.2) {
  if (age < 0 || age > dur) return;
  const B = Sc.L.board;
  const t = easeOut(age / 0.25);
  const fade = age > dur - 0.4 ? clamp((dur - age) / 0.4, 0, 1) : 1;
  const bw = Math.max(B.w + 40, 220);
  const bh = clamp(Sc.L.c * 2.6, 36, 72);
  const cx = B.x + B.w / 2;
  const y = B.y + B.h * 0.5 - bh / 2;
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.translate((1 - t) * -80, 0);
  ctx.fillStyle = 'rgba(3,8,24,0.88)';
  ctx.fillRect(cx - bw / 2, y, bw, bh);
  ctx.fillStyle = ACCENT;
  ctx.fillRect(cx - bw / 2, y, bw, 3);
  ctx.fillRect(cx - bw / 2, y + bh - 3, bw, 3);
  text(ctx, str, cx, y + bh / 2 + 1, bh * 0.52, { align: 'center', italic: true, weight: 900, outline: 0.12 });
  ctx.restore();
}

/** A bouncing arrow and "YOU" above the board at the start of a match. */
export function drawYouArrow(ctx, Sc, age, dur = 3.2) {
  if (age < 0 || age > dur) return;
  const B = Sc.L.board;
  const fade = age > dur - 0.5 ? clamp((dur - age) / 0.5, 0, 1) : 1;
  const bob = Sc.reduced ? 0 : Math.abs(Math.sin(age * 5)) * 8;
  const cx = B.x + B.w / 2;
  const y = Math.max(12, B.y - 16 - bob);
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.fillStyle = '#ffe14d';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 12, y - 12);
  ctx.lineTo(cx + 12, y - 12);
  ctx.lineTo(cx, y + 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  text(ctx, 'YOU', cx, y - 24, 15, { align: 'center', color: '#ffe14d', italic: true, weight: 900 });
  ctx.restore();
}

/** A small "YOU" tab on the top edge of your board (always). */
export function drawYouTag(ctx, Sc, ready = false) {
  const B = Sc.L.board;
  const w = 36;
  const h = 14;
  const x = B.x - 3;
  const y = B.y - h - 4;
  if (y < 2) return;
  ctx.fillStyle = ACCENT;
  ctx.fillRect(x, y, w, h);
  text(ctx, 'YOU', x + w / 2, y + h / 2 + 0.5, 10.5, { align: 'center', color: INK, weight: 900, outline: 0 });
  if (ready) {
    ctx.fillStyle = '#31d67b';
    ctx.fillRect(x + w + 3, y, 52, h);
    text(ctx, 'READY', x + w + 3 + 26, y + h / 2 + 0.5, 10.5, { align: 'center', color: INK, weight: 900, outline: 0 });
  }
}

/** You are out: a big KO and where you finished. */
export function drawKoOverlay(ctx, Sc, place, age) {
  const B = Sc.L.board;
  const pop = easeOutBack(age / 0.25, 2.4);
  const size = clamp(Sc.L.c * 3.4, 34, 120) * pop;
  const cx = B.x + B.w / 2;
  ctx.fillStyle = 'rgba(12,3,10,0.42)';
  ctx.fillRect(B.x, B.y + B.h * 0.28, B.w, B.h * 0.28);
  text(ctx, 'KO', cx, B.y + B.h * 0.38, size, { align: 'center', color: '#ff4a5e', italic: true, weight: 900, outline: 0.18 });
  text(ctx, ordinal(place), cx, B.y + B.h * 0.38 + size * 0.7, clamp(Sc.L.c * 1.5, 16, 52), { align: 'center', color: '#ffffff', italic: true, weight: 900 });
}

/** The winner's moment at the end of a match. */
export function drawWinnerBanner(ctx, Sc, name, mine, age) {
  const { w, h } = Sc;
  const pop = easeOutBack(age / 0.3, 2);
  const size = clamp(Math.min(w * 0.1, h * 0.18), 30, 120) * pop;
  const y = h * 0.4;
  ctx.fillStyle = 'rgba(2,6,20,0.45)';
  ctx.fillRect(0, y - size * 0.9, w, size * 1.9);
  ctx.fillStyle = mine ? '#ffe14d' : ACCENT;
  ctx.fillRect(0, y - size * 0.9, w, 3);
  ctx.fillRect(0, y + size * 1.0 - 3, w, 3);
  if (mine) text(ctx, '1ST', w / 2, y, size, { align: 'center', color: '#ffe14d', italic: true, weight: 900, outline: 0.18 });
  else {
    ctx.font = `900 ${size * 0.55}px ${FONT}`;
    text(ctx, fit(ctx, String(name).toUpperCase(), w * 0.8), w / 2, y - size * 0.1, size * 0.55, { align: 'center', italic: true, weight: 900, outline: 0.18 });
    text(ctx, 'WINS', w / 2, y + size * 0.55, size * 0.5, { align: 'center', color: ACCENT, italic: true, weight: 900 });
  }
}

// ---------------------------------------------------------------- results
const PLINTH = ['#ffd23f', '#c9d4e8', '#e0925a'];

/**
 * The results card: the podium (top three with their heads, names and points), "You: 5th" when you are lower, and the awards.
 * R: { rows: [{ id, name, bot, color, place, pts, kos }] best first, me: { place, pts, kos } | null, awards: [{ label, name }] }.
 * age: seconds since it appeared (it slides in).
 */
export function drawResults(ctx, Sc, R, age, bottomClear = 100) {
  const { w, h } = Sc;
  const t = easeOut(age / 0.35);
  const cw = Math.min(w - 20, 640);
  const top = 58;
  const ch = Math.max(170, Math.min(h - top - bottomClear, 400));
  const cx = w / 2;
  const x = cx - cw / 2;
  const y = top + (1 - t) * -30;
  ctx.save();
  ctx.globalAlpha = t;
  ctx.fillStyle = 'rgba(3,8,24,0.92)';
  ctx.fillRect(x, y, cw, ch);
  ctx.fillStyle = ACCENT;
  ctx.fillRect(x, y, cw, 3);
  ctx.strokeStyle = rgba(ACCENT, 0.3);
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, cw - 1, ch - 1);

  const compact = ch < 260;
  const colW = Math.min(150, (cw - 40) / 3);
  const pb = y + ch * 0.6; // where the plinths end
  const heights = compact ? [50, 36, 26] : [110, 80, 62]; // 1st, 2nd, 3rd
  const r = compact ? 17 : 26;
  const block = compact ? 28 : 40; // name and points between a head and its plinth
  const order = [1, 0, 2]; // left to right: 2nd, 1st, 3rd
  for (let slot = 0; slot < 3; slot++) {
    const idx = order[slot];
    const row = R.rows[idx];
    const px = cx + (slot - 1) * (colW + 6);
    const ph = heights[idx];
    const pt = pb - ph;
    ctx.fillStyle = rgba(PLINTH[idx], 0.2);
    ctx.fillRect(px - colW / 2, pt, colW, ph);
    ctx.fillStyle = PLINTH[idx];
    ctx.fillRect(px - colW / 2, pt, colW, 3);
    text(ctx, String(idx + 1), px, pt + ph * 0.55, ph * 0.55, { align: 'center', color: rgba(PLINTH[idx], 0.5), italic: true, weight: 900, outline: 0 });
    if (!row) continue;
    const hy = pt - r - block;
    const lift = idx === 0 && !Sc.reduced ? Math.sin(Sc.time * 3) * 2 : 0;
    drawHead(ctx, row.id, row.name, row.color, px, hy + lift, r, row.bot);
    const fs = compact ? 12 : 15;
    ctx.font = `800 ${fs}px ${FONT}`;
    text(ctx, fit(ctx, String(row.name).toUpperCase(), colW - 6), px, hy + r + fs * 0.9, fs, { align: 'center', outline: 0.14 });
    text(ctx, `${row.pts}`, px, hy + r + fs * 0.9 + fs * 1.15, fs + 1, { align: 'center', color: PLINTH[idx], italic: true, weight: 900, outline: 0.12 });
  }
  // you, when you are not on the podium
  const ly = y + ch * 0.74;
  if (R.me && R.me.place > 3) {
    text(ctx, `YOU: ${ordinal(R.me.place)}`, cx, ly, compact ? 18 : 26, { align: 'center', color: '#ffe14d', italic: true, weight: 900 });
    text(ctx, `${R.me.pts} PTS   ${R.me.kos} KO`, cx, ly + (compact ? 20 : 30), compact ? 11 : 14, { align: 'center', color: '#c8dcff', outline: 0.1 });
  } else if (R.me) {
    text(ctx, `${R.me.pts} PTS   ${R.me.kos} KO`, cx, ly + (compact ? 4 : 8), compact ? 12 : 16, { align: 'center', color: '#c8dcff', outline: 0.1 });
  }
  // awards
  if (R.awards.length > 0) {
    const ay = y + ch - (compact ? 12 : 18);
    const each = Math.min(240, (cw - 20) / R.awards.length);
    R.awards.forEach((a, i) => {
      const ax = cx + (i - (R.awards.length - 1) / 2) * each;
      const fs = compact ? 10 : 12;
      ctx.font = `800 ${fs}px ${FONT}`;
      text(ctx, fit(ctx, `${a.label}: ${String(a.name).toUpperCase()}`, each - 8), ax, ay, fs, { align: 'center', color: '#9fc4ff', outline: 0.1 });
    });
  }
  ctx.restore();
}
