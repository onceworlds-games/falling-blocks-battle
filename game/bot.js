// The bots: a classic placement AI. For the falling piece (and the hold) it finds every spot the piece can reach, including tucks
// and T-spin turns (a breadth-first search over moves, not just rotation x column), scores the board each would leave with a
// weighted sum (heights, holes, bumpiness, lines, a well for quads, T-spins for strong bots), and plays the best with a human's
// pace: a think, then one key at a time. Weak bots add noise to their scores and sometimes take a worse spot.
// Pure: no DOM; everything random comes from the rng it is given.

import { CELLS, COLS, ROWS, SPAWN_X, SPAWN_Y, T, tryRotate } from './pieces.js';
import { clamp } from './rng.js';
import { ppsFor } from './rules.js';

// ---------------------------------------------------------------- search over the moves one piece can make
// A state is (x, y, rot, flag): flag 1 means the last move was a turn (it only matters for the T, for T-spins).
const XOFF = 4;
const XN = 18; // x from -4 to 13
const YN = 22;
const STATES = 2 * 4 * YN * XN;
export const CMD = { left: 1, right: 2, down: 3, sonic: 4, cw: 5, ccw: 6 };

const visited = new Uint32Array(STATES);
const parent = new Int32Array(STATES);
const how = new Int8Array(STATES);
const kickOf = new Int8Array(STATES);
const queue = new Int32Array(STATES);
let epoch = 0;
let found = 0; // how many states the last search visited (queue[0..found-1])

export const stateIndex = (x, y, rot, flag) => ((flag * 4 + rot) * YN + y) * XN + (x + XOFF);

function decode(idx) {
  const xi = idx % XN;
  const rest = (idx - xi) / XN;
  const y = rest % YN;
  const fr = (rest - y) / YN;
  return { x: xi - XOFF, y, rot: fr % 4, flag: fr >> 2 };
}

function visit(idx, from, cmd, kick) {
  if (visited[idx] === epoch) return;
  visited[idx] = epoch;
  parent[idx] = from;
  how[idx] = cmd;
  kickOf[idx] = kick;
  queue[found++] = idx;
}

/** Breadth-first search of everything the piece can do from (x, y, rot). Fills the module's scratch; returns the start's index. */
export function search(board, type, x, y, rot, flag = 0) {
  epoch++;
  found = 0;
  const start = stateIndex(x, y, rot, type === T ? flag : 0);
  visited[start] = epoch;
  parent[start] = -1;
  how[start] = 0;
  kickOf[start] = 0;
  queue[found++] = start;
  const piece = { type, rot: 0, x: 0, y: 0 };
  for (let head = 0; head < found; head++) {
    const idx = queue[head];
    const s = decode(idx);
    if (!board.collides(type, s.rot, s.x - 1, s.y)) visit(stateIndex(s.x - 1, s.y, s.rot, 0), idx, CMD.left, 0);
    if (!board.collides(type, s.rot, s.x + 1, s.y)) visit(stateIndex(s.x + 1, s.y, s.rot, 0), idx, CMD.right, 0);
    if (!board.collides(type, s.rot, s.x, s.y + 1)) {
      visit(stateIndex(s.x, s.y + 1, s.rot, 0), idx, CMD.down, 0);
      let ny = s.y + 1;
      while (ny + 1 < ROWS && !board.collides(type, s.rot, s.x, ny + 1)) ny++;
      if (ny > s.y + 1) visit(stateIndex(s.x, ny, s.rot, 0), idx, CMD.sonic, 0);
    }
    if (type !== 2) {
      piece.rot = s.rot;
      piece.x = s.x;
      piece.y = s.y;
      const f = type === T ? 1 : 0;
      const cw = tryRotate(board, piece, 1);
      if (cw && cw.y >= 0 && cw.y < YN) visit(stateIndex(cw.x, cw.y, cw.rot, f), idx, CMD.cw, cw.kick);
      const ccw = tryRotate(board, piece, -1);
      if (ccw && ccw.y >= 0 && ccw.y < YN) visit(stateIndex(ccw.x, ccw.y, ccw.rot, f), idx, CMD.ccw, ccw.kick);
    }
  }
  return start;
}

/** After a search: the first command on the shortest way from the start to `target`, 0 if the target is the start, -1 if unreachable. */
export function firstCommand(start, target) {
  if (visited[target] !== epoch) return -1;
  if (target === start) return 0;
  let at = target;
  while (parent[at] !== start) {
    at = parent[at];
    if (at < 0) return -1;
  }
  return how[at];
}

/** After a search: the whole command list from the start to `target` (empty if unreachable or already there). */
export function pathTo(start, target) {
  const out = [];
  if (visited[target] !== epoch) return out;
  let at = target;
  while (at !== start && at >= 0) {
    out.push(how[at]);
    at = parent[at];
  }
  return out.reverse();
}

// ---------------------------------------------------------------- scoring a placement
const GRID = new Uint8Array(COLS * ROWS);
const HEIGHTS = new Int8Array(COLS);

const solidAt = (cells, x, y) => x < 0 || x >= COLS || y < 0 || y >= ROWS || cells[y * COLS + x] !== 0;

/** 0/1/2 for a T that has just turned into (x, y, rot): the same three-corner rule the engine uses. */
function tspinAt(cells, x, y, rot, kick) {
  const tl = solidAt(cells, x, y);
  const tr = solidAt(cells, x + 2, y);
  const bl = solidAt(cells, x, y + 2);
  const br = solidAt(cells, x + 2, y + 2);
  if ((tl ? 1 : 0) + (tr ? 1 : 0) + (bl ? 1 : 0) + (br ? 1 : 0) < 3) return 0;
  const front = rot === 0 ? tl && tr : rot === 1 ? tr && br : rot === 2 ? bl && br : tl && bl;
  return front || kick === 4 ? 2 : 1;
}

/** How a bot values things, from its skill 0..1. */
export function weightsFor(skill) {
  const s = clamp(skill, 0, 1);
  return {
    height: 0.36,
    holes: 1.0 + 0.5 * s,
    cover: 0.12,
    bump: 0.16 + 0.1 * s,
    strong: clamp((s - 0.4) / 0.5, 0, 1), // quad and T-spin hunting
    noise: (1 - s) * 0.9,
  };
}

/**
 * Score of placing `type` at (x, y, rot) on `cells` (flag/kick: it arrived by a turn). Higher is better. Also reports what it
 * clears: out.lines, out.tspin.
 */
export function scorePlacement(cells, type, rot, x, y, flag, kick, w, pending, out) {
  GRID.set(cells);
  let tspin = 0;
  if (type === T && flag) tspin = tspinAt(cells, x, y, rot, kick);
  const s = CELLS[type][rot];
  for (let i = 0; i < 8; i += 2) {
    const cx = x + s[i];
    const cy = y + s[i + 1];
    if (cx >= 0 && cx < COLS && cy >= 0 && cy < ROWS) GRID[cy * COLS + cx] = type;
  }
  // clear full rows (compacting in place, bottom up)
  let lines = 0;
  let dst = ROWS - 1;
  for (let src = ROWS - 1; src >= 0; src--) {
    let full = true;
    for (let cx = 0; cx < COLS; cx++) {
      if (GRID[src * COLS + cx] === 0) {
        full = false;
        break;
      }
    }
    if (full) {
      lines++;
      continue;
    }
    if (dst !== src) GRID.copyWithin(dst * COLS, src * COLS, src * COLS + COLS);
    dst--;
  }
  if (lines > 0) GRID.fill(0, 0, (dst + 1) * COLS);
  if (tspin === 1 && lines >= 2) tspin = 2;
  out.lines = lines;
  out.tspin = lines > 0 ? tspin : 0;

  // heights, holes and what covers them
  let agg = 0;
  let holes = 0;
  let cover = 0;
  let maxH = 0;
  for (let cx = 0; cx < COLS; cx++) {
    let h = 0;
    let blocks = 0;
    for (let cy = 0; cy < ROWS; cy++) {
      const v = GRID[cy * COLS + cx];
      if (v !== 0) {
        if (h === 0) h = ROWS - cy;
        blocks++;
      } else if (h > 0) {
        holes++;
        cover += blocks;
      }
    }
    HEIGHTS[cx] = h;
    agg += h;
    if (h > maxH) maxH = h;
  }
  let bump = 0;
  const last = w.strong > 0.5 ? COLS - 2 : COLS - 1; // strong bots keep the right-hand column as a well and ignore it
  for (let cx = 0; cx < last; cx++) bump += Math.abs(HEIGHTS[cx] - HEIGHTS[cx + 1]);

  const urgency = clamp((maxH - 7) / 5, 0, 1);
  const waiting = clamp(pending / 4, 0, 1);
  const build = w.strong * (1 - urgency) * (1 - waiting);
  let score = -w.height * agg - w.holes * holes - w.cover * cover * 0.1 - w.bump * bump;
  score += 0.76 * lines;
  if (lines > 0 && lines < 4) score -= build * 6.6 * lines;
  if (lines === 4) score += build * 10;
  if (tspin === 2 && lines > 0) score += w.strong * [0, 2.5, 8, 12][Math.min(lines, 3)];
  else if (tspin === 1 && lines > 0) score += w.strong * 0.6;
  if (build > 0) {
    let wellFill = 0;
    for (let cy = 0; cy < ROWS; cy++) if (GRID[cy * COLS + COLS - 1] !== 0) wellFill++;
    score -= build * 1.4 * wellFill;
  }
  if (maxH > 14) score -= (maxH - 14) * 2.5;
  if (agg === 0 && lines > 0) score += 20;
  return score;
}

// ---------------------------------------------------------------- choosing
/**
 * Everything one piece could do from (x, y, rot): [{ x, y, rot, flag, kick, score, lines, tspin, idx }], best first. Runs a search
 * (so the module's scratch describes this piece afterwards).
 */
export function candidates(board, type, x, y, rot, flag, w, pending, rng) {
  const start = search(board, type, x, y, rot, flag);
  const list = [];
  const info = { lines: 0, tspin: 0 };
  for (let i = 0; i < found; i++) {
    const idx = queue[i];
    const s = decode(idx);
    if (!board.collides(type, s.rot, s.x, s.y + 1)) continue; // only spots where it comes to rest
    const score = scorePlacement(board.cells, type, s.rot, s.x, s.y, s.flag, kickOf[idx], w, pending, info);
    list.push({ x: s.x, y: s.y, rot: s.rot, flag: s.flag, kick: kickOf[idx], score: score + (rng ? (rng() - 0.5) * 2 * w.noise : 0), lines: info.lines, tspin: info.tspin, idx });
  }
  list.sort((a, b) => b.score - a.score);
  return { start, list };
}

/** The best spot for a piece right now (no noise): { x, y, rot, ... } or null. For tests and for deciding on a hold. */
export function bestPlacement(board, type, x, y, rot, flag, skill, pending = 0) {
  const w = weightsFor(skill);
  w.noise = 0;
  const { list } = candidates(board, type, x, y, rot, flag, w, pending, null);
  return list[0] ?? null;
}

// ---------------------------------------------------------------- the player behind the keys
export class Brain {
  /** engine: the Engine it plays. opts: { skill 0..1, rng }. */
  constructor(engine, opts = {}) {
    this.engine = engine;
    this.skill = clamp(opts.skill ?? 0.5, 0, 1);
    this.rng = opts.rng ?? Math.random;
    this.w = weightsFor(this.skill);
    this.pps = ppsFor(this.skill);
    this.seen = -1; // the engine's serial of the piece being planned
    this.plan = null; // { x, y, rot, flag, idx, hold }
    this.wait = 0; // ms until the next key
    this.gap = 80; // ms between keys
    this.miss = 0.08 * (1 - this.skill) + 0.01; // chance to take a worse spot on purpose
    this.holdUse = 0.25 + 0.75 * this.skill;
    this.keys = 0; // keys pressed (for tests)
    this.slow = 1; // 1 is full pace; the match slows the bots down early on
  }

  /** Decide where the new piece goes (or to hold it first). */
  newPiece() {
    const e = this.engine;
    const c = e.cur;
    this.seen = e.serial;
    this.plan = null;
    const T0 = 1000 / this.pps;
    this.wait = T0 * this.slow * 0.3 * (0.6 + this.rng() * 0.8);
    const pending = e.pendingTotal();
    const here = candidates(e.board, c.type, c.x, c.y, c.rot, e.lastRot ? 1 : 0, this.w, pending, this.rng);
    let best = here.list[0] ?? null;
    let pick = best;
    if (best && here.list.length > 1 && this.rng() < this.miss) pick = here.list[1 + Math.floor(this.rng() * Math.min(4, here.list.length - 1))];
    if (e.canHold && this.rng() < this.holdUse) {
      const ht = e.hold || e.next(0);
      if (ht !== c.type && !e.board.collides(ht, 0, SPAWN_X, SPAWN_Y)) {
        const sy = e.board.collides(ht, 0, SPAWN_X, SPAWN_Y + 1) ? SPAWN_Y : SPAWN_Y + 1;
        const alt = candidates(e.board, ht, SPAWN_X, sy, 0, 0, this.w, pending, this.rng);
        if (alt.list.length > 0 && (!best || alt.list[0].score > best.score + 0.25)) {
          this.plan = { hold: true };
          this.gap = clamp(T0 * this.slow * 0.4, 25, 200);
          return;
        }
      }
    }
    if (!pick) {
      this.plan = null;
      return;
    }
    // Re-run the search from the piece's own state so the module's scratch matches it (hold candidates overwrote it).
    const start = search(e.board, c.type, c.x, c.y, c.rot, e.lastRot ? 1 : 0);
    const target = stateIndex(pick.x, pick.y, pick.rot, c.type === T ? pick.flag : 0);
    const len = pathTo(start, target).length;
    this.plan = { x: pick.x, y: pick.y, rot: pick.rot, flag: pick.flag, idx: target, hold: false };
    this.gap = clamp((T0 * this.slow * 0.6) / (len + 1), 22, 220);
  }

  /** Press the next key of the plan. onLock(result) is called when the piece locks. */
  act(onLock) {
    const e = this.engine;
    const p = this.plan;
    const c = e.cur;
    if (!p || !c) return;
    this.keys++;
    if (p.hold) {
      this.plan = null;
      e.holdSwap();
      this.wait = this.gap;
      return;
    }
    const start = search(e.board, c.type, c.x, c.y, c.rot, e.lastRot ? 1 : 0);
    const cmd = firstCommand(start, p.idx);
    if (cmd === 0) {
      this.plan = null;
      const res = e.hardDrop();
      if (res) onLock(res);
      return;
    }
    if (cmd < 0) {
      // The way is gone (gravity took the piece past it): pick again from where it is, or just drop it.
      const again = candidates(e.board, c.type, c.x, c.y, c.rot, e.lastRot ? 1 : 0, this.w, e.pendingTotal(), this.rng);
      if (again.list.length === 0) {
        this.plan = null;
        const res = e.hardDrop();
        if (res) onLock(res);
        return;
      }
      const best = again.list[0];
      this.plan = { x: best.x, y: best.y, rot: best.rot, flag: best.flag, idx: stateIndex(best.x, best.y, best.rot, c.type === T ? best.flag : 0), hold: false };
      this.wait = this.gap;
      return;
    }
    if (cmd === CMD.left) e.move(-1);
    else if (cmd === CMD.right) e.move(1);
    else if (cmd === CMD.down) e.softStep();
    else if (cmd === CMD.sonic) e.sonic();
    else if (cmd === CMD.cw) e.rotate(1);
    else e.rotate(-1);
    this.wait = this.gap * (0.8 + this.rng() * 0.5);
  }

  /** Advance the bot and its board by dt ms. */
  update(dt, onLock) {
    const e = this.engine;
    if (e.ko) return;
    if (e.serial !== this.seen) this.newPiece();
    if (this.plan) {
      this.wait -= dt;
      if (this.wait <= 0) this.act(onLock);
    }
    if (e.ko) return;
    const r = e.tick(dt, false);
    if (r) onLock(r);
  }
}
