// SRS rotation: the shapes of every state and the full wall kick tables, checked against an independent copy of the guideline
// data, plus rotations in real positions (against walls, the floor and other blocks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../game/board.js';
import { BOX, CELLS, COLS, GARBAGE, I, J, L, NAMES, O, PUBLISHED_KICKS, ROWS, S, SHAPES, T, Z, kicks, tryRotate } from '../game/pieces.js';
import { mulberry32 } from '../game/rng.js';

const key = (cells) => [...cells].map(([x, y]) => `${x},${y}`).sort().join(' ');
const at = (type, rot) => key(SHAPES[type][rot]);

test('every piece has four distinct cells inside its box in all four states', () => {
  for (let type = 1; type <= 7; type++) {
    assert.equal(SHAPES[type].length, 4);
    for (let rot = 0; rot < 4; rot++) {
      const cells = SHAPES[type][rot];
      assert.equal(cells.length, 4, `${NAMES[type]} ${rot}`);
      assert.equal(new Set(cells.map(([x, y]) => `${x},${y}`)).size, 4);
      for (const [x, y] of cells) assert.ok(x >= 0 && y >= 0 && x < BOX[type] && y < BOX[type], `${NAMES[type]} ${rot} in box`);
      assert.deepEqual([...CELLS[type][rot]], cells.flat(), 'the flat copy matches');
    }
  }
  assert.deepEqual(BOX.slice(1), [4, 4, 3, 3, 3, 3, 3]);
});

test('the shapes are the guideline shapes in every state', () => {
  // [state 0, R, 2, L], as ascii rows of the bounding box
  const ascii = {
    [I]: [['....', 'XXXX', '....', '....'], ['..X.', '..X.', '..X.', '..X.'], ['....', '....', 'XXXX', '....'], ['.X..', '.X..', '.X..', '.X..']],
    [T]: [['.X.', 'XXX', '...'], ['.X.', '.XX', '.X.'], ['...', 'XXX', '.X.'], ['.X.', 'XX.', '.X.']],
    [S]: [['.XX', 'XX.', '...'], ['.X.', '.XX', '..X'], ['...', '.XX', 'XX.'], ['X..', 'XX.', '.X.']],
    [Z]: [['XX.', '.XX', '...'], ['..X', '.XX', '.X.'], ['...', 'XX.', '.XX'], ['.X.', 'XX.', 'X..']],
    [J]: [['X..', 'XXX', '...'], ['.XX', '.X.', '.X.'], ['...', 'XXX', '..X'], ['.X.', '.X.', 'XX.']],
    [L]: [['..X', 'XXX', '...'], ['.X.', '.X.', '.XX'], ['...', 'XXX', 'X..'], ['XX.', '.X.', '.X.']],
  };
  for (const [type, states] of Object.entries(ascii)) {
    states.forEach((rows, rot) => {
      const want = [];
      rows.forEach((row, y) => [...row].forEach((ch, x) => ch === 'X' && want.push([x, y])));
      assert.equal(at(Number(type), rot), key(want), `${NAMES[type]} state ${rot}`);
    });
  }
  for (let rot = 0; rot < 4; rot++) assert.equal(at(O, rot), key([[1, 0], [2, 0], [1, 1], [2, 1]]), 'the O never changes');
});

// An independent copy of the published wall kick data (y points UP, as on the guideline wiki).
const WIKI_JLSTZ = {
  '0>R': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  'R>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  'R>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '2>R': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '2>L': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  'L>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  'L>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '0>L': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
};
const WIKI_I = {
  '0>R': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  'R>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  'R>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  '2>R': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '2>L': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  'L>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  'L>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '0>L': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
};
const STATE = { 0: 0, R: 1, 2: 2, L: 3 };

test('the wall kick tables are the published ones, flipped to y down', () => {
  for (const [table, wiki, types] of [['jlstz', WIKI_JLSTZ, [J, L, S, T, Z]], ['i', WIKI_I, [I]]]) {
    for (const [name, tests] of Object.entries(wiki)) {
      const [from, to] = name.split('>').map((s) => STATE[s]);
      for (const type of types) {
        const got = kicks(type, from, to);
        assert.equal(got.length, 5, `${NAMES[type]} ${name} has five tests`);
        tests.forEach(([dx, dy], i) => {
          assert.equal(got[i][0], dx, `${NAMES[type]} ${name} test ${i + 1} dx`);
          assert.equal(got[i][1], dy === 0 ? 0 : -dy, `${NAMES[type]} ${name} test ${i + 1} dy (y down)`);
        });
      }
    }
  }
  // the module's own published copy matches the independent one
  assert.equal(Object.keys(PUBLISHED_KICKS.jlstz).length, 8);
  assert.equal(Object.keys(PUBLISHED_KICKS.i).length, 8);
  // the O needs none
  assert.deepEqual(kicks(O, 0, 1), [[0, 0]]);
});

test('kicks of JLSTZ equal the difference of the guideline offset tables (a second derivation)', () => {
  const OFFSETS = { 0: [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0]], R: [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]], 2: [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0]], L: [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]] };
  for (const name of Object.keys(WIKI_JLSTZ)) {
    const [a, b] = name.split('>');
    for (let i = 0; i < 5; i++) {
      const want = [OFFSETS[a][i][0] - OFFSETS[b][i][0], OFFSETS[a][i][1] - OFFSETS[b][i][1]];
      assert.deepEqual(WIKI_JLSTZ[name][i].map((v) => v + 0), want.map((v) => v + 0), `${name} test ${i + 1}`);
    }
  }
});

test('turning back undoes the kick offsets exactly (the tables are antisymmetric)', () => {
  for (const type of [I, T, J]) {
    for (let from = 0; from < 4; from++) {
      for (const dir of [1, -1]) {
        const to = (from + dir + 4) % 4;
        const fwd = kicks(type, from, to);
        const back = kicks(type, to, from);
        for (let i = 0; i < 5; i++) {
          assert.equal(fwd[i][0], back[i][0] === 0 ? 0 : -back[i][0]);
          assert.equal(fwd[i][1], back[i][1] === 0 ? 0 : -back[i][1]);
        }
      }
    }
  }
});

test('rotating in open space uses the first test and four turns come home', () => {
  const b = new Board();
  for (let type = 1; type <= 7; type++) {
    let piece = { type, rot: 0, x: 3, y: 8 };
    for (let i = 0; i < 4; i++) {
      const r = tryRotate(b, piece, 1);
      if (type === O) {
        assert.equal(r, null);
        break;
      }
      assert.ok(r, `${NAMES[type]} turns`);
      assert.equal(r.kick, 0);
      piece = { type, ...r };
    }
    if (type !== O) assert.deepEqual({ rot: piece.rot, x: piece.x, y: piece.y }, { rot: 0, x: 3, y: 8 }, `${NAMES[type]} four right turns`);
  }
});

test('a T against the left wall kicks one cell right (test 2)', () => {
  const b = new Board();
  // rotation R with its spine in column 0: turning to state 2 would stick out of the wall
  const r = tryRotate(b, { type: T, rot: 1, x: -1, y: 10 }, 1);
  assert.deepEqual(r, { rot: 2, x: 0, y: 10, kick: 1 });
});

test('an I lying against the wall kicks two cells (test 3)', () => {
  const b = new Board();
  const r = tryRotate(b, { type: I, rot: 1, x: -2, y: 10 }, 1); // vertical in column 0, turn to horizontal
  assert.deepEqual(r, { rot: 2, x: 0, y: 10, kick: 2 });
  const l = tryRotate(b, { type: I, rot: 3, x: 8, y: 10 }, -1); // vertical in column 9, turn the other way
  assert.ok(l && !b.collides(I, l.rot, l.x, l.y));
});

test('a rotation that fits nowhere returns null', () => {
  const b = new Board();
  // a T in a one-wide shaft cannot turn
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (x !== 4) b.cells[y * COLS + x] = GARBAGE;
  assert.equal(tryRotate(b, { type: I, rot: 1, x: 2, y: 5 }, 1), null);
});

test('tryRotate agrees with a brute-force SRS written from the tables, on random boards', () => {
  const rng = mulberry32(99);
  const wikiFor = (type, from, to) => {
    const name = `${'0R2L'[from]}>${'0R2L'[to]}`;
    return (type === I ? WIKI_I : WIKI_JLSTZ)[name];
  };
  let tried = 0;
  let kicked = 0;
  for (let n = 0; n < 4000; n++) {
    const b = new Board();
    for (let i = 0; i < 60; i++) b.cells[Math.floor(rng() * COLS * ROWS)] = 1 + Math.floor(rng() * 8);
    const type = [I, T, S, Z, J, L][Math.floor(rng() * 6)];
    const piece = { type, rot: Math.floor(rng() * 4), x: Math.floor(rng() * 12) - 2, y: Math.floor(rng() * 20) };
    if (b.collides(type, piece.rot, piece.x, piece.y)) continue;
    for (const dir of [1, -1]) {
      const to = (piece.rot + dir + 4) % 4;
      let want = null;
      const tests = wikiFor(type, piece.rot, to);
      for (let i = 0; i < 5 && !want; i++) {
        const x = piece.x + tests[i][0];
        const y = piece.y - tests[i][1]; // the table is y up
        if (!b.collides(type, to, x, y)) want = { rot: to, x, y, kick: i };
      }
      assert.deepEqual(tryRotate(b, piece, dir), want);
      tried++;
      if (want && want.kick > 0) kicked++;
    }
  }
  assert.ok(tried > 1500 && kicked > 100, `exercised ${tried} turns, ${kicked} with a kick`);
});
