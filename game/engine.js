// One player's board and everything that happens on it: the falling piece, gravity, lock delay, hold, clears, T-spins, combos,
// incoming garbage and topping out. Pure and deterministic given its seed: a person's page, the host's bots and the tests all run
// this same class. The caller drives it with move / rotate / softStep / hardDrop / holdSwap and tick(dt, soft), and learns what
// a lock did from the result object those return.

import { Bag } from './bag.js';
import { Board } from './board.js';
import { CELLS, HIDDEN, SPAWN_X, SPAWN_Y, T, tryRotate } from './pieces.js';
import { hashStr, mulberry32 } from './rng.js';
import { LOCK_MS, MAX_RESETS, SOFT_FACTOR, attackFor, isDifficult } from './rules.js';
import { encodeCells } from './snap.js';

export const RISE_CAP = 8; // rows of garbage that rise after one piece
export const PENDING_CAP = 40; // rows of garbage that can wait at once

export class Engine {
  /** opts: { seed, id, gravity (rows per second), start (spawn the first piece, default true) } */
  constructor(opts = {}) {
    this.id = String(opts.id ?? '');
    this.seed = (opts.seed ?? 1) >>> 0;
    this.board = new Board();
    this.bag = this.makeBag();
    this.gravity = Number.isFinite(opts.gravity) ? opts.gravity : 1;
    this.cur = null; // { type, rot, x, y }
    this.hold = 0;
    this.canHold = true;
    this.fall = 0; // rows of gravity not yet applied
    this.lockT = 0; // ms the piece has rested
    this.resets = 0; // lock delay restarts used
    this.lowest = 0; // the lowest row the piece has reached
    this.lastRot = false; // the piece's last move was a turn (for T-spins)
    this.lastKick = 0;
    this.air = false; // the piece was off the ground at the last tick
    this.combo = -1; // consecutive clears minus one (-1: none running)
    this.b2b = false;
    this.pending = []; // incoming garbage, oldest first: [{ n, col }]
    this.forced = []; // sudden-death rows: hole columns of lines that rise after the next lock whatever happens
    this.ko = false;
    this.koReason = '';
    this.serial = 0; // counts spawns: a new number means a new piece
    this.time = 0; // ms this board has been ticked
    this.stats = { pieces: 0, lines: 0, sent: 0, recv: 0, quads: 0, tspins: 0, maxCombo: 0, perfect: 0 };
    if (opts.start !== false) this.spawn(0);
  }

  makeBag() {
    return new Bag(mulberry32(hashStr(`${this.seed}:${this.id}:bag`)));
  }

  /** Pieces dealt from the bag so far. */
  get dealt() {
    return this.bag.taken;
  }

  pendingTotal() {
    let n = 0;
    for (let i = 0; i < this.pending.length; i++) n += this.pending[i].n;
    return n;
  }

  /** The next piece type, `i` ahead (0 is the next). */
  next(i = 0) {
    return this.bag.at(i);
  }

  // ---------------------------------------------------------------- spawning
  /** Puts a piece at the top (`type` 0: the next from the bag). False when it can't fit (the player is out). */
  spawn(type) {
    let t = type;
    if (!t) {
      t = this.bag.take();
      this.stats.pieces++;
    }
    this.cur = { type: t, rot: 0, x: SPAWN_X, y: SPAWN_Y };
    this.serial++;
    this.lastRot = false;
    this.lastKick = 0;
    this.lockT = 0;
    this.resets = 0;
    this.fall = 0;
    this.air = false;
    const c = this.cur;
    if (this.board.collides(t, 0, c.x, c.y)) {
      this.knockOut('block');
      return false;
    }
    if (!this.board.collides(t, 0, c.x, c.y + 1)) c.y++; // it enters the field one row down at once
    this.lowest = c.y;
    return true;
  }

  knockOut(reason) {
    this.ko = true;
    this.koReason = reason;
    this.cur = null;
  }

  // ---------------------------------------------------------------- moves
  grounded() {
    const c = this.cur;
    return c !== null && this.board.collides(c.type, c.rot, c.x, c.y + 1);
  }

  // A successful move or turn on the ground starts the lock delay over, at most MAX_RESETS times.
  touched() {
    if (this.grounded() && this.resets < MAX_RESETS) {
      this.resets++;
      this.lockT = 0;
    }
  }

  /** One step left (-1) or right (1). */
  move(dx) {
    const c = this.cur;
    if (!c || this.ko) return false;
    if (this.board.collides(c.type, c.rot, c.x + dx, c.y)) return false;
    c.x += dx;
    this.lastRot = false;
    this.touched();
    return true;
  }

  /** A quarter turn: +1 clockwise, -1 counter-clockwise, with the five wall-kick tests. */
  rotate(dir) {
    const c = this.cur;
    if (!c || this.ko) return false;
    const r = tryRotate(this.board, c, dir);
    if (!r) return false;
    c.rot = r.rot;
    c.x = r.x;
    c.y = r.y;
    this.lastRot = true;
    this.lastKick = r.kick;
    if (c.y > this.lowest) {
      this.lowest = c.y;
      this.resets = 0;
    }
    this.touched();
    return true;
  }

  /** One row down by hand. */
  softStep() {
    const c = this.cur;
    if (!c || this.ko) return false;
    if (this.board.collides(c.type, c.rot, c.x, c.y + 1)) return false;
    c.y++;
    this.fall = 0;
    this.lastRot = false;
    if (c.y > this.lowest) {
      this.lowest = c.y;
      this.resets = 0;
    }
    return true;
  }

  /** All the way down without locking (for bots that need to slide a piece under an overhang). */
  sonic() {
    let moved = false;
    while (this.softStep()) moved = true;
    return moved;
  }

  /** The row the piece would land on. */
  ghostY() {
    const c = this.cur;
    if (!c) return 0;
    let y = c.y;
    while (!this.board.collides(c.type, c.rot, c.x, y + 1)) y++;
    return y;
  }

  /** Drop to the bottom and lock at once. Returns the lock's result (see lock). */
  hardDrop() {
    const c = this.cur;
    if (!c || this.ko) return null;
    const y = this.ghostY();
    const dist = y - c.y;
    if (dist > 0) {
      c.y = y;
      this.lastRot = false;
    }
    const res = this.lock();
    res.drop = dist;
    return res;
  }

  /** Swap the falling piece with the hold (once per piece). */
  holdSwap() {
    const c = this.cur;
    if (!c || this.ko || !this.canHold) return false;
    const held = this.hold;
    this.hold = c.type;
    this.spawn(held); // 0 (an empty hold) deals the next piece
    this.canHold = false;
    return true;
  }

  // ---------------------------------------------------------------- time
  /** Advance gravity and the lock delay by `dt` ms. Returns the lock's result when the piece locked, else null. */
  tick(dt, soft = false) {
    const c = this.cur;
    if (!c || this.ko) return null;
    this.time += dt;
    this.fall += (this.gravity * (soft ? SOFT_FACTOR : 1) * dt) / 1000;
    while (this.fall >= 1) {
      this.fall -= 1;
      if (this.board.collides(c.type, c.rot, c.x, c.y + 1)) {
        this.fall = 0;
        break;
      }
      c.y++;
      this.lastRot = false;
      if (c.y > this.lowest) {
        this.lowest = c.y;
        this.resets = 0;
      }
    }
    if (this.board.collides(c.type, c.rot, c.x, c.y + 1)) {
      // Back on the ground after being lifted (a turn that kicked it up) with all the restarts used: it locks at once, so a piece
      // can't be kept in the air for ever by turning it.
      if (this.air && this.resets >= MAX_RESETS) this.lockT = LOCK_MS;
      this.air = false;
      this.lockT += dt;
      if (this.lockT >= LOCK_MS) return this.lock();
    } else {
      this.lockT = 0;
      this.air = true;
    }
    return null;
  }

  // ---------------------------------------------------------------- locking
  /** 0 no T-spin, 1 mini, 2 full: the three-corner rule, for a T whose last move was a turn. */
  detectTSpin() {
    const c = this.cur;
    if (!c || c.type !== T || !this.lastRot) return 0;
    const b = this.board;
    const { x, y } = c;
    const tl = b.solid(x, y);
    const tr = b.solid(x + 2, y);
    const bl = b.solid(x, y + 2);
    const br = b.solid(x + 2, y + 2);
    if ((tl ? 1 : 0) + (tr ? 1 : 0) + (bl ? 1 : 0) + (br ? 1 : 0) < 3) return 0;
    let front;
    if (c.rot === 0) front = tl && tr;
    else if (c.rot === 1) front = tr && br;
    else if (c.rot === 2) front = bl && br;
    else front = tl && bl;
    return front || this.lastKick === 4 ? 2 : 1;
  }

  /** Garbage that is waiting cancels against `lines` of attack, oldest first. Returns how many lines it cancelled. */
  cancel(lines) {
    let left = lines;
    while (left > 0 && this.pending.length > 0) {
      const e = this.pending[0];
      const n = Math.min(left, e.n);
      e.n -= n;
      left -= n;
      if (e.n <= 0) this.pending.shift();
    }
    return lines - left;
  }

  /** Incoming garbage: `n` rows with the hole at `col`. It waits until a piece locks without clearing. */
  receive(n, col) {
    const rows = Math.floor(n);
    if (!(rows >= 1) || this.ko) return 0;
    const room = PENDING_CAP - this.pendingTotal();
    const take = Math.min(rows, room, 24);
    if (take <= 0) return 0;
    this.pending.push({ n: take, col: Math.min(9, Math.max(0, Math.floor(Number.isFinite(col) ? col : 0))) });
    this.stats.recv += take;
    return take;
  }

  /** A sudden-death row: it can't be cancelled and rises (at most four at once) after the next lock, clear or not. */
  forceGarbage(col) {
    if (this.ko) return;
    this.forced.push(Math.min(9, Math.max(0, Math.floor(Number.isFinite(col) ? col : 0))));
  }

  /**
   * Locks the falling piece where it is. The result:
   * { type, rot, x, y, lines, rows (cleared row indices, top first), tspin (0/1/2), perfect, combo (-1 when no clear), b2b (this
   *   clear got the back-to-back bonus), diff (it was a quad or a T-spin clear), attack (lines it generates), cancelled (lines of
   *   waiting garbage it cancelled), send (lines to send on), rise: [{ n, col }] (garbage that came up), ko, koReason }
   */
  lock() {
    const c = this.cur;
    const b = this.board;
    const tspin = this.detectTSpin();
    b.place(c.type, c.rot, c.x, c.y);
    const s = CELLS[c.type][c.rot];
    let lockOut = true;
    for (let i = 1; i < 8; i += 2) if (c.y + s[i] >= HIDDEN) lockOut = false;
    const rows = b.clearLines();
    const lines = rows.length;
    const ts = lines >= 2 && tspin === 1 ? 2 : tspin;
    const res = {
      type: c.type,
      rot: c.rot,
      x: c.x,
      y: c.y,
      lines,
      rows,
      tspin: ts,
      perfect: false,
      combo: -1,
      b2b: false,
      diff: false,
      attack: 0,
      cancelled: 0,
      send: 0,
      rise: null,
      drop: 0,
      ko: false,
      koReason: '',
    };
    let reason = lockOut && lines === 0 ? 'lock' : '';
    if (lines > 0) {
      res.perfect = b.isEmpty();
      this.combo++;
      res.combo = this.combo;
      res.diff = isDifficult(lines, ts);
      res.b2b = res.diff && this.b2b;
      this.b2b = res.diff;
      const atk = attackFor({ lines, tspin: ts, b2b: res.b2b, combo: this.combo, perfect: res.perfect });
      res.attack = atk.total;
      res.cancelled = this.cancel(atk.total);
      res.send = atk.total - res.cancelled;
      const st = this.stats;
      st.lines += lines;
      st.sent += res.send;
      if (lines === 4) st.quads++;
      if (ts > 0) st.tspins++;
      if (this.combo > st.maxCombo) st.maxCombo = this.combo;
      if (res.perfect) st.perfect++;
    } else {
      this.combo = -1;
      if (!reason && this.pending.length > 0) {
        // Nothing cleared: the waiting garbage comes up (at most RISE_CAP rows at a time).
        res.rise = [];
        let room = RISE_CAP;
        while (room > 0 && this.pending.length > 0) {
          const e = this.pending[0];
          const n = Math.min(room, e.n);
          const col = e.col;
          e.n -= n;
          room -= n;
          if (e.n <= 0) this.pending.shift();
          res.rise.push({ n, col });
          if (b.addGarbage(n, col)) reason = 'garbage';
        }
      }
    }
    if (this.forced.length > 0 && !reason) {
      if (!res.rise) res.rise = [];
      for (const col of this.forced.splice(0, 4)) {
        res.rise.push({ n: 1, col });
        if (b.addGarbage(1, col)) reason = 'garbage';
      }
    }
    this.canHold = true;
    this.cur = null;
    if (reason) this.knockOut(reason);
    else this.spawn(0);
    res.ko = this.ko;
    res.koReason = this.koReason;
    return res;
  }

  // ---------------------------------------------------------------- snapshots
  /** What the others see of this board (see snap.js): cells, falling piece, hold, garbage waiting, pieces dealt, lines sent. */
  snapshot() {
    const c = this.cur;
    return {
      c: encodeCells(this.board.cells),
      p: c ? [c.type, c.rot, c.x, c.y] : 0,
      h: this.hold,
      ko: this.ko ? 1 : 0,
      g: Math.min(99, this.pendingTotal()),
      n: this.bag.taken,
      sn: Math.min(99999, this.stats.sent),
    };
  }

  /** Carry on from a parsed snapshot (parseSnap): after a reload or when a new host takes over the bots. */
  restore(snap) {
    this.board.cells.set(snap.cells);
    this.hold = snap.h;
    this.bag = this.makeBag();
    this.bag.skip(snap.n);
    this.stats.sent = snap.sn;
    this.pending = snap.g > 0 ? [{ n: snap.g, col: (snap.n * 7 + snap.g) % 10 }] : [];
    this.cur = null;
    if (snap.ko) {
      this.knockOut('restored');
      return this;
    }
    this.spawn(snap.p ? snap.p[0] : 0);
    return this;
  }
}
