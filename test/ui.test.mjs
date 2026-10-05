// Everything the game writes on the screen stays on the screen and out of the corners the platform owns: the top-left buttons, and in
// the lobby the Ready bar at the bottom. Draws each screen on a fake canvas at several sizes and checks every piece of text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderScene } from '../game/draw.js';
import { Engine } from '../game/engine.js';
import { createFx } from '../game/fx.js';
import { computeLayout } from '../game/layout.js';
import { COLORS } from '../game/rules.js';
import * as ui from '../game/ui.js';
import { fillFromEngine, makeView } from '../game/views.js';
import { makeCtx } from './fakedom.mjs';

const SIZES = [[812, 375], [667, 375], [1280, 720], [390, 844], [568, 320], [1920, 1080]];

function scene(w, h, mode, n) {
  const fx = createFx();
  const L = computeLayout(w, h, mode, n, false);
  const mk = (id, i) => {
    const e = new Engine({ seed: i + 3, id });
    for (let k = 0; k < 6; k++) e.hardDrop();
    const v = makeView(id, { name: i === 0 ? 'A very long player name here' : `Player ${i}`, color: COLORS[i % COLORS.length], bot: i % 2 === 1 });
    fillFromEngine(v, e, true);
    v.kos = i;
    return v;
  };
  const main = mk('me', 0);
  main.pending = 5;
  const minis = Array.from({ length: n }, (_, i) => {
    const v = mk(`o${i}`, i + 1);
    if (i === 2) {
      v.ko = true;
      v.koAge = 2;
      v.place = 8;
    }
    if (i === 1) v.hot = true;
    if (i === 3) v.target = true;
    v.ready = i % 2 === 0;
    return v;
  });
  const hud = { time: 125, level: 5, levelFrac: 0.4, alive: 6, total: 8, kos: 3, lines: 44, combo: 4, b2b: true, target: minis[3] ?? null, revenge: true, label: 'OVERTIME' };
  return { w, h, pr: 1, time: 3, pulse: 0.2, mode, L, busy: false, fx, reduced: false, q: 1, main, minis, hud: mode === 'lobby' ? null : hud, danger: 0.5, shake: { x: 0, y: 0 }, labels: true };
}

const boxes = (ctx) =>
  ctx.texts.map((t) => {
    const half = t.width / 2;
    const left = t.align === 'center' ? t.x - half : t.align === 'right' ? t.x - t.width : t.x;
    return { text: t.text, left, right: left + t.width, y: t.y, size: t.size };
  });

function inside(ctx, w, h, label, { bottomClear = 0 } = {}) {
  assert.deepEqual(ctx.bad, [], `${label}: nothing odd handed to the canvas`);
  for (const b of boxes(ctx)) {
    if (b.size < 1) continue;
    assert.ok(b.y >= 0 && b.y <= h - bottomClear, `${label}: "${b.text}" at y=${b.y.toFixed(0)} is on the screen (clear below ${h - bottomClear})`);
    assert.ok(b.left >= -2 && b.right <= w + 2, `${label}: "${b.text}" ${b.left.toFixed(0)}..${b.right.toFixed(0)} fits ${w} wide`);
    const inCorner = b.left < 130 && b.y < 56;
    assert.equal(inCorner, false, `${label}: "${b.text}" sits in the platform's corner`);
  }
}

test('the match screen: every label inside the screen and out of the corner', () => {
  for (const [w, h] of SIZES) {
    const ctx = makeCtx('match');
    const sc = scene(w, h, 'play', 7);
    renderScene(ctx, sc);
    ui.drawYouTag(ctx, sc);
    ui.drawYouArrow(ctx, sc, 1);
    ui.drawBanner(ctx, sc, 'LAST BOARD WINS', 0.8);
    ui.drawKoOverlay(ctx, sc, 5, 0.5);
    sc.fx.callout('T-SPIN DOUBLE!', { color: '#fff', size: 0.58 });
    sc.fx.callout('BACK-TO-BACK', { color: '#fff', size: 0.42 });
    sc.fx.callout('5 COMBO', { color: '#fff', size: 0.46 });
    sc.fx.update(0.1);
    sc.fx.drawCallouts(ctx, sc.L.board.x + sc.L.board.w / 2, sc.L.board.y + sc.L.board.h * 0.36, sc.L.c);
    inside(ctx, w, h, `${w}x${h} match`);
    assert.equal(ctx.depth, 0);
    assert.ok(ctx.texts.some((t) => t.text === 'ALIVE') && ctx.texts.some((t) => t.text === 'HOLD'));
  }
});

test('the lobby: settings at the top, nothing in the Ready bar, the results card clear of it', () => {
  for (const [w, h] of SIZES) {
    const ctx = makeCtx('lobby');
    const sc = scene(w, h, 'lobby', 7);
    renderScene(ctx, sc);
    const hits = ui.drawLobbyTop(ctx, sc, { speed: 'normal', options: [{ value: 'normal', label: 'Normal' }, { value: 'fast', label: 'Fast' }], host: true });
    ui.drawYouTag(ctx, sc, true);
    assert.equal(hits.speed.length, 2);
    for (const hit of hits.speed) {
      assert.ok(hit.rect.h >= 44, `${w}x${h}: tap targets are at least 44 px tall`);
      assert.ok(hit.rect.w >= 44);
      assert.ok(hit.rect.x >= 130 || hit.rect.y > 56, 'not under the platform buttons');
    }
    inside(ctx, w, h, `${w}x${h} lobby`, { bottomClear: h > 400 ? 90 : 90 });
    const ctx2 = makeCtx('card');
    const R = {
      rows: Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: i === 0 ? 'Someone with a very long name' : `P${i}`, bot: i > 0, color: COLORS[i], place: i + 1, pts: 100 - i * 14, kos: i % 3, sent: i * 4 })),
      me: { place: 5, pts: 43, kos: 1 },
      awards: [{ label: 'MOST KOS', name: 'Nova ×3' }, { label: 'MOST SENT', name: 'Kai 31' }],
    };
    ui.drawResults(ctx2, { ...sc, mode: 'lobby' }, R, 99, 100);
    inside(ctx2, w, h, `${w}x${h} results in the lobby`, { bottomClear: Math.min(90, h - 200) });
    const ctx3 = makeCtx('final');
    ui.drawResults(ctx3, sc, R, 99, 24);
    inside(ctx3, w, h, `${w}x${h} results`);
    assert.equal(ctx2.depth + ctx3.depth, 0);
  }
});

test('the title and the countdown fit', () => {
  for (const [w, h] of SIZES) {
    const sc = scene(w, h, 'play', 7);
    const ctx = makeCtx('title');
    const { play } = ui.drawTitle(ctx, sc);
    inside(ctx, w, h, `${w}x${h} title`);
    assert.ok(play.h >= 56 || h < 400, 'the Play button is big');
    assert.ok(play.h >= 44 && play.w >= 200);
    assert.ok(play.x >= 0 && play.x + play.w <= w && play.y + play.h <= h);
    for (const left of [2.6, 1.2, 0.1, -0.2]) {
      const c2 = makeCtx('count');
      ui.drawCountdown(c2, sc, left);
      inside(c2, w, h, `${w}x${h} countdown ${left}`);
    }
    const c3 = makeCtx('win');
    ui.drawWinnerBanner(c3, sc, 'Somebody with a very long name indeed', false, 0.5);
    inside(c3, w, h, `${w}x${h} winner`);
  }
});

test('the first countdown number is 3 and the last word is GO', () => {
  const sc = scene(812, 375, 'play', 7);
  const read = (left) => {
    const ctx = makeCtx('c');
    ui.drawCountdown(ctx, sc, left);
    return ctx.texts.map((t) => t.text).join('');
  };
  assert.equal(read(2.9), '3');
  assert.equal(read(1.5), '2');
  assert.equal(read(0.5), '1');
  assert.equal(read(-0.1), 'GO');
});
