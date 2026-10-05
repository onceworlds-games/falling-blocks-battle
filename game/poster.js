// Store art. Opened with ?poster=<name>, the game skips the room and the SDK and draws one staged, frozen frame with the real
// renderer, then sets document.body.dataset.ready = '1'. cover, action and win are 1280x720, icon 512x512, badge-<id> 256x256.
// The same seed gives the same picture every time.

import { Board } from './board.js';
import { renderScene } from './draw.js';
import { createFx } from './fx.js';
import { ACCENT, PIECE_COLORS, TAU, drawBlock, text } from './gfx.js';
import { computeLayout } from './layout.js';
import { BotMatch } from './match.js';
import { HIDDEN, I, J, L, O, ROWS, S, SHAPES, T, Z } from './pieces.js';
import { mulberry32 } from './rng.js';
import { COLORS, buildRoster } from './rules.js';
import * as ui from './ui.js';
import { fillFromEngine, makeView } from './views.js';

export const POSTER_SIZES = {
  cover: [1280, 720],
  action: [1280, 720],
  win: [1280, 720],
  icon: [512, 512],
  'badge-first-win': [256, 256],
  'badge-four-lines': [256, 256],
  'badge-combo-5': [256, 256],
  'badge-t-spin': [256, 256],
};

const STEP = 1000 / 60;

/** The step of a simulation at which bot `idx` has a stack at least `rows` high (else just the end). */
function simulateTall(seed, idx, rows, maxSecs = 90) {
  const roster = buildRoster([], seed, 8);
  const bm = new BotMatch({ seed, roster, speed: 'normal', t: 30000, isolated: true });
  for (let t = 0; t < maxSecs * 1000; t += STEP) {
    bm.step(STEP);
    const e = bm.bots[idx].engine;
    if (t > 20000 && e.board.maxHeight() >= rows && e.board.maxHeight() <= rows + 2 && e.cur && e.cur.y < 6) break;
  }
  return { roster, bm };
}

const colorOf = (roster, i) => COLORS[roster[i].c % COLORS.length];

function viewOfBot(roster, bm, i, o = {}) {
  const b = bm.bots[i];
  const v = makeView(`poster:${b.id}`, { name: roster[b.idx].n, bot: true, color: colorOf(roster, b.idx) });
  fillFromEngine(v, b.engine, true);
  Object.assign(v, o);
  return v;
}

function sceneFor(w, h, layout, fx, o = {}) {
  return {
    w,
    h,
    pr: 1,
    time: o.time ?? 4.2,
    pulse: o.pulse ?? 0.35,
    mode: 'play',
    L: layout,
    busy: false,
    fx,
    reduced: false,
    q: 1,
    main: null,
    minis: [],
    hud: null,
    danger: 0,
    shake: { x: 0, y: 0 },
    labels: o.labels ?? true,
  };
}

/** Rows (post-clear indices) as the clear animation wants them, with the board the way it looks after the clear. */
function stageClear(v, rows, color, time, age) {
  const set = new Set(rows);
  const shift = new Float32Array(ROWS);
  let o = ROWS - 1;
  for (let r = ROWS - 1; r >= rows.length; r--) {
    while (set.has(o)) o--;
    shift[r] = r - o;
    o--;
  }
  v.anim.clear = { t0: time - age, rows, shift, color };
}

function ghostOf(cells, p) {
  const b = new Board(cells);
  let y = p[3];
  while (!b.collides(p[0], p[1], p[2], y + 1)) y++;
  return y;
}

// ---------------------------------------------------------------- cover
function cover(ctx, w, h) {
  const fx = createFx();
  fx.rand = mulberry32(5);
  const L0 = computeLayout(w, h, 'play', 7, false, { top: 196, bottom: 16 });
  const sc = sceneFor(w, h, L0, fx);
  const { roster, bm } = simulateTall(31, 2, 7);
  const mine = viewOfBot(roster, bm, 2, { name: 'You', me: true, color: ACCENT });
  mine.id = 'poster:me';
  mine.bot = false;
  // a quad has just cleared: four rows flashing white, the stack still held up where it was
  const rows = [18, 19, 20, 21];
  stageClear(mine, rows, PIECE_COLORS[I], sc.time, 0.05);
  mine.piece = [T, 0, 3, 3];
  mine.hasPiece = true;
  mine.ghostY = ghostOf(mine.cells, mine.piece);
  mine.hold = S;
  mine.next = [L, O, I, J, Z];
  mine.pending = 4;
  // the others
  const minis = [];
  const picks = [0, 1, 3, 4, 5, 6, 7];
  picks.forEach((bi, k) => {
    const v = viewOfBot(roster, bm, bi);
    if (k === 1) {
      v.cells = v.cells.slice();
      new Board(v.cells).addGarbage(4, 3);
      v.pending = 6;
      v.hot = true;
    }
    if (k === 3) v.target = true;
    if (k === 2 || k === 5) {
      v.ko = true;
      v.koAge = 3;
      v.place = k === 2 ? 8 : 7;
    }
    v.kos = k === 4 ? 2 : k === 0 ? 1 : 0;
    minis.push(v);
  });
  sc.main = mine;
  sc.minis = minis;
  // the effects: shards from the cleared rows, a ring, the callout
  const B = L0.board;
  const c = L0.c;
  for (const y of rows) for (let x = 0; x < 10; x++) fx.burst(B.x + (x + 0.5) * c, B.y + (y - HIDDEN + 0.5) * c, 2, { colors: [PIECE_COLORS[I], '#ffffff', PIECE_COLORS[T]], speed: 220, g: 700, kind: 2, size: c * 0.34, life: 0.8, angle: -Math.PI / 2, spread: Math.PI * 1.3 });
  fx.update(0.06);
  fx.ring(B.x + B.w / 2, B.y + B.h * 0.8, c, c * 8, ACCENT, 0.6, 4);
  fx.rings[0].age = 0.18;
  fx.callout('QUAD!', { color: ACCENT, size: 1.25 });
  fx.callouts[0].age = 0.32;
  renderScene(ctx, sc);
  // the title in the top third
  const g = ctx.createLinearGradient(0, 0, 0, 200);
  g.addColorStop(0, 'rgba(2,6,20,0.7)');
  g.addColorStop(1, 'rgba(2,6,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, 210);
  ui.drawLogo(ctx, w / 2, 14, 62, 1.2, 1);
}

// ---------------------------------------------------------------- action: a T-spin close-up
function action(ctx, w, h) {
  const fx = createFx();
  fx.rand = mulberry32(9);
  const L0 = computeLayout(w, h, 'play', 0, false, { top: 12, bottom: 12 });
  const sc = sceneFor(w, h, L0, fx, { labels: false, pulse: 0.8 });
  const { roster, bm } = simulateTall(77, 5, 8);
  const mine = viewOfBot(roster, bm, 5, { name: 'You', me: true, color: ACCENT });
  mine.bot = false;
  // a T-spin double has just landed: two rows flashing, the T still glowing where it turned
  stageClear(mine, [20, 21], PIECE_COLORS[T], sc.time, 0.06);
  mine.piece = [0, 0, 0, 0];
  mine.hasPiece = false;
  mine.ghostY = undefined;
  mine.hold = I;
  mine.next = [O, S, Z, L, J];
  mine.pending = 2;
  mine.anim.lock = { t0: sc.time - 0.04, cells: [4, 19, 3, 20, 4, 20, 5, 20] };
  sc.main = mine;
  const B = L0.board;
  const c = L0.c;
  for (const y of [20, 21]) for (let x = 0; x < 10; x++) fx.burst(B.x + (x + 0.5) * c, B.y + (y - HIDDEN + 0.5) * c, 4, { colors: [PIECE_COLORS[T], '#ffffff', '#e0b3ff', PIECE_COLORS[L]], speed: 300, g: 650, kind: 2, size: c * 0.32, life: 0.9, angle: -Math.PI / 2, spread: Math.PI * 1.5 });
  fx.burst(B.x + B.w / 2, B.y + B.h * 0.93, 30, { colors: ['#ffffff', '#d28bff'], speed: 380, g: 200, kind: 1, size: 4, life: 0.6, angle: -Math.PI / 2, spread: Math.PI * 2 });
  fx.update(0.11);
  fx.ring(B.x + B.w / 2, B.y + B.h * 0.92, c, c * 10, '#d28bff', 0.6, 5);
  fx.ring(B.x + B.w / 2, B.y + B.h * 0.92, c, c * 7, '#ffffff', 0.5, 3);
  fx.rings[0].age = 0.16;
  fx.rings[1].age = 0.1;
  renderScene(ctx, sc);
  // a violet glow from where it landed
  const rg = ctx.createRadialGradient(B.x + B.w / 2, B.y + B.h * 0.92, 0, B.x + B.w / 2, B.y + B.h * 0.92, c * 14);
  rg.addColorStop(0, 'rgba(190,120,255,0.38)');
  rg.addColorStop(1, 'rgba(190,120,255,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, w, h);
}

// ---------------------------------------------------------------- win
function win(ctx, w, h) {
  const fx = createFx();
  fx.rand = mulberry32(21);
  const L0 = computeLayout(w, h, 'play', 7, false, { top: 24, bottom: 14 });
  const sc = sceneFor(w, h, L0, fx, { pulse: 0.5 });
  const { roster, bm } = simulateTall(12, 4, 6);
  const mine = viewOfBot(roster, bm, 4, { name: 'You', me: true, color: '#ffe14d' });
  mine.bot = false;
  mine.accent = '#ffe14d';
  mine.glow = 1.6;
  mine.piece = [J, 0, 3, 8];
  mine.hasPiece = true;
  mine.ghostY = ghostOf(mine.cells, mine.piece);
  mine.hold = T;
  mine.next = [I, S, O, Z, L];
  mine.pending = 0;
  const minis = [0, 1, 2, 3, 5, 6, 7].map((bi, k) => {
    const v = viewOfBot(roster, bm, bi);
    v.ko = true;
    v.koAge = 4;
    v.place = k + 2;
    v.kos = k === 0 ? 3 : 0;
    v.cells = v.cells.slice();
    return v;
  });
  sc.main = mine;
  sc.minis = minis;
  const B = L0.board;
  const c = L0.c;
  renderScene(ctx, sc);
  // gold light behind the winner
  const rg = ctx.createRadialGradient(B.x + B.w / 2, B.y + B.h * 0.5, c * 2, B.x + B.w / 2, B.y + B.h * 0.5, c * 16);
  rg.addColorStop(0, 'rgba(255,225,77,0.30)');
  rg.addColorStop(1, 'rgba(255,225,77,0)');
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
  // confetti, then "1st"
  const rand = mulberry32(8);
  const cols = [ACCENT, '#ffe14d', '#ff4d6d', '#b25cff', '#37d983', '#ffffff'];
  for (let i = 0; i < 90; i++) {
    const x = rand() * w;
    const y = rand() * h * 0.8;
    const s = 5 + rand() * 7;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rand() * TAU);
    ctx.fillStyle = cols[i % cols.length];
    ctx.globalAlpha = 0.85;
    ctx.fillRect(-s / 2, -s * 0.3, s, s * 0.6);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  const size = c * 4.6;
  const cx = B.x + B.w / 2;
  const cy = B.y + B.h * 0.3;
  ctx.fillStyle = 'rgba(2,6,20,0.55)';
  ctx.fillRect(B.x - 6, cy - size * 0.62, B.w + 12, size * 1.3);
  text(ctx, '1ST', cx, cy, size, { align: 'center', color: '#ffe14d', italic: true, weight: 900, outline: 0.18 });
}

// ---------------------------------------------------------------- icon
function backdrop(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#071a4a');
  g.addColorStop(1, '#030a24');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const rand = mulberry32(3);
  for (let i = 0; i < 9; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = (0.12 + rand() * 0.2) * Math.min(w, h);
    const sides = [3, 4, 6][i % 3];
    const rot = rand() * TAU;
    ctx.beginPath();
    for (let k = 0; k < sides; k++) {
      const a = rot + (k / sides) * TAU;
      if (k === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fillStyle = `rgba(70,130,255,${0.05 + rand() * 0.06})`;
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,200,255,0.1)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function icon(ctx, w, h) {
  backdrop(ctx, w, h);
  const rg = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.55);
  rg.addColorStop(0, 'rgba(60,140,255,0.45)');
  rg.addColorStop(1, 'rgba(60,140,255,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, w, h);
  // a T and an I, interlocking
  const s = 92;
  const x0 = Math.round((w - 3 * s) / 2);
  const y0 = Math.round((h - 4 * s) / 2);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;
  for (const [x, y] of [[2, 0], [2, 1], [2, 2], [2, 3]]) drawBlock(ctx, x0 + x * s, y0 + y * s, s, I, 1, true);
  for (const [x, y] of [[0, 1], [0, 2], [0, 3], [1, 2]]) drawBlock(ctx, x0 + x * s, y0 + y * s, s, T, 1, true);
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x0 - 10, y0 - 10, 3 * s + 20, 4 * s + 20);
}

// ---------------------------------------------------------------- badges
function disc(ctx, w, c1, c2, ring) {
  const r = w / 2;
  const g = ctx.createRadialGradient(r, r * 0.8, r * 0.1, r, r, r);
  g.addColorStop(0, c1);
  g.addColorStop(1, c2);
  ctx.beginPath();
  ctx.arc(r, r, r - 4, 0, TAU);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = ring;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(r, r, r - 15, 0, TAU);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.stroke();
}

function badgeTrophy(ctx, w) {
  disc(ctx, w, '#2a56d0', '#0a1b52', '#ffd23f');
  const gold = ctx.createLinearGradient(0, 60, 0, 200);
  gold.addColorStop(0, '#fff2a8');
  gold.addColorStop(0.5, '#ffd23f');
  gold.addColorStop(1, '#d98a12');
  ctx.fillStyle = gold;
  ctx.strokeStyle = '#7a4a05';
  ctx.lineWidth = 5;
  ctx.lineJoin = 'round';
  // the cup
  ctx.beginPath();
  ctx.moveTo(84, 62);
  ctx.lineTo(172, 62);
  ctx.lineTo(166, 112);
  ctx.quadraticCurveTo(160, 150, 128, 154);
  ctx.quadraticCurveTo(96, 150, 90, 112);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // handles
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(128 + sx * 44, 74);
    ctx.bezierCurveTo(128 + sx * 78, 70, 128 + sx * 76, 122, 128 + sx * 50, 124);
    ctx.lineWidth = 9;
    ctx.strokeStyle = '#d98a12';
    ctx.stroke();
  }
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#7a4a05';
  // stem and base
  ctx.fillStyle = gold;
  ctx.fillRect(116, 154, 24, 26);
  ctx.strokeRect(116, 154, 24, 26);
  ctx.fillRect(92, 180, 72, 18);
  ctx.strokeRect(92, 180, 72, 18);
  // a star on the cup
  ctx.fillStyle = '#fff8d0';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * TAU) / 10;
    const rr = i % 2 === 0 ? 20 : 8;
    const px = 128 + Math.cos(a) * rr;
    const py = 104 + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

function badgeBars(ctx, w) {
  disc(ctx, w, '#0f6e88', '#04202e', ACCENT);
  const s = 28;
  const x0 = 128 - 2.5 * s;
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 5; k++) drawBlock(ctx, x0 + k * s, 66 + i * (s + 2), s, I, 1, true);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(x0 - 10, 66 + 4 * (s + 2) + 6, 5 * s + 20, 4);
}

function badgeCombo(ctx, w) {
  disc(ctx, w, '#a02a1a', '#2a0808', '#ff9a2b');
  const g = ctx.createLinearGradient(0, 40, 0, 210);
  g.addColorStop(0, '#fff09a');
  g.addColorStop(0.45, '#ffb02b');
  g.addColorStop(1, '#ff4a1a');
  ctx.fillStyle = g;
  ctx.strokeStyle = '#6a1604';
  ctx.lineWidth = 5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(128, 34);
  ctx.bezierCurveTo(138, 70, 186, 92, 180, 140);
  ctx.bezierCurveTo(176, 186, 146, 208, 128, 208);
  ctx.bezierCurveTo(100, 208, 74, 186, 76, 146);
  ctx.bezierCurveTo(78, 118, 96, 108, 100, 84);
  ctx.bezierCurveTo(112, 96, 118, 108, 120, 118);
  ctx.bezierCurveTo(126, 96, 118, 62, 128, 34);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  const inner = ctx.createLinearGradient(0, 110, 0, 205);
  inner.addColorStop(0, '#fffbe0');
  inner.addColorStop(1, '#ffd23f');
  ctx.fillStyle = inner;
  ctx.beginPath();
  ctx.moveTo(128, 112);
  ctx.bezierCurveTo(144, 140, 158, 150, 154, 176);
  ctx.bezierCurveTo(150, 198, 138, 204, 128, 204);
  ctx.bezierCurveTo(112, 204, 102, 192, 104, 172);
  ctx.bezierCurveTo(106, 150, 122, 142, 128, 112);
  ctx.closePath();
  ctx.fill();
  text(ctx, '×5', 128, 166, 54, { align: 'center', color: '#ffffff', italic: true, weight: 900, outline: 0.2, outlineColor: '#6a1604' });
}

function badgeTSpin(ctx, w) {
  disc(ctx, w, '#5a2cb0', '#160a3a', '#b25cff');
  ctx.save();
  ctx.translate(128, 128);
  ctx.rotate(-0.36);
  const s = 44;
  for (const [x, y] of SHAPES[T][0]) drawBlock(ctx, (x - 1.5) * s, (y - 1) * s, s, T, 1, true);
  ctx.restore();
  // arrows around it
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  for (const a0 of [0.35, 0.35 + Math.PI]) {
    ctx.beginPath();
    ctx.arc(128, 128, 94, a0, a0 + 1.9);
    ctx.stroke();
    const a1 = a0 + 1.9;
    const ex = 128 + Math.cos(a1) * 94;
    const ey = 128 + Math.sin(a1) * 94;
    ctx.beginPath();
    ctx.moveTo(ex + Math.cos(a1 + 1.57) * 17, ey + Math.sin(a1 + 1.57) * 17);
    ctx.lineTo(ex + Math.cos(a1) * 17, ey + Math.sin(a1) * 17);
    ctx.lineTo(ex + Math.cos(a1 - 1.57) * 17, ey + Math.sin(a1 - 1.57) * 17);
    ctx.closePath();
    ctx.fill();
  }
}

const DRAWERS = { cover, action, win, icon, 'badge-first-win': badgeTrophy, 'badge-four-lines': badgeBars, 'badge-combo-5': badgeCombo, 'badge-t-spin': badgeTSpin };

/** Sizes the canvas to the poster, draws it and flags it ready. */
export async function runPoster(canvas, name) {
  const size = POSTER_SIZES[name];
  const draw = DRAWERS[name];
  if (!size || !draw) throw new Error(`unknown poster ${name}`);
  const [w, h] = size;
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  try {
    await Promise.all([document.fonts.load('italic 900 60px "Exo 2"'), document.fonts.load('800 24px "Exo 2"')]);
    await document.fonts.ready;
  } catch {
    // the system font will do
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (name.startsWith('badge-')) draw(ctx, w);
  else draw(ctx, w, h);
  document.body.dataset.ready = '1';
}
