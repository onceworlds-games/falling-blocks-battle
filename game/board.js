// The playfield: 10 columns x 22 rows (the top two are hidden). Cells hold 0 (empty), 1-7 (a locked piece's type) or 8 (garbage).
// Pure: no DOM, no randomness.

import { CELLS, COLS, GARBAGE, ROWS } from './pieces.js';

export class Board {
  constructor(cells) {
    this.cells = cells instanceof Uint8Array && cells.length === COLS * ROWS ? cells : new Uint8Array(COLS * ROWS);
  }

  clone() {
    return new Board(this.cells.slice());
  }

  clear() {
    this.cells.fill(0);
  }

  /** The cell at (x, y); the walls, the floor and the ceiling read as 9 (solid). */
  get(x, y) {
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return 9;
    return this.cells[y * COLS + x];
  }

  /** Whether (x, y) is blocked: out of bounds (any side) or filled. */
  solid(x, y) {
    return x < 0 || x >= COLS || y < 0 || y >= ROWS || this.cells[y * COLS + x] !== 0;
  }

  /** Whether the piece would overlap the stack or leave the board. */
  collides(type, rot, x, y) {
    const s = CELLS[type][rot];
    const cells = this.cells;
    for (let i = 0; i < 8; i += 2) {
      const cx = x + s[i];
      const cy = y + s[i + 1];
      if (cx < 0 || cx >= COLS || cy < 0 || cy >= ROWS) return true;
      if (cells[cy * COLS + cx] !== 0) return true;
    }
    return false;
  }

  /** Writes the piece's cells into the stack (as `value`, its type by default). */
  place(type, rot, x, y, value = type) {
    const s = CELLS[type][rot];
    for (let i = 0; i < 8; i += 2) {
      const cx = x + s[i];
      const cy = y + s[i + 1];
      if (cx >= 0 && cx < COLS && cy >= 0 && cy < ROWS) this.cells[cy * COLS + cx] = value;
    }
  }

  /** Removes every full row and lets what is above fall. Returns the cleared rows' (old) indices, top first. */
  clearLines() {
    const cells = this.cells;
    const cleared = [];
    for (let y = 0; y < ROWS; y++) {
      let full = true;
      for (let x = 0; x < COLS; x++) {
        if (cells[y * COLS + x] === 0) {
          full = false;
          break;
        }
      }
      if (full) cleared.push(y);
    }
    if (cleared.length === 0) return cleared;
    let dst = ROWS - 1;
    for (let src = ROWS - 1; src >= 0; src--) {
      if (cleared.includes(src)) continue;
      if (dst !== src) cells.copyWithin(dst * COLS, src * COLS, src * COLS + COLS);
      dst--;
    }
    cells.fill(0, 0, (dst + 1) * COLS);
    return cleared;
  }

  isEmpty() {
    const cells = this.cells;
    for (let i = 0; i < cells.length; i++) if (cells[i] !== 0) return false;
    return true;
  }

  /**
   * Garbage rises: `n` rows of grey blocks with one hole at column `col` come in from below and push the stack up.
   * Returns true when that pushes blocks off the top of the board (the player is out).
   */
  addGarbage(n, col) {
    const rows = Math.min(ROWS, Math.max(0, Math.floor(n)));
    if (rows === 0) return false;
    const hole = Math.min(COLS - 1, Math.max(0, Math.floor(col)));
    const cells = this.cells;
    let over = false;
    for (let i = 0; i < rows * COLS; i++) {
      if (cells[i] !== 0) {
        over = true;
        break;
      }
    }
    cells.copyWithin(0, rows * COLS);
    for (let r = ROWS - rows; r < ROWS; r++) {
      for (let x = 0; x < COLS; x++) cells[r * COLS + x] = x === hole ? 0 : GARBAGE;
    }
    return over;
  }

  /** The height of column x: rows from the floor to its highest block (0 for an empty column). */
  height(x) {
    for (let y = 0; y < ROWS; y++) if (this.cells[y * COLS + x] !== 0) return ROWS - y;
    return 0;
  }

  /** The highest stack in rows. */
  maxHeight() {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) if (this.cells[y * COLS + x] !== 0) return ROWS - y;
    }
    return 0;
  }
}
