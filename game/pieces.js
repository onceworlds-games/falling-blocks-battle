// The seven pieces: shapes in all four rotation states and the Super Rotation System wall kicks. Pure data.
//
// Coordinates are board cells with y pointing down. A piece is { type, rot, x, y }: (x, y) is the top-left of its bounding box
// (3x3 for J L S T Z, 4x4 for I and O) and rot is 0 (spawn), 1 (rotated right), 2, 3 (rotated left).

export const COLS = 10;
export const ROWS = 22; // 20 visible rows under 2 hidden ones
export const HIDDEN = 2;
export const VISIBLE = ROWS - HIDDEN;

export const I = 1;
export const O = 2;
export const T = 3;
export const S = 4;
export const Z = 5;
export const J = 6;
export const L = 7;
export const GARBAGE = 8;
export const NAMES = ['', 'I', 'O', 'T', 'S', 'Z', 'J', 'L', 'G'];

export const SPAWN_X = 3;
export const SPAWN_Y = 0;

// Spawn states, cells as [x, y] in the bounding box.
const BASE = [
  null,
  { n: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] }, // I
  { n: 4, cells: [[1, 0], [2, 0], [1, 1], [2, 1]] }, // O
  { n: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] }, // T
  { n: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] }, // S
  { n: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] }, // Z
  { n: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] }, // J
  { n: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] }, // L
];

/** The box size of a piece (3 or 4). */
export const BOX = BASE.map((b) => (b ? b.n : 0));

// A quarter turn clockwise inside an n x n box.
const turn = (cells, n) => cells.map(([x, y]) => [n - 1 - y, x]);

/** SHAPES[type][rot]: four [x, y] pairs. */
export const SHAPES = BASE.map((b, type) => {
  if (!b) return null;
  const states = [b.cells];
  // The O piece looks the same in every state (and stays put: its kicks are all (0, 0)).
  for (let r = 1; r < 4; r++) states.push(type === O ? b.cells : turn(states[r - 1], b.n));
  return states;
});

/** CELLS[type][rot]: the same as a flat Int8Array [x0, y0, x1, y1, ...] for fast loops. */
export const CELLS = SHAPES.map((states) => (states ? states.map((cells) => Int8Array.from(cells.flat())) : null));

// Wall kick tests of the Super Rotation System, as the guideline publishes them: y points UP there. `from>to` are rotation
// states (0 spawn, 1 right, 2, 3 left). Test 1 is always (0, 0).
const KICKS_JLSTZ_UP = {
  '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
};
const KICKS_I_UP = {
  '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
};

// The same tables with y pointing down (what the board uses): KICKS[type][from][to] = [[dx, dy] x 5].
const flip = (table) => {
  const out = [[], [], [], []];
  for (const [key, tests] of Object.entries(table)) {
    const [from, to] = key.split('>').map(Number);
    out[from][to] = tests.map(([dx, dy]) => [dx, dy === 0 ? 0 : -dy]);
  }
  return out;
};
const JLSTZ = flip(KICKS_JLSTZ_UP);
const IKICKS = flip(KICKS_I_UP);
const NONE = [[0, 0]];

/** The five kick tests (y down) for turning a piece from rotation `from` to `to`. O never needs any. */
export function kicks(type, from, to) {
  if (type === O) return NONE;
  return (type === I ? IKICKS : JLSTZ)[from][to];
}

/** The published tables (y up) for tests that check them against an independent copy. */
export const PUBLISHED_KICKS = { jlstz: KICKS_JLSTZ_UP, i: KICKS_I_UP };

/**
 * Try to turn `piece` ({ type, rot, x, y }) by `dir` (+1 right, -1 left) on `board`, trying the five kicks in order.
 * Returns { rot, x, y, kick } (kick: which test succeeded, 0-4) or null.
 */
export function tryRotate(board, piece, dir) {
  if (piece.type === O) return null;
  const to = (piece.rot + dir + 4) & 3;
  const tests = kicks(piece.type, piece.rot, to);
  for (let i = 0; i < tests.length; i++) {
    const nx = piece.x + tests[i][0];
    const ny = piece.y + tests[i][1];
    if (!board.collides(piece.type, to, nx, ny)) return { rot: to, x: nx, y: ny, kick: i };
  }
  return null;
}
