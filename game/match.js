// The table of one match, as the host sees it. The Referee keeps the order people go out in and the knockouts (it is the pure
// core of the host's record `g`). BotMatch runs the bots' boards: stepping them, aiming their attacks, handing garbage to bots
// directly and to people through a callback. Both are pure so the tests can play whole matches with only bots.

import { Brain } from './bot.js';
import { Engine } from './engine.js';
import { hashStr, mulberry32 } from './rng.js';
import { RETARGET_MIN, RETARGET_SPREAD, gravityAt, pickTarget, placePoints, suddenCol, suddenDue, warmUp } from './rules.js';
import { parseSnap } from './snap.js';

export class Referee {
  /** roster: [{ id }]; out and kos continue a record (a new host). */
  constructor(roster, out = [], kos = {}) {
    this.ids = roster.map((e) => e.id);
    this.set = new Set(this.ids);
    this.out = [];
    this.outSet = new Set();
    for (const id of out) {
      if (this.set.has(id) && !this.outSet.has(id)) {
        this.out.push(id);
        this.outSet.add(id);
      }
    }
    this.kos = {};
    for (const [id, n] of Object.entries(kos ?? {})) if (this.set.has(id) && Number.isFinite(n)) this.kos[id] = Math.max(0, Math.floor(n));
    this.over = false;
    this.win = '';
    this.update();
  }

  isOut(id) {
    return this.outSet.has(id);
  }

  alive() {
    return this.ids.filter((id) => !this.outSet.has(id));
  }

  aliveCount() {
    return this.ids.length - this.outSet.size;
  }

  /** `id` is out (knocked out by `by`, or on their own with ''). False if they already were, or the match is over. */
  ko(id, by = '') {
    if (this.over || !this.set.has(id) || this.outSet.has(id)) return false;
    this.out.push(id);
    this.outSet.add(id);
    if (by && by !== id && this.set.has(by)) this.kos[by] = (this.kos[by] ?? 0) + 1;
    this.update();
    return true;
  }

  update() {
    if (this.over) return;
    if (this.ids.length > 1 && this.aliveCount() <= 1) {
      this.over = true;
      const alive = this.alive();
      if (alive.length === 1) this.win = alive[0];
      else {
        // Everyone went out together (a restored record): the last one out wins.
        this.win = this.out.pop() ?? '';
        this.outSet.delete(this.win);
      }
    }
  }

  /** The match runs out of time with several boards left: `order` lists them best first; the rest go out worst first. */
  forceEnd(order) {
    if (this.over) return;
    const alive = this.alive();
    const rank = new Map(order.map((id, i) => [id, i]));
    alive.sort((a, b) => (rank.get(a) ?? 99) - (rank.get(b) ?? 99));
    this.win = alive[0] ?? '';
    for (let i = alive.length - 1; i >= 1; i--) {
      this.out.push(alive[i]);
      this.outSet.add(alive[i]);
    }
    this.over = true;
  }

  /** Everyone best first: the winner, then the others by when they went out (last out first). */
  placements() {
    const first = this.over ? [this.win] : this.alive();
    return [...first, ...[...this.out].reverse()].filter(Boolean);
  }

  place(id) {
    const i = this.placements().indexOf(id);
    return i < 0 ? this.ids.length : i + 1;
  }

  points(id) {
    return placePoints(this.place(id), this.ids.length);
  }
}

/** The bots of a match: their engines, brains and aim. `send(from, to, lines, col)` is for attacks on people. */
export class BotMatch {
  /**
   * opts: { seed, roster, speed, t (match ms to start from), alive () -> ids still in, isOut (id) -> bool, send, onKo (id, by),
   *         isolated (a practice table: nothing is sent and a bot that tops out starts again) }
   */
  constructor(opts) {
    this.seed = opts.seed >>> 0;
    this.roster = opts.roster;
    this.speed = opts.speed === 'fast' ? 'fast' : 'normal';
    this.t = Number.isFinite(opts.t) ? opts.t : 0;
    this.alive = opts.alive ?? (() => this.bots.filter((b) => !b.engine.ko).map((b) => b.id));
    this.isOut = opts.isOut ?? (() => false);
    this.send = opts.send ?? (() => {});
    this.onKo = opts.onKo ?? (() => {});
    this.isolated = Boolean(opts.isolated);
    this.bots = [];
    this.byId = new Map();
    const due = suddenDue(this.t);
    this.roster.forEach((entry, idx) => {
      if (!entry.bot) return;
      const b = { id: entry.id, idx, skill: entry.s ?? 0.5, engine: null, brain: null, rng: null, target: '', retargetAt: 0, attackers: new Map(), lastBy: '', lastByAt: -1e9, sud: due, koAt: 0, onLock: null };
      this.fresh(b);
      b.onLock = (res) => this.locked(b, res);
      this.bots.push(b);
      this.byId.set(b.id, b);
    });
  }

  /** A new engine and brain for a bot (the start, and a practice bot that topped out). */
  fresh(b) {
    const gen = (b.gen = (b.gen ?? 0) + 1);
    const seedKey = gen === 1 ? `${this.seed}` : `${this.seed}:${gen}`;
    b.engine = new Engine({ seed: hashStr(seedKey), id: b.id, gravity: gravityAt(this.speed, this.t) });
    b.rng = mulberry32(hashStr(`${seedKey}:${b.id}:aim`));
    b.brain = new Brain(b.engine, { skill: b.skill, rng: mulberry32(hashStr(`${seedKey}:${b.id}:brain`)) });
    b.target = '';
    b.attackers.clear();
    b.lastBy = '';
  }

  /** Advance every bot by dt ms. */
  step(dt) {
    this.t += dt;
    // A practice table stays at an easy pace for ever; a real one speeds up and, late on, turns on sudden death.
    const gt = this.isolated ? Math.min(this.t, 25000) : this.t;
    const g = gravityAt(this.speed, gt);
    const due = suddenDue(gt);
    const slow = this.isolated ? 1 : warmUp(gt);
    for (const b of this.bots) {
      const e = b.engine;
      if (e.ko) {
        if (this.isolated && this.t - b.koAt > 1800) this.fresh(b);
        continue;
      }
      if (this.isOut(b.id)) {
        e.knockOut('out');
        b.koAt = this.t;
        continue;
      }
      e.gravity = g;
      b.brain.slow = slow;
      while (b.sud < due) {
        e.forceGarbage(suddenCol(this.seed, b.sud));
        b.sud++;
      }
      b.brain.update(dt, b.onLock);
    }
  }

  locked(b, res) {
    if (res.send > 0 && !this.isolated) this.attack(b, res.send);
    if (res.ko) {
      b.koAt = this.t;
      if (!this.isolated) this.onKo(b.id, b.lastBy && this.t - b.lastByAt < 20000 ? b.lastBy : '');
    }
  }

  attack(b, lines) {
    const alive = this.alive();
    if (!b.target || !alive.includes(b.target) || this.t >= b.retargetAt) {
      b.target = pickTarget(b.rng, b.id, alive, b.attackers, this.t);
      b.retargetAt = this.t + RETARGET_MIN + b.rng() * RETARGET_SPREAD;
    }
    if (!b.target) return;
    this.deliver(b.id, b.target, lines, Math.floor(b.rng() * 10));
  }

  /** `lines` of garbage from `from` to `to`: straight into a bot's queue, or through the callback for a person. */
  deliver(from, to, lines, col) {
    const tb = this.byId.get(to);
    if (!tb) {
      this.send(from, to, lines, col);
      return;
    }
    if (tb.engine.ko || this.isOut(to)) return;
    tb.engine.receive(lines, col);
    tb.attackers.set(from, this.t);
    tb.lastBy = from;
    tb.lastByAt = this.t;
  }

  /** The bots' boards as the host writes them: { botId: snapshot }, with the aim as a roster index. */
  snapshots() {
    const out = {};
    for (const b of this.bots) {
      const s = b.engine.snapshot();
      s.tg = b.target ? this.roster.findIndex((e) => e.id === b.target) : -1;
      out[b.id] = s;
    }
    return out;
  }

  /** Carry on from what a previous host wrote (see snapshots). */
  restore(map) {
    if (!map || typeof map !== 'object') return;
    for (const b of this.bots) {
      const snap = parseSnap(map[b.id]);
      if (!snap) continue;
      b.engine.restore(snap);
      b.brain.seen = -1;
      b.brain.plan = null;
    }
  }

  /** How many lines each bot has sent so far. */
  sent() {
    const o = {};
    for (const b of this.bots) o[b.id] = b.engine.stats.sent;
    return o;
  }
}
