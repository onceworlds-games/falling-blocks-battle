import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../game/board.js';
import { COLS, GARBAGE, I, O, ROWS, T } from '../game/pieces.js';
import { ENCODED_LENGTH, decodeCells, encodeCells, parseSnap } from '../game/snap.js';

const fillRow = (b, y, except = []) => {
  for (let x = 0; x < COLS; x++) b.cells[y * COLS + x] = except.includes(x) ? 0 : 3;
};
const count = (b) => b.cells.reduce((s, v) => s + (v ? 1 : 0), 0);

test('collisions: walls, floor, ceiling and blocks', () => {
  const b = new Board();
  assert.equal(b.collides(T, 0, 3, 5), false);
  assert.equal(b.collides(T, 0, -1, 5), true, 'left wall');
  assert.equal(b.collides(T, 0, 8, 5), true, 'right wall');
  assert.equal(b.collides(I, 0, 3, ROWS - 2), false, 'an I flat in box row 1 at y 20 lies on the floor row 21');
  assert.equal(b.collides(I, 0, 3, ROWS - 1), true, 'one lower is below the floor');
  assert.equal(b.collides(T, 0, 3, -2), true, 'above the top');
  b.cells[10 * COLS + 4] = 5;
  assert.equal(b.collides(O, 0, 3, 9), true, 'O covers (4,10)');
  assert.equal(b.collides(O, 0, 5, 9), false);
  assert.equal(b.get(-1, 0), 9);
  assert.equal(b.get(4, 10), 5);
  assert.equal(b.solid(4, 10), true);
  assert.equal(b.solid(4, 9), false);
});

test('place writes the piece type', () => {
  const b = new Board();
  b.place(T, 0, 3, 10);
  assert.equal(b.get(4, 10), T);
  assert.equal(b.get(3, 11), T);
  assert.equal(b.get(5, 11), T);
  assert.equal(count(b), 4);
});

test('clearing 1, 2, 3 and 4 lines; rows above fall exactly the right amount', () => {
  for (let n = 1; n <= 4; n++) {
    const b = new Board();
    for (let i = 0; i < n; i++) fillRow(b, ROWS - 1 - i);
    b.cells[(ROWS - 1 - n) * COLS + 2] = 7; // a lone block resting on top
    const rows = b.clearLines();
    assert.equal(rows.length, n);
    assert.deepEqual(rows, Array.from({ length: n }, (_, i) => ROWS - n + i), 'cleared indices, top first');
    assert.equal(b.get(2, ROWS - 1), 7, `the block fell ${n} rows to the floor`);
    assert.equal(count(b), 1);
  }
});

test('clearing rows that are not touching', () => {
  const b = new Board();
  fillRow(b, 21);
  fillRow(b, 19);
  fillRow(b, 20, [3]); // not full
  fillRow(b, 18, [0]); // not full
  b.cells[17 * COLS + 9] = 6;
  const rows = b.clearLines();
  assert.deepEqual(rows, [19, 21]);
  // after clearing: old 20 -> 21, old 18 -> 20, old 17 -> 19
  assert.equal(b.get(3, 21), 0);
  assert.equal(b.get(0, 21), 3);
  assert.equal(b.get(0, 20), 0);
  assert.equal(b.get(1, 20), 3);
  assert.equal(b.get(9, 19), 6);
  assert.equal(b.clearLines().length, 0, 'nothing more to clear');
});

test('a perfect clear leaves an empty board', () => {
  const b = new Board();
  fillRow(b, 21);
  assert.equal(b.isEmpty(), false);
  b.clearLines();
  assert.equal(b.isEmpty(), true);
});

test('garbage rises: rows pushed up, one hole, the stack moves with it', () => {
  const b = new Board();
  b.cells[21 * COLS + 5] = 4;
  const over = b.addGarbage(3, 6);
  assert.equal(over, false);
  assert.equal(b.get(5, 18), 4, 'the old block went up three rows');
  for (let y = 19; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) assert.equal(b.get(x, y), x === 6 ? 0 : GARBAGE, `garbage row ${y}`);
  }
  assert.equal(count(b), 3 * 9 + 1);
});

test('garbage that pushes blocks off the top reports it', () => {
  const b = new Board();
  b.cells[0 * COLS + 3] = 2; // row 0 is occupied
  assert.equal(b.addGarbage(1, 0), true);
  const c = new Board();
  c.cells[1 * COLS + 3] = 2;
  assert.equal(c.addGarbage(1, 0), false, 'row 1 moves to row 0: still on the board');
  assert.equal(c.addGarbage(1, 0), true, 'and the next one pushes it off');
  assert.equal(new Board().addGarbage(0, 3), false);
  const d = new Board();
  d.addGarbage(99, 3); // clamps
  assert.equal(d.get(3, 0), 0);
  assert.equal(d.get(0, 0), GARBAGE);
});

test('heights', () => {
  const b = new Board();
  assert.equal(b.maxHeight(), 0);
  b.cells[15 * COLS + 2] = 1;
  assert.equal(b.height(2), 7);
  assert.equal(b.height(3), 0);
  assert.equal(b.maxHeight(), 7);
});

test('snapshot encoding round-trips every cell value and rejects bad input', () => {
  const cells = new Uint8Array(COLS * ROWS);
  for (let i = 0; i < cells.length; i++) cells[i] = i % 9;
  const s = encodeCells(cells);
  assert.equal(s.length, ENCODED_LENGTH);
  assert.equal(ENCODED_LENGTH, 147);
  assert.match(s, /^[A-Za-z0-9+/]+$/);
  assert.deepEqual([...decodeCells(s)], [...cells]);
  const empty = encodeCells(new Uint8Array(COLS * ROWS));
  assert.deepEqual([...decodeCells(empty)], new Array(COLS * ROWS).fill(0));
  assert.equal(decodeCells(s.slice(1)), null, 'wrong length');
  assert.equal(decodeCells(`${s.slice(0, -1)}!`), null, 'bad character');
  assert.equal(decodeCells(null), null);
  assert.equal(decodeCells(12), null);
  const big = new Uint8Array(COLS * ROWS).fill(15);
  assert.equal(decodeCells(encodeCells(big)), null, 'cell values above 8 are refused');
});

test('parseSnap checks every field and clamps what it keeps', () => {
  const c = encodeCells(new Uint8Array(COLS * ROWS));
  const good = parseSnap({ c, p: [3, 1, 4, 10], h: 5, ko: 1, g: 6, k: 2, sn: 44, n: 80, tg: 3, m: 'abc' });
  assert.deepEqual({ p: good.p, h: good.h, ko: good.ko, g: good.g, k: good.k, sn: good.sn, n: good.n, tg: good.tg, m: good.m }, { p: [3, 1, 4, 10], h: 5, ko: 1, g: 6, k: 2, sn: 44, n: 80, tg: 3, m: 'abc' });
  assert.equal(good.cells.length, COLS * ROWS);
  assert.equal(parseSnap({ c: 'nope' }), null);
  assert.equal(parseSnap(null), null);
  assert.equal(parseSnap('x'), null);
  const wild = parseSnap({ c, p: [99, 99, 99, 99], h: -3, g: 1e9, k: NaN, sn: 'x', n: Infinity, tg: 99, m: 5 });
  assert.equal(wild.p[0], 7);
  assert.equal(wild.p[1], 3);
  assert.ok(wild.p[2] <= 14 && wild.p[3] <= 26);
  assert.equal(wild.h, 0);
  assert.equal(wild.g, 99);
  assert.equal(wild.k, 0);
  assert.equal(wild.sn, 0);
  assert.equal(wild.n, 0);
  assert.equal(wild.tg, 11);
  assert.equal(wild.m, '');
  assert.equal(parseSnap({ c, p: [0, 0, 0, 0] }).p, null, 'piece type 0 is no piece');
  assert.equal(parseSnap({ c, p: 0 }).p, null);
});
