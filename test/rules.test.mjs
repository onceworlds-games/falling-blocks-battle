import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Das } from '../game/das.js';
import { mulberry32 } from '../game/rng.js';
import {
  CAP_MS, COLORS, COMBO_BONUS, GRAVITY_CAP, LEVEL_MS, SUDDEN_EVERY, SUDDEN_MS, attackFor, buildRoster, comboBonus, gravityAt, isDifficult, levelAt, ordinal, pickTarget, placePoints, ppsFor, suddenCol, suddenDue,
} from '../game/rules.js';

test('the attack table: plain clears', () => {
  assert.equal(attackFor({ lines: 1 }).total, 0, 'single');
  assert.equal(attackFor({ lines: 2 }).total, 1, 'double');
  assert.equal(attackFor({ lines: 3 }).total, 2, 'triple');
  assert.equal(attackFor({ lines: 4 }).total, 4, 'quad');
  assert.equal(attackFor({ lines: 0 }).total, 0);
});

test('the attack table: T-spins', () => {
  assert.equal(attackFor({ lines: 1, tspin: 2 }).total, 2, 'T-spin single');
  assert.equal(attackFor({ lines: 2, tspin: 2 }).total, 4, 'T-spin double');
  assert.equal(attackFor({ lines: 3, tspin: 2 }).total, 6, 'T-spin triple');
  assert.equal(attackFor({ lines: 1, tspin: 1 }).total, 1, 'mini T-spin single');
  assert.equal(attackFor({ lines: 0, tspin: 2 }).total, 0, 'a T-spin with no line sends nothing');
});

test('back-to-back adds one; the combo table; a perfect clear adds ten', () => {
  assert.equal(attackFor({ lines: 4, b2b: true }).total, 5);
  assert.equal(attackFor({ lines: 2, tspin: 2, b2b: true }).total, 5);
  assert.deepEqual(COMBO_BONUS, [0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5]);
  const want = [0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5, 5, 5, 5];
  want.forEach((bonus, combo) => assert.equal(comboBonus(combo), bonus, `combo ${combo}`));
  assert.equal(comboBonus(-1), 0);
  assert.equal(attackFor({ lines: 1, combo: 3 }).total, 2, 'a single in a 3-combo sends the combo bonus');
  assert.equal(attackFor({ lines: 4, b2b: true, combo: 2 }).total, 4 + 1 + 1);
  assert.equal(attackFor({ lines: 1, perfect: true }).total, 10);
  assert.equal(attackFor({ lines: 4, perfect: true, b2b: true, combo: 10 }).total, 4 + 1 + 5 + 10);
});

test('difficult clears are quads and T-spin clears', () => {
  assert.equal(isDifficult(4, 0), true);
  assert.equal(isDifficult(1, 2), true);
  assert.equal(isDifficult(1, 1), true);
  assert.equal(isDifficult(3, 0), false);
  assert.equal(isDifficult(0, 2), false, 'a T-spin that clears nothing is not a clear');
});

test('gravity: 1 row/s (Fast 2), up 40% every 30 s, capped at 20', () => {
  assert.equal(gravityAt('normal', 0), 1);
  assert.equal(gravityAt('fast', 0), 2);
  assert.equal(gravityAt('normal', LEVEL_MS - 1), 1);
  assert.ok(Math.abs(gravityAt('normal', LEVEL_MS) - 1.4) < 1e-9);
  assert.ok(Math.abs(gravityAt('fast', 2 * LEVEL_MS) - 2 * 1.4 * 1.4) < 1e-9);
  let prev = 0;
  for (let ms = 0; ms < 20 * 60 * 1000; ms += 5000) {
    const g = gravityAt('normal', ms);
    assert.ok(g >= prev && g <= GRAVITY_CAP && Number.isFinite(g));
    prev = g;
  }
  assert.equal(gravityAt('normal', 15 * 60 * 1000), GRAVITY_CAP);
  assert.equal(gravityAt('fast', 15 * 60 * 1000), GRAVITY_CAP);
  assert.equal(levelAt(-5), 0);
  assert.equal(levelAt(95000), 3);
});

test('DAS 133 ms / ARR 33 ms', () => {
  const d = new Das();
  assert.equal(d.update(1, 16), 1, 'one step the moment the key goes down');
  let total = 0;
  let t = 0;
  while (t < 100) {
    total += d.update(1, 10);
    t += 10;
  }
  assert.equal(total, 0, 'nothing during the delay');
  const first = [];
  for (let i = 0; i < 20; i++) first.push(d.update(1, 10));
  // delay over at 133 ms (13 ms into this window), then one step every 33 ms
  const steps = first.reduce((a, b) => a + b, 0);
  assert.ok(steps >= 4 && steps <= 6, `${steps} steps in 200 ms after the delay`);
  assert.equal(d.update(0, 10), 0);
  assert.equal(d.update(-1, 10), 1, 'a new direction starts again at once');
  assert.equal(d.update(-1, 120), 0);
  assert.equal(d.update(-1, 20), 1, 'the delay ends at 133 ms');
  const c = new Das();
  c.charge(1);
  assert.equal(c.update(1, 5), 0, 'charged: no step at once');
  assert.equal(c.update(1, 40), 1, 'and it repeats straight away');
});

test('a full second of ARR is about 30 steps; a 60 Hz loop gets the same count as a 20 Hz loop', () => {
  for (const step of [1000 / 60, 50]) {
    const d = new Das();
    let total = d.update(1, step);
    for (let t = 0; t < 1000; t += step) total += d.update(1, step);
    assert.ok(total >= 26 && total <= 32, `${total} steps at ${step.toFixed(1)} ms`);
  }
});

test('targeting: random, with a Revenge preference for recent attackers', () => {
  const alive = ['a', 'b', 'c', 'd', 'e'];
  const rng = mulberry32(3);
  assert.equal(pickTarget(rng, 'a', ['a'], new Map(), 0), '', 'nobody else alive');
  const counts = { b: 0, c: 0, d: 0, e: 0 };
  const attackers = new Map([['c', 9000]]);
  for (let i = 0; i < 4000; i++) {
    const t = pickTarget(rng, 'a', alive, attackers, 10000);
    assert.notEqual(t, 'a');
    counts[t]++;
  }
  // c gets half from revenge plus a quarter of the other half
  assert.ok(counts.c > 4000 * 0.55 && counts.c < 4000 * 0.7, `c: ${counts.c}`);
  for (const id of ['b', 'd', 'e']) assert.ok(counts[id] > 4000 * 0.1 && counts[id] < 4000 * 0.2);
  // an old attacker (past 10 s) or a dead one earns nothing
  const old = new Map([['c', 0]]);
  const cOld = Array.from({ length: 2000 }, () => pickTarget(rng, 'a', alive, old, 20000)).filter((t) => t === 'c').length;
  assert.ok(cOld < 2000 * 0.35, `old attacker: ${cOld}`);
  const dead = Array.from({ length: 500 }, () => pickTarget(rng, 'a', ['a', 'b'], new Map([['c', 9000]]), 10000));
  assert.ok(dead.every((t) => t === 'b'));
});

test('placement points go from 100 to 0 and ordinals read right', () => {
  assert.equal(placePoints(1, 8), 100);
  assert.equal(placePoints(8, 8), 0);
  assert.equal(placePoints(2, 8), 86);
  assert.equal(placePoints(5, 8), 43);
  assert.equal(placePoints(1, 2), 100);
  assert.equal(placePoints(2, 2), 0);
  assert.equal(placePoints(1, 1), 100);
  const pts = Array.from({ length: 12 }, (_, i) => placePoints(i + 1, 12));
  for (let i = 1; i < pts.length; i++) assert.ok(pts[i] < pts[i - 1]);
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(ordinal), ['1ST', '2ND', '3RD', '4TH', '11TH', '12TH', '13TH', '21ST', '22ND', '23RD', '101ST']);
});

test('sudden death puts a line on every board every ten seconds after eight minutes', () => {
  assert.equal(suddenDue(0), 0);
  assert.equal(suddenDue(SUDDEN_MS - 1), 0);
  assert.equal(suddenDue(SUDDEN_MS), 1);
  assert.equal(suddenDue(SUDDEN_MS + SUDDEN_EVERY), 2);
  assert.ok(CAP_MS > SUDDEN_MS + 6 * SUDDEN_EVERY);
  for (let i = 0; i < 40; i++) {
    const col = suddenCol(1234, i);
    assert.ok(Number.isInteger(col) && col >= 0 && col <= 9);
    assert.equal(col, suddenCol(1234, i), 'the same on every page');
  }
});

test('rosters: people first, bots to eight seats, unique ids, colours and skills', () => {
  const r = buildRoster(['u1', 'u2'], 77);
  assert.equal(r.length, 8);
  assert.deepEqual(r.slice(0, 2).map((e) => [e.id, e.bot]), [['u1', 0], ['u2', 0]]);
  assert.equal(r.filter((e) => e.bot).length, 6);
  assert.equal(new Set(r.map((e) => e.id)).size, 8);
  assert.equal(new Set(r.filter((e) => e.bot).map((e) => e.n)).size, 6, 'bot names differ');
  for (const e of r.filter((x) => x.bot)) assert.ok(e.s >= 0.15 && e.s <= 0.95 && typeof e.n === 'string' && /^bot\d$/.test(e.id));
  const skills = r.filter((e) => e.bot).map((e) => e.s);
  assert.ok(Math.max(...skills) - Math.min(...skills) > 0.6, 'a spread of weak and strong');
  assert.deepEqual(buildRoster(['u1', 'u2'], 77), r, 'deterministic');
  assert.notDeepEqual(buildRoster(['u1', 'u2'], 78).map((e) => e.n), r.map((e) => e.n));
  assert.equal(buildRoster([], 5).length, 8);
  assert.equal(buildRoster(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 5).filter((e) => e.bot).length, 0, 'eight people: no bots');
  assert.equal(buildRoster(Array.from({ length: 12 }, (_, i) => `p${i}`), 5).length, 12);
  assert.equal(buildRoster(Array.from({ length: 20 }, (_, i) => `p${i}`), 5).length, 12, 'at most twelve');
  assert.equal(buildRoster(['a', 'a', '', 'b'], 5).filter((e) => !e.bot).length, 2, 'duplicates and blanks dropped');
  for (const e of r) assert.ok(e.c >= 0 && e.c < COLORS.length);
  assert.ok(Math.abs(ppsFor(0) - 1.2) < 1e-9 && Math.abs(ppsFor(1) - 2.5) < 1e-9);
});
