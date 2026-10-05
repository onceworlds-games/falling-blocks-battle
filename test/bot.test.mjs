// The bots: the search finds only spots that can really be reached (and the path it reports gets there), the score prefers what
// it should, and a bot at the keys plays legally at a human pace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CMD, Brain, bestPlacement, candidates, pathTo, search, stateIndex, weightsFor } from '../game/bot.js';
import { Engine } from '../game/engine.js';
import { COLS, GARBAGE, I, O, ROWS, T } from '../game/pieces.js';
import { mulberry32 } from '../game/rng.js';
import { ppsFor } from '../game/rules.js';

const fill = (e, y, except = [], v = 3) => {
  for (let x = 0; x < COLS; x++) e.board.cells[y * COLS + x] = except.includes(x) ? 0 : v;
};
const engineWith = (type) => {
  const e = new Engine({ seed: 1, id: 'b', start: false });
  e.spawn(type);
  return e;
};
const run = (e, cmds) => {
  for (const c of cmds) {
    if (c === CMD.left) e.move(-1);
    else if (c === CMD.right) e.move(1);
    else if (c === CMD.down) e.softStep();
    else if (c === CMD.sonic) e.sonic();
    else if (c === CMD.cw) e.rotate(1);
    else e.rotate(-1);
  }
};

test('every spot the search reports can be reached by its path, and a T-spin spot ends on a turn', () => {
  const rng = mulberry32(5);
  let checked = 0;
  let spins = 0;
  for (let n = 0; n < 300; n++) {
    const e = new Engine({ seed: n + 1, id: 'p', start: false });
    // a lumpy random stack
    const rows = 3 + Math.floor(rng() * 9);
    for (let y = ROWS - rows; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (rng() < 0.55) e.board.cells[y * COLS + x] = 1 + Math.floor(rng() * 7);
    e.board.clearLines();
    const type = 1 + Math.floor(rng() * 7);
    if (!e.spawn(type)) continue;
    const c = e.cur;
    const w = weightsFor(0.5);
    w.noise = 0;
    const { start, list } = candidates(e.board, type, c.x, c.y, c.rot, 0, w, 0, null);
    for (const cand of list.slice(0, 12)) {
      const path = pathTo(start, cand.idx);
      const f = new Engine({ seed: 1, id: 'p', start: false });
      f.board.cells.set(e.board.cells);
      f.spawn(type);
      run(f, path);
      assert.deepEqual([f.cur.x, f.cur.y, f.cur.rot], [cand.x, cand.y, cand.rot], `piece ${type} path ${path.join(',')}`);
      assert.equal(f.board.collides(type, f.cur.rot, f.cur.x, f.cur.y + 1), true, 'it rests there');
      if (type === T && cand.flag) {
        assert.equal(f.lastRot, true, 'the last move was a turn');
        spins++;
      }
      checked++;
    }
  }
  assert.ok(checked > 1500, `${checked} spots checked`);
  assert.ok(spins > 20, `${spins} T turns`);
});

test('on an empty board the search finds every column and turn', () => {
  const e = engineWith(O);
  const w = weightsFor(0.5);
  const o = candidates(e.board, O, e.cur.x, e.cur.y, 0, 0, w, 0, null);
  assert.equal(o.list.length, 9, 'an O fits in nine columns');
  const i = engineWith(I);
  const flat = candidates(i.board, I, i.cur.x, i.cur.y, 0, 0, w, 0, null).list;
  assert.equal(flat.filter((c) => c.rot === 0 || c.rot === 2).length, 14, 'flat I: 7 columns x 2 states');
  assert.equal(flat.filter((c) => c.rot === 1 || c.rot === 3).length, 20, 'upright I: 10 columns x 2 states');
  const t = engineWith(T);
  const tl = candidates(t.board, T, t.cur.x, t.cur.y, 0, 0, w, 0, null).list;
  for (const rot of [0, 1, 2, 3]) assert.ok(tl.some((c) => c.rot === rot));
});

test('an upright I into a well makes a quad, for a weak bot and a strong one', () => {
  for (const skill of [0.1, 1]) {
    const e = new Engine({ seed: 3, id: 'q', start: false });
    for (let y = ROWS - 4; y < ROWS; y++) fill(e, y, [9]);
    e.board.cells[(ROWS - 5) * COLS] = 7;
    e.spawn(I);
    const best = bestPlacement(e.board, I, e.cur.x, e.cur.y, 0, 0, skill);
    assert.equal(best.lines, 4, `skill ${skill}`);
    assert.equal(best.rot % 2, 1);
  }
});

test('a strong bot holds a single back when the stack is low, a weak one takes it', () => {
  const setup = () => {
    const e = new Engine({ seed: 3, id: 'q', start: false });
    fill(e, ROWS - 1, [9]);
    e.spawn(I);
    return e;
  };
  const e1 = setup();
  const weak = bestPlacement(e1.board, I, e1.cur.x, e1.cur.y, 0, 0, 0.0);
  assert.equal(weak.lines, 1, 'a weak bot clears');
  const e2 = setup();
  const strong = bestPlacement(e2.board, I, e2.cur.x, e2.cur.y, 0, 0, 1);
  assert.equal(strong.lines, 0, 'a strong bot builds on');
});

test('with the stack high a strong bot clears whatever it can', () => {
  const e = new Engine({ seed: 3, id: 'q', start: false });
  for (let y = ROWS - 13; y < ROWS; y++) fill(e, y, [9]);
  e.spawn(I);
  const best = bestPlacement(e.board, I, e.cur.x, e.cur.y, 0, 0, 1);
  assert.ok(best.lines >= 1);
});

test('a strong bot goes for a T-spin double when the slot is there', () => {
  const e = new Engine({ seed: 3, id: 'q', start: false });
  fill(e, 21, [4]);
  fill(e, 20, [3, 4, 5]);
  e.board.cells[19 * COLS + 3] = 5;
  e.spawn(T);
  const best = bestPlacement(e.board, T, e.cur.x, e.cur.y, 0, 0, 1);
  assert.equal(best.lines, 2);
  assert.equal(best.tspin, 2);
  // and the path to it really ends in a turn
  const w = weightsFor(1);
  w.noise = 0;
  const { start, list } = candidates(e.board, T, e.cur.x, e.cur.y, 0, 0, w, 0, null);
  const path = pathTo(start, list[0].idx);
  assert.ok([CMD.cw, CMD.ccw].includes(path[path.length - 1]));
  const f = new Engine({ seed: 3, id: 'q', start: false });
  f.board.cells.set(e.board.cells);
  f.spawn(T);
  run(f, path);
  const r = f.hardDrop();
  assert.equal(r.tspin, 2);
  assert.equal(r.lines, 2);
});

test('search from a stuck state finds nothing worse than the start itself', () => {
  const e = engineWith(T);
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (x !== 4) e.board.cells[y * COLS + x] = GARBAGE;
  const start = search(e.board, T, e.cur.x, e.cur.y, 0, 0);
  assert.ok(start >= 0);
  assert.equal(pathTo(start, stateIndex(0, 0, 0, 0)).length, 0, 'an unreachable target has no path');
});

test('a bot at the keys plays legally for hundreds of pieces and never leaves the board invalid', () => {
  for (const skill of [0, 0.35, 0.7, 1]) {
    const e = new Engine({ seed: 9, id: `bot${skill}`, gravity: 2 });
    const brain = new Brain(e, { skill, rng: mulberry32(skill * 100 + 1) });
    let locks = 0;
    for (let i = 0; i < 60 * 150 && !e.ko; i++) {
      brain.update(1000 / 60, (res) => {
        locks++;
        assert.ok(Number.isFinite(res.lines) && res.lines >= 0 && res.lines <= 4);
      });
      if (e.cur) assert.equal(e.board.collides(e.cur.type, e.cur.rot, e.cur.x, e.cur.y), false, 'no overlap');
      for (let c = 0; c < e.board.cells.length; c++) assert.ok(e.board.cells[c] <= GARBAGE);
    }
    assert.ok(locks >= 60, `skill ${skill}: ${locks} pieces`);
  }
});

test('bots play at a human pace: about 1.2 pieces a second when weak, 2.5 when strong', () => {
  const pace = (skill) => {
    const e = new Engine({ seed: 4, id: `pace${skill}`, gravity: 1 });
    const brain = new Brain(e, { skill, rng: mulberry32(7) });
    let t = 0;
    let n = 0;
    while (t < 40000 && !e.ko) {
      brain.update(1000 / 60, () => n++);
      t += 1000 / 60;
    }
    return n / (t / 1000);
  };
  const weak = pace(0);
  const strong = pace(1);
  assert.ok(weak > 0.9 && weak < 1.6, `weak ${weak.toFixed(2)}/s`);
  assert.ok(strong > 2.0 && strong < 3.2, `strong ${strong.toFixed(2)}/s`);
  assert.ok(Math.abs(ppsFor(0) - 1.2) < 1e-9);
});

test('a bot digs out of a garbage stack instead of freezing, and uses the hold', () => {
  const e = new Engine({ seed: 6, id: 'dig', gravity: 1 });
  e.receive(8, 3);
  const brain = new Brain(e, { skill: 0.8, rng: mulberry32(2) });
  let held = 0;
  const hold = e.holdSwap.bind(e);
  e.holdSwap = () => {
    held++;
    return hold();
  };
  let locks = 0;
  for (let i = 0; i < 60 * 20 && !e.ko; i++) brain.update(1000 / 60, () => locks++);
  assert.ok(locks > 15, `${locks} pieces played with garbage on the board`);
  assert.ok(held > 0, 'it held a piece');
});
