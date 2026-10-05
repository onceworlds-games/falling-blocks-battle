// A "view" is what the renderer draws for one board: its cells, falling piece, hold, garbage waiting, and the little bits of
// state that decorate it (knocked out since when, targeted, ready). Views are filled in place each frame from a live engine (your
// board, demo bots) or from a snapshot someone else published. Pure data: no DOM.

import { ROWS } from './pieces.js';

/** A fresh view. `o`: { id, name, bot, color, me }. */
export function makeView(id, o = {}) {
  return {
    id,
    name: o.name ?? '',
    bot: Boolean(o.bot),
    color: o.color ?? '#46e0ff',
    me: Boolean(o.me),
    cells: null,
    piece: [0, 0, 0, 0],
    hasPiece: false,
    hold: 0,
    canHold: true,
    next: [0, 0, 0, 0, 0],
    ghostY: undefined,
    resting: 0,
    ko: false,
    koAt: -1, // animation clock when it was first seen out
    koAge: 0,
    place: 0,
    kos: 0,
    pending: 0,
    hot: false,
    target: false,
    ready: false,
    dx: undefined,
    dy: undefined,
    seenType: 0,
    anim: { clear: null, lock: null, offs: new Float32Array(ROWS) },
  };
}

/** Copy a live engine's state into a view (the cells are shared, not copied). */
export function fillFromEngine(v, e, withNext = false) {
  v.cells = e.board.cells;
  const c = e.cur;
  if (c) {
    v.piece[0] = c.type;
    v.piece[1] = c.rot;
    v.piece[2] = c.x;
    v.piece[3] = c.y;
    v.hasPiece = true;
    v.ghostY = e.ghostY();
    v.resting = e.grounded() ? Math.min(1, e.lockT / 500) : 0;
  } else {
    v.piece[0] = 0;
    v.hasPiece = false;
    v.ghostY = undefined;
    v.resting = 0;
  }
  v.hold = e.hold;
  v.canHold = e.canHold;
  v.pending = e.pendingTotal();
  v.ko = e.ko;
  if (withNext && !e.ko) for (let i = 0; i < 5; i++) v.next[i] = e.next(i);
}

/** Copy a parsed snapshot (parseSnap) into a view. */
export function fillFromSnap(v, s) {
  v.cells = s.cells;
  if (s.p) {
    v.piece[0] = s.p[0];
    v.piece[1] = s.p[1];
    v.piece[2] = s.p[2];
    v.piece[3] = s.p[3];
    v.hasPiece = true;
  } else {
    v.piece[0] = 0;
    v.hasPiece = false;
  }
  v.hold = s.h;
  v.pending = s.g;
  if (s.ko) v.ko = true;
}

/** An empty board for a player whose snapshot hasn't arrived. */
const EMPTY = new Uint8Array(220);
export function fillEmpty(v) {
  v.cells = EMPTY;
  v.piece[0] = 0;
  v.hasPiece = false;
  v.hold = 0;
  v.pending = 0;
}

/** Ease the drawn position of a mini's falling piece toward where its (4 Hz) snapshots say it is. */
export function easePiece(v, dt) {
  if (!v.hasPiece) {
    v.dx = undefined;
    v.dy = undefined;
    v.seenType = 0;
    return;
  }
  const [t, , x, y] = v.piece;
  if (v.dx === undefined || v.seenType !== t || Math.abs(v.dy - y) > 5 || Math.abs(v.dx - x) > 6) {
    v.dx = x;
    v.dy = y;
    v.seenType = t;
    return;
  }
  const k = 1 - Math.exp(-16 * dt);
  v.dx += (x - v.dx) * k;
  v.dy += (y - v.dy) * k;
}
