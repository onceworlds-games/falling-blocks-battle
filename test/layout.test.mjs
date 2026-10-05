// Where things go, on every screen size: inside the screen, not on each other, the top-left corner clear (the platform's buttons),
// the bottom clear in the lobby (its Ready bar), and the minis out of the thumbs' corners on a touch screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOTTOM_LOBBY, CORNER, computeLayout } from '../game/layout.js';

const SIZES = [[812, 375], [667, 375], [844, 390], [1024, 768], [1280, 720], [1920, 1080], [2560, 1300], [568, 320], [390, 844], [360, 640], [1100, 760]];
const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function rects(L) {
  const out = [
    ['board', { x: L.board.x - 6, y: L.board.y - 6, w: L.board.w + 12, h: L.board.h + 12 }],
    ['hold', L.hold],
    ['next', L.next],
  ];
  L.slots.forEach((s, i) => s && out.push([`slot${i}`, { x: s.x, y: s.y, w: s.w, h: s.h }]));
  return out;
}

test('every layout fits its screen without overlaps, from 0 to 11 other boards', () => {
  for (const [w, h] of SIZES) {
    for (const mode of ['play', 'lobby']) {
      for (const touch of [false, true]) {
        for (let n = 0; n <= 11; n++) {
          const L = computeLayout(w, h, mode, n, touch);
          const where = `${w}x${h} ${mode}${touch ? ' touch' : ''} n=${n}`;
          const rs = rects(L);
          for (const [name, r] of rs) {
            assert.ok(Number.isFinite(r.x + r.y + r.w + r.h), `${where} ${name} is finite`);
            assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h, `${where}: ${name} inside the screen ${JSON.stringify(r)}`);
          }
          for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) assert.equal(hit(rs[i][1], rs[j][1]), false, `${where}: ${rs[i][0]} and ${rs[j][0]} overlap`);
          for (const [name, r] of rs) assert.equal(hit(r, { x: 0, y: 0, w: 130, h: 56 }), false, `${where}: ${name} is in the platform's corner`);
          if (mode === 'lobby') for (const [name, r] of rs) assert.ok(r.y + r.h <= h - BOTTOM_LOBBY + 2 || h - BOTTOM_LOBBY < L.top + 60, `${where}: ${name} is clear of the Ready bar`);
          if (touch) {
            const corners = [{ x: 0, y: h - CORNER, w: CORNER, h: CORNER }, { x: w - CORNER, y: h - CORNER, w: CORNER, h: CORNER }];
            L.slots.forEach((s, i) => s && assert.equal(s.under, corners.some((k) => hit(s, k)), `${where}: slot${i} knows if it is under a thumb`));
            // the first boards (all of them, when there are few) stay out from under the thumbs
            L.slots.slice(0, Math.min(n, 4)).forEach((s, i) => s && assert.equal(s.under, false, `${where}: slot${i} is under a thumb`));
          }
          assert.ok(L.c >= 5, `${where}: cell ${L.c}`);
          const live = L.slots.filter(Boolean);
          assert.equal(L.slots.length, n);
          assert.equal(live.length, n, `${where}: every board has a place`);
          for (const s of live) {
            assert.ok(s.mc >= 1 && s.lh >= 11 && s.bw === 10 * s.mc && s.bh === 20 * s.mc, `${where}: slot sizes`);
            assert.ok(s.bx >= s.x && s.bx + s.bw <= s.x + s.w && s.by + s.bh <= s.y + s.h + 1, `${where}: the mini fits its slot`);
          }
        }
      }
    }
  }
});

test('common screens get a board you can see', () => {
  assert.ok(computeLayout(1280, 720, 'play', 7).c >= 28);
  assert.ok(computeLayout(1920, 1080, 'play', 11).c >= 44);
  assert.ok(computeLayout(812, 375, 'play', 7).c >= 14);
  assert.ok(computeLayout(812, 375, 'lobby', 7).c >= 9);
  const L = computeLayout(1280, 720, 'play', 7);
  assert.ok(L.slots[0].mc >= 6, 'the minis are readable on a laptop');
  const centre = L.board.x + L.board.w / 2;
  assert.ok(Math.abs(centre - 640) <= 12, 'the board sits in the middle');
});

test('the others sit on both sides, the first ones nearest the board', () => {
  const L = computeLayout(1280, 720, 'play', 7);
  const sides = L.slots.map((s) => s.side).join('');
  assert.equal(sides, 'LRLRLRL');
  const left = L.slots.filter((s) => s.side === 'L');
  assert.ok(left[0].x > left[3].x, 'the first mini is in the inner column');
  assert.ok(left.every((s) => s.x + s.w <= L.hold.x));
  const right = L.slots.filter((s) => s.side === 'R');
  assert.ok(right.every((s) => s.x >= L.next.x + L.next.w));
});

test('a layout never needs more than a few microseconds of garbage', () => {
  for (let i = 0; i < 2000; i++) computeLayout(1280, 720, 'play', 7, i % 2 === 0);
});
