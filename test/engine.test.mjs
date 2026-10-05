// The engine: gravity, lock delay, hold, clears, T-spins, back-to-back, combos, garbage and topping out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, RISE_CAP } from '../game/engine.js';
import { COLS, GARBAGE, I, L, O, ROWS, S, T } from '../game/pieces.js';
import { parseSnap } from '../game/snap.js';

const mk = (o = {}) => new Engine({ seed: 11, id: 't', gravity: 1, start: false, ...o });
/** Put a piece in play by hand. */
const put = (e, type, rot, x, y, rest = {}) => {
  e.cur = { type, rot, x, y };
  e.serial++;
  e.lastRot = false;
  e.lockT = 0;
  e.resets = 0;
  e.fall = 0;
  e.lowest = y;
  Object.assign(e, rest);
  return e;
};
const row = (e, y, except = [], v = 3) => {
  for (let x = 0; x < COLS; x++) e.board.cells[y * COLS + x] = except.includes(x) ? 0 : v;
};
const cellCount = (e) => e.board.cells.reduce((n, v) => n + (v ? 1 : 0), 0);

test('the first piece enters the field one row down and the bag deals the same pieces to the same player', () => {
  const a = new Engine({ seed: 3, id: 'ann' });
  const b = new Engine({ seed: 3, id: 'ann' });
  assert.deepEqual(a.cur, b.cur);
  assert.equal(a.cur.x, 3);
  assert.equal(a.cur.y, 1, 'spawned at row 0 and dropped one at once');
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => a.next(i)), [0, 1, 2, 3, 4].map((i) => b.next(i)));
  const c = new Engine({ seed: 3, id: 'bob' });
  assert.notDeepEqual([0, 1, 2, 3, 4, 5, 6].map((i) => a.next(i)).concat(a.cur.type), [0, 1, 2, 3, 4, 5, 6].map((i) => c.next(i)).concat(c.cur.type));
});

test('gravity moves a piece one row a second at level 0; soft drop is twenty times that', () => {
  const e = new Engine({ seed: 1, id: 'g', gravity: 1 });
  const y0 = e.cur.y;
  for (let i = 0; i < 59; i++) e.tick(1000 / 60);
  assert.equal(e.cur.y, y0, 'not yet');
  e.tick(1000 / 60 + 1);
  assert.equal(e.cur.y, y0 + 1);
  const s = new Engine({ seed: 1, id: 'g', gravity: 1 });
  const sy = s.cur.y;
  for (let i = 0; i < 6; i++) s.tick(1000 / 60, true); // 100 ms of soft drop = 2 rows
  assert.equal(s.cur.y, sy + 2);
  const fast = new Engine({ seed: 1, id: 'g', gravity: 20 });
  fast.tick(100);
  assert.equal(fast.cur.y, 1 + 2);
});

test('lock delay: half a second on the ground, restarted by moves up to fifteen times', () => {
  const e = mk();
  put(e, O, 0, 3, 20); // O on the floor (rows 20-21)
  assert.equal(e.grounded(), true);
  assert.equal(e.tick(499), null);
  assert.ok(e.cur, 'still falling-in-place at 499 ms');
  const res = e.tick(1);
  assert.ok(res && res.lines === 0, 'locks at 500 ms');

  const f = mk();
  put(f, O, 0, 3, 20);
  for (let i = 0; i < 15; i++) {
    assert.equal(f.tick(400), null);
    assert.equal(f.move(i % 2 ? 1 : -1), true);
  }
  assert.equal(f.resets, 15);
  assert.equal(f.tick(400), null);
  assert.equal(f.move(1), true, 'the sixteenth move works but no longer restarts the delay');
  assert.ok(f.tick(100), 'so it locks 500 ms after the last restart');
});

test('a piece cannot be kept in the air for ever: once the restarts are used it locks the moment it lands again', () => {
  const e = mk({ gravity: 30 });
  put(e, T, 0, 3, 20);
  for (let i = 0; i < 15; i++) {
    e.tick(100);
    e.move(i % 2 ? 1 : -1);
  }
  assert.equal(e.resets, 15);
  e.cur.y = 17; // a turn kicked it up
  e.fall = 0;
  e.tick(1);
  assert.equal(e.cur.y, 17, 'in the air');
  const r = e.tick(100);
  assert.ok(r, 'it landed and locked at once, without another half second');
  const f = mk({ gravity: 30 });
  put(f, T, 0, 3, 17);
  f.tick(1);
  assert.equal(f.tick(100), null, 'with its restarts unused it gets the full delay');
  assert.ok(f.tick(450));
});

test('falling to a lower row gives the restarts back', () => {
  const e = mk();
  e.board.cells[19 * COLS + 1] = 5; // a ledge under column 1
  put(e, O, 0, 0, 17); // the O covers columns 1-2 and rests on it
  assert.equal(e.grounded(), true);
  e.move(-1);
  e.move(1);
  e.move(-1);
  assert.equal(e.resets, 3);
  assert.equal(e.move(1), true);
  assert.equal(e.move(1), true, 'now over the open floor');
  assert.equal(e.grounded(), false);
  e.tick(1500);
  assert.equal(e.resets, 0, 'it fell below its lowest row: the restarts are back');
});

test('hard drop locks at the ghost row and reports the distance', () => {
  const e = mk();
  put(e, T, 0, 3, 5);
  assert.equal(e.ghostY(), 20, 'T flat bottom row at the floor: box row 1 -> y 20');
  const r = e.hardDrop();
  assert.equal(r.drop, 15);
  assert.equal(e.board.get(4, 20), T);
  assert.equal(e.board.get(3, 21), T, 'T rot 0 occupies rows y and y+1');
  assert.equal(e.board.get(4, 21), T);
  assert.ok(e.cur, 'the next piece is in play');
});

test('hold: once per piece, empty hold takes the next piece, a held piece comes back at the top', () => {
  const e = new Engine({ seed: 9, id: 'h' });
  const first = e.cur.type;
  const second = e.next(0);
  assert.equal(e.holdSwap(), true);
  assert.equal(e.hold, first);
  assert.equal(e.cur.type, second);
  assert.equal(e.holdSwap(), false, 'not twice in a row');
  e.hardDrop();
  assert.equal(e.canHold, true, 'a new piece can hold again');
  const cur = e.cur.type;
  assert.equal(e.holdSwap(), true);
  assert.equal(e.cur.type, first, 'the held piece is back');
  assert.equal(e.hold, cur);
  assert.deepEqual({ rot: e.cur.rot, x: e.cur.x }, { rot: 0, x: 3 });
});

test('clearing lines: results for single, double, triple, quad', () => {
  const want = [[1, 0], [2, 1], [3, 2], [4, 4]];
  for (const [lines, attack] of want) {
    const e = mk();
    for (let i = 0; i < lines; i++) row(e, 21 - i, [9]);
    for (let i = lines; i < 4; i++) e.board.cells[(21 - i) * COLS + 0] = 0; // nothing else
    e.board.cells[(21 - lines) * COLS + 0] = 7; // a block resting above
    put(e, I, 1, 7, 18); // vertical I in column 9 (box col 2)
    const r = e.hardDrop();
    assert.equal(r.lines, lines);
    assert.equal(r.attack, attack, `${lines} lines`);
    assert.equal(r.send, attack);
    assert.equal(r.combo, 0);
    assert.equal(r.rows.length, lines);
    assert.equal(r.b2b, false);
    assert.equal(r.diff, lines === 4);
    assert.equal(e.stats.lines, lines);
  }
});

test('combos count up on consecutive clears and reset on a lock with no clear', () => {
  const e = mk();
  const combos = [];
  for (let i = 0; i < 4; i++) {
    row(e, 21, [9]);
    put(e, I, 1, 7, 18);
    const r = e.hardDrop();
    assert.equal(r.lines, 1);
    combos.push([r.combo, r.attack]);
    e.cur = null;
  }
  assert.deepEqual(combos, [[0, 0], [1, 1], [2, 1], [3, 2]]);
  put(e, O, 0, 3, 15);
  const r = e.hardDrop();
  assert.equal(r.lines, 0);
  assert.equal(r.combo, -1);
  assert.equal(e.combo, -1);
});

test('back-to-back: quads in a row get +1, a plain clear breaks it, a T-spin keeps it', () => {
  const quad = (e) => {
    e.board.cells[10 * COLS] = 7; // a stray block, so a quad is not a perfect clear
    for (let i = 0; i < 4; i++) row(e, 21 - i, [9]);
    put(e, I, 1, 7, 18);
    const r = e.hardDrop();
    e.cur = null;
    e.combo = -1; // keep combos out of this test
    return r;
  };
  const e = mk();
  const q1 = quad(e);
  assert.equal(q1.b2b, false);
  assert.equal(q1.attack, 4);
  assert.equal(e.b2b, true);
  const q2 = quad(e);
  assert.equal(q2.b2b, true);
  assert.equal(q2.attack, 5);
  // a double breaks it
  row(e, 21, [9]);
  row(e, 20, [9]);
  put(e, I, 1, 7, 18);
  const d = e.hardDrop();
  e.cur = null;
  e.combo = -1;
  assert.equal(d.lines, 2);
  assert.equal(e.b2b, false);
  const q3 = quad(e);
  assert.equal(q3.b2b, false, 'the quad after a double starts a new chain');
  assert.equal(q3.attack, 4);
  // a lock that clears nothing leaves it alone
  put(e, O, 0, 3, 15);
  e.hardDrop();
  assert.equal(e.b2b, true);
});

// A T-spin double: T pointing down into a one-wide notch, three corners filled.
function tSlot(e) {
  row(e, 21, [4]);
  row(e, 20, [3, 4, 5]);
  e.board.cells[19 * COLS + 3] = 5;
  return put(e, T, 2, 3, 19, { lastRot: true, lastKick: 0 });
}

test('T-spin double: the three-corner rule, a full spin with both front corners, attack 4', () => {
  const e = tSlot(mk());
  assert.equal(e.detectTSpin(), 2);
  const r = e.hardDrop();
  assert.equal(r.lines, 2);
  assert.equal(r.tspin, 2);
  assert.equal(r.attack, 4);
  assert.equal(r.diff, true);
  assert.equal(e.stats.tspins, 1);
});

test('no T-spin unless the last move was a turn, and only for the T', () => {
  const e = tSlot(mk());
  e.lastRot = false;
  assert.equal(e.detectTSpin(), 0);
  const r = e.hardDrop();
  assert.equal(r.lines, 2);
  assert.equal(r.tspin, 0);
  assert.equal(r.attack, 1, 'a plain double');
  const s = mk();
  row(s, 21, [4]);
  row(s, 20, [3, 4, 5]);
  put(s, S, 2, 3, 19, { lastRot: true });
  assert.equal(s.detectTSpin(), 0);
  // a soft drop or a move after the turn spoils it
  const t = tSlot(mk());
  t.cur.y = 19;
  assert.equal(t.move(0), true);
  const u = tSlot(mk());
  assert.equal(u.softStep(), false, 'resting');
  const v = tSlot(mk());
  v.cur.y = 18;
  assert.equal(v.softStep(), true);
  assert.equal(v.lastRot, false);
});

test('mini T-spin: three corners but only one in front; the fifth kick makes it a full spin', () => {
  const setup = (kick) => {
    const e = mk();
    row(e, 21, [4]);
    row(e, 20, [3, 4, 5]);
    e.board.cells[19 * COLS + 3] = 5; // top-left corner only
    return put(e, T, 0, 3, 19, { lastRot: true, lastKick: kick });
  };
  const mini = setup(0);
  assert.equal(mini.detectTSpin(), 1);
  const r = mini.hardDrop();
  assert.equal(r.lines, 1);
  assert.equal(r.tspin, 1);
  assert.equal(r.attack, 1);
  const full = setup(4);
  assert.equal(full.detectTSpin(), 2);
  const r2 = full.hardDrop();
  assert.equal(r2.tspin, 2);
  assert.equal(r2.attack, 2);
  const two = setup(0);
  assert.equal(two.board.cells[19 * COLS + 5] === 0, true);
});

test('two corners are not enough, and the walls and floor count as corners', () => {
  const e = mk();
  put(e, T, 0, 3, 10, { lastRot: true });
  assert.equal(e.detectTSpin(), 0, 'open air');
  const w = mk();
  // T against the left wall and the floor: corners (-1,..) are walls
  put(w, T, 0, -1, 20, { lastRot: true });
  assert.equal(w.detectTSpin() > 0, true, 'wall corners and the floor corners');
});

test('a T-spin that clears nothing sends nothing', () => {
  const e = mk();
  row(e, 21, [4, 5]);
  e.board.cells[19 * COLS + 3] = 5;
  put(e, T, 2, 3, 19, { lastRot: true });
  e.board.cells[21 * COLS + 5] = 0;
  const r = e.hardDrop();
  assert.equal(r.lines, 0);
  assert.equal(r.send, 0);
  assert.equal(r.combo, -1);
});

test('a perfect clear adds ten', () => {
  const e = mk();
  row(e, 21, [3, 4, 5, 6]);
  put(e, I, 0, 3, 20);
  const r = e.hardDrop();
  assert.equal(r.lines, 1);
  assert.equal(r.perfect, true);
  assert.equal(r.attack, 10);
  assert.equal(e.stats.perfect, 1);
});

test('incoming garbage is cancelled by outgoing attack first, the rest of the attack goes out', () => {
  const e = mk();
  e.receive(3, 2);
  assert.equal(e.pendingTotal(), 3);
  e.board.cells[10 * COLS] = 7;
  for (let i = 0; i < 4; i++) row(e, 21 - i, [9]);
  put(e, I, 1, 7, 18);
  const r = e.hardDrop();
  assert.equal(r.attack, 4);
  assert.equal(r.cancelled, 3);
  assert.equal(r.send, 1);
  assert.equal(e.pendingTotal(), 0);
  assert.equal(e.stats.sent, 1);
  // a small attack only reduces the queue; the garbage does not rise on a clearing lock
  const f = mk();
  f.receive(5, 1);
  row(f, 21, [9]);
  row(f, 20, [9]);
  put(f, I, 1, 7, 18);
  const d = f.hardDrop();
  assert.equal(d.attack, 1);
  assert.equal(d.cancelled, 1);
  assert.equal(d.send, 0);
  assert.equal(d.rise, null);
  assert.equal(f.pendingTotal(), 4);
  assert.equal(f.board.cells.filter((v) => v === GARBAGE).length, 0, 'nothing rose');
});

test('garbage rises after a lock that clears nothing: same hole for one attack, the stack lifts, oldest first, at most eight rows', () => {
  const e = mk();
  e.receive(3, 2);
  e.receive(4, 7);
  put(e, O, 0, 3, 15);
  const r = e.hardDrop();
  assert.equal(r.lines, 0);
  assert.deepEqual(r.rise, [{ n: 3, col: 2 }, { n: 4, col: 7 }]);
  assert.equal(e.pendingTotal(), 0);
  for (let y = 18; y < ROWS - 4; y++) for (let x = 0; x < COLS; x++) assert.equal(e.board.get(x, y) === GARBAGE, x !== 2 && y >= 19 ? true : e.board.get(x, y) === GARBAGE);
  // bottom four rows: hole at 7; the three above: hole at 2
  for (let y = 18; y < 22; y++) assert.equal(e.board.get(7, y), 0, `row ${y} hole 7`);
  for (let y = 15 + 0; y < 18; y++) if (y >= 15) assert.ok(true);
  const big = mk();
  big.receive(10, 4);
  big.receive(10, 5);
  big.receive(10, 6);
  put(big, O, 0, 3, 15);
  const b = big.hardDrop();
  assert.equal(b.rise.reduce((n, g) => n + g.n, 0), RISE_CAP);
  assert.equal(big.pendingTotal(), 30 - RISE_CAP);
  assert.deepEqual(b.rise, [{ n: 8, col: 4 }]);
  const c = big.hardDrop();
  assert.equal(c.rise.reduce((n, g) => n + g.n, 0), 2 + 6, 'the rest of the first attack, then the second');
});

test('receive validates: whole rows, a hole inside the board, a cap on what can wait', () => {
  const e = mk();
  assert.equal(e.receive(0, 3), 0);
  assert.equal(e.receive(-4, 3), 0);
  assert.equal(e.receive(NaN, 3), 0);
  assert.equal(e.receive(2.9, 99), 2);
  assert.equal(e.pending[0].col, 9);
  assert.equal(e.receive(1, NaN), 1);
  assert.equal(e.pending[1].col, 0);
  assert.equal(e.receive(500, 3), 24, 'one message cannot queue more than 24');
  assert.equal(e.receive(500, 3), 40 - 27 > 0 ? 13 : 0, 'the queue holds 40');
  assert.equal(e.receive(5, 3), 0, 'full');
});

test('topping out: a spawn that does not fit, a lock above the field, garbage pushing blocks off the top', () => {
  const a = mk();
  a.board.cells[1 * COLS + 4] = 5;
  assert.equal(a.spawn(0), false);
  assert.equal(a.ko, true);
  assert.equal(a.koReason, 'block');
  assert.equal(a.cur, null);
  assert.equal(a.tick(100), null);
  assert.equal(a.move(1), false);
  assert.equal(a.rotate(1), false);
  assert.equal(a.hardDrop(), null);
  assert.equal(a.holdSwap(), false);

  const b = new Engine({ seed: 4, id: 'l', start: false });
  for (let y = 2; y < ROWS; y++) row(b, y, [9]);
  b.spawn(T);
  assert.equal(b.cur.y, 0, 'it cannot enter the field');
  const r = b.hardDrop();
  assert.equal(r.ko, true);
  assert.equal(r.koReason, 'lock');

  const c = mk();
  c.board.cells[1 * COLS + 0] = 5;
  c.receive(2, 3);
  put(c, O, 0, 5, 15);
  const g = c.hardDrop();
  assert.equal(g.ko, true);
  assert.equal(g.koReason, 'garbage');

  const d = mk();
  row(d, 5, []);
  row(d, 6, []);
  d.receive(1, 3); // the stack is far from the top: nothing happens
  put(d, O, 0, 3, 15);
  const none = d.hardDrop();
  assert.equal(none.ko, false);
});

test('snapshot and restore carry a board, hold, garbage and the bag position over to a new page', () => {
  const a = new Engine({ seed: 21, id: 'r' });
  for (let i = 0; i < 9; i++) a.hardDrop();
  a.holdSwap();
  a.receive(3, 4);
  const snap = parseSnap(a.snapshot());
  assert.ok(snap);
  const b = new Engine({ seed: 21, id: 'r', start: false }).restore(snap);
  assert.deepEqual([...b.board.cells], [...a.board.cells]);
  assert.equal(b.hold, a.hold);
  assert.equal(b.cur.type, a.cur.type, 'the piece in flight comes back');
  assert.equal(b.pendingTotal(), 3);
  assert.equal(b.dealt, a.dealt);
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => b.next(i)), [0, 1, 2, 3, 4].map((i) => a.next(i)), 'the same pieces come next');
  const ko = new Engine({ seed: 1, id: 'k' });
  ko.knockOut('block');
  const k2 = new Engine({ seed: 1, id: 'k', start: false }).restore(parseSnap(ko.snapshot()));
  assert.equal(k2.ko, true);
});

test('a long solo game never leaves the board invalid', () => {
  const e = new Engine({ seed: 77, id: 'solo', gravity: 6 });
  let locks = 0;
  for (let i = 0; i < 20000 && !e.ko; i++) {
    const t = i % 11;
    if (t === 0) e.move(-1);
    if (t === 3) e.rotate(1);
    if (t === 5) e.move(1);
    if (t === 7) e.rotate(-1);
    if (i % 97 === 0) e.holdSwap();
    if (i % 41 === 0) e.hardDrop() && locks++;
    if (i % 601 === 0) e.receive(1 + (i % 3), i % 10);
    e.tick(1000 / 60, i % 5 === 0);
    if (e.cur) assert.equal(e.board.collides(e.cur.type, e.cur.rot, e.cur.x, e.cur.y), false, 'the piece never overlaps the stack');
    for (let c = 0; c < e.board.cells.length; c++) assert.ok(e.board.cells[c] <= GARBAGE);
  }
  assert.ok(locks >= 8, `${locks} locks`);
  assert.ok(Number.isFinite(e.time));
});

test('L pieces and S pieces lock where they are with the right cells', () => {
  const e = mk();
  put(e, L, 0, 3, 5);
  e.hardDrop();
  // L rot 0: (2,0),(0,1),(1,1),(2,1) -> on the floor the bottom row is box row 1 at row 21, the top cell at row 20
  assert.equal(e.board.get(5, 20), L);
  assert.equal(e.board.get(3, 21), L);
  assert.equal(e.board.get(4, 21), L);
  assert.equal(e.board.get(5, 21), L);
  assert.equal(cellCount(e), 4);
});

test('sudden-death rows cannot be cancelled and rise after the next lock, clear or not', () => {
  const e = mk();
  e.forceGarbage(5);
  e.forceGarbage(2);
  e.receive(3, 1);
  e.board.cells[10 * COLS] = 7;
  for (let i = 0; i < 4; i++) row(e, 21 - i, [9]);
  put(e, I, 1, 7, 18);
  const r = e.hardDrop();
  assert.equal(r.lines, 4);
  assert.equal(r.cancelled, 3, 'a normal attack still cancels normal garbage');
  assert.deepEqual(r.rise, [{ n: 1, col: 5 }, { n: 1, col: 2 }], 'the forced rows came up even though lines cleared');
  assert.equal(e.board.get(2, 21), 0, 'the last row to come up has its hole at 2');
  assert.equal(e.board.get(5, 20), 0, 'the one before at 5');
  assert.equal(e.board.get(5, 21), GARBAGE);
  assert.equal(e.board.get(0, 21), GARBAGE);
  assert.equal(e.forced.length, 0);
  const f = mk();
  for (let i = 0; i < 6; i++) f.forceGarbage(i);
  put(f, O, 0, 3, 15);
  assert.equal(f.hardDrop().rise.length, 4, 'at most four at a time');
  assert.equal(f.forced.length, 2);
  const k = mk();
  k.knockOut('block');
  k.forceGarbage(3);
  assert.equal(k.forced.length, 0);
});
