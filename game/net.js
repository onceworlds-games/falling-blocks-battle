// The match over the network. Every page runs its own board; the host's page also runs the bots, keeps the order people go out in
// and writes one record `g` for the match. Follows the party template: everything a new host needs is in room state (`g`, the
// bots' boards `b`), deadlines are match time, and adopt() is safe to call as often as you like.
//
// g: { mid, by, rid, phase: 'play'|'over'|'final', until (match ms), roster: [{ id, bot, n, c, s }], out: [ids in the order they went
//      out], kos: { id: n }, win: id|'', spd: 'normal'|'fast', sn: { id: lines sent }|null }
// b: { mid, t (match ms), p: { botId: snapshot } }  the bots' boards (see snap.js), ~4 times a second
//
// Messages: { t: 'atk', rid, to, lines, col, f? }  garbage for `to` (f: a bot's id, when the host's page relays a bot's attack)
//           { t: 'ko', rid, by }                   my board topped out; `by` sent me the garbage that did it (to the host)

import { BotMatch, Referee } from './match.js';
import { AWAY_KO_MS, CAP_MS, FINAL_MS, IDLE_KO_MS, OVER_MS, buildRoster } from './rules.js';
import { parseSnap } from './snap.js';

const PHASES = new Set(['play', 'over', 'final']);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const int = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && Math.round(v) >= lo && Math.round(v) <= hi ? Math.round(v) : null);
export const FAST_FORWARD = 6; // bot steps per frame once no person is left on the table
const B_EVERY = 250; // ms between the bots' boards
const BUCKET_CAP = 40; // lines of garbage one sender may have in flight at once...
const BUCKET_RATE = 10; // ...refilling at this many lines per second

/** env: { onAttack(fromId, lines, col): garbage for this page's board }. */
export function createNet(room, env) {
  let ref = null; // the host's Referee
  let bm = null; // the host's BotMatch
  let bmMid = '';
  let lastB = -1e9;
  const awaySince = new Map();
  const idleSince = new Map();
  const buckets = new Map(); // sender -> { tokens, at }

  // ---------------------------------------------------------------- the record
  let rawG = null;
  let goodG = null;
  let goodMid = '';

  function cleanG(g) {
    if (!isObj(g) || typeof g.mid !== 'string' || g.mid !== room.match.id || typeof g.by !== 'string' || typeof g.rid !== 'string') return null;
    if (!PHASES.has(g.phase) || !Number.isFinite(g.until) || typeof g.win !== 'string') return null;
    if (!Array.isArray(g.roster) || g.roster.length < 1 || g.roster.length > 12) return null;
    for (const e of g.roster) {
      if (!isObj(e) || typeof e.id !== 'string' || e.id.length > 80 || !Number.isFinite(e.c)) return null;
      if (e.bot && (typeof e.n !== 'string' || !Number.isFinite(e.s))) return null;
    }
    if (!Array.isArray(g.out) || g.out.length > 12 || g.out.some((id) => typeof id !== 'string')) return null;
    if (!isObj(g.kos)) return null;
    return g;
  }

  /** The record of this match (valid and not left over from the last one), or null. */
  function G() {
    const raw = room.state.g;
    if (raw === rawG && goodMid === room.match.id) return goodG;
    rawG = raw;
    goodMid = room.match.id;
    goodG = cleanG(raw);
    return goodG;
  }

  const write = (patch) => room.setState('g', { ...(G() ?? room.state.g ?? {}), ...patch });
  const hosting = (g) => room.isHost && room.running && g !== null && g.by === room.me.id;
  const speedSetting = () => (room.settings?.speed === 'fast' ? 'fast' : 'normal');
  const rosterEntry = (g, id) => g.roster.find((e) => e.id === id) ?? null;
  const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

  // ---------------------------------------------------------------- the host's page runs the match
  function startMatch() {
    if (!room.isHost) return;
    const ids = (room.match.participants ?? []).filter((id) => typeof id === 'string');
    const roster = buildRoster(ids, num(room.match.seed, 1));
    ref = null;
    bm = null;
    bmMid = '';
    awaySince.clear();
    idleSince.clear();
    lastB = -1e9;
    room.setState('b', null);
    room.setState('g', {
      mid: room.match.id,
      by: room.me.id,
      rid: `${room.match.id}.1`,
      phase: 'play',
      until: 0,
      roster,
      out: [],
      kos: {},
      win: '',
      spd: speedSetting(),
      sn: null,
    });
  }

  /** Build the referee and the bots from the record (and the bots' last boards): a new match, or a host taking over. */
  function ensure(g) {
    if (bm && ref && bmMid === g.mid) return;
    ref = new Referee(g.roster, g.out, g.kos);
    bm = new BotMatch({
      seed: num(room.match.seed, 1),
      roster: g.roster,
      speed: g.spd === 'fast' ? 'fast' : 'normal',
      t: room.matchNow(),
      alive: () => ref.alive(),
      isOut: (id) => ref.isOut(id),
      send: botSend,
      onKo: (id, by) => koEvent(id, by),
    });
    const b = room.state.b;
    if (isObj(b) && b.mid === g.mid && isObj(b.p)) bm.restore(b.p);
    bmMid = g.mid;
  }

  /** A bot's attack on a person: to this page's board, or as a message to them. */
  function botSend(from, to, lines, col) {
    const g = G();
    if (!g || g.phase !== 'play' || g.out.includes(to)) return;
    if (to === room.me.id) env.onAttack(from, lines, col);
    else room.send({ t: 'atk', rid: g.rid, to, f: from, lines, col }, { to });
  }

  /** Someone is out (a person told the host, a bot topped out, a player left). Writes the record. */
  function koEvent(id, by) {
    const g = G();
    if (!g || !ref || g.phase !== 'play') return;
    if (!ref.ko(id, by)) return;
    const patch = { out: [...ref.out], kos: { ...ref.kos } };
    if (ref.over) Object.assign(patch, overPatch(g));
    write(patch);
  }

  function sentLines() {
    const g = G();
    const out = bm ? bm.sent() : {};
    if (g) {
      for (const e of g.roster) {
        if (e.bot) continue;
        const p = e.id === room.me.id ? room.me.presence : room.players.get(e.id)?.presence;
        const snap = isObj(p) ? parseSnap(p) : null;
        out[e.id] = snap ? snap.sn : 0;
      }
    }
    return out;
  }

  function overPatch() {
    const now = room.matchNow();
    return { phase: 'over', win: ref.win, out: [...ref.out], kos: { ...ref.kos }, until: now + OVER_MS, sn: sentLines() };
  }

  /** Take the record over from the previous host: the same state, written by us from now on. */
  function takeOver() {
    ref = null;
    bm = null;
    bmMid = '';
    write({ by: room.me.id });
  }

  /** Carries on as the host: from room state. Safe to call as often as you like. */
  function adopt() {
    if (!room.isHost || !room.running) return;
    const g = G();
    if (!g) return startMatch();
    if (g.by !== room.me.id) takeOver();
  }

  /** People still on the table (connected or away: their seat is held). */
  function peopleLeft(g) {
    for (const e of g.roster) if (!e.bot && !ref.isOut(e.id)) return true;
    return false;
  }

  function watchAbsent(g, now) {
    for (const e of g.roster) {
      if (e.bot || ref.isOut(e.id)) continue;
      const p = room.players.get(e.id);
      if (!p) {
        koEvent(e.id, '');
        continue;
      }
      if (p.connected === false) {
        if (!awaySince.has(e.id)) awaySince.set(e.id, now);
        else if (now - awaySince.get(e.id) > AWAY_KO_MS) koEvent(e.id, '');
        idleSince.delete(e.id);
      } else {
        awaySince.delete(e.id);
        if (p.idle) {
          if (!idleSince.has(e.id)) idleSince.set(e.id, now);
          else if (now - idleSince.get(e.id) > IDLE_KO_MS) koEvent(e.id, '');
        } else idleSince.delete(e.id);
      }
      if (ref.over) return;
    }
  }

  /** The host's ticker, every 100 ms. Only acts for the host of a running match. */
  function tick() {
    const g = G();
    // The host changed hands but the old host's last write landed after ours: ours wins again.
    if (g && room.isHost && room.running && g.by !== room.me.id) return takeOver();
    if (!hosting(g)) return;
    const now = room.matchNow();
    if (g.phase === 'play') {
      ensure(g);
      watchAbsent(g, now);
      if (ref.over) {
        if (G()?.phase === 'play') write(overPatch());
      } else if (now >= CAP_MS) {
        // Out of time: the board with the lowest stack wins.
        const order = bm.bots.filter((b) => !b.engine.ko).sort((a, b) => a.engine.board.maxHeight() - b.engine.board.maxHeight()).map((b) => b.id);
        ref.forceEnd(order);
        write({ out: [...ref.out], ...overPatch() });
      }
    } else if (g.phase === 'over') {
      if (now >= g.until) write({ phase: 'final', until: now + FINAL_MS });
    } else if (g.phase === 'final') {
      if (now >= g.until) room.endMatch(); // back to the lobby, ready flags cleared
    }
  }

  /** Called every fixed step on every page: only the host's does anything. Steps the bots and shares their boards. */
  function frame(dtMs) {
    const g = G();
    if (!hosting(g) || g.phase !== 'play') return;
    ensure(g);
    if (ref.over) return;
    const steps = peopleLeft(g) ? 1 : FAST_FORWARD;
    for (let i = 0; i < steps && !ref.over; i++) bm.step(dtMs);
    const now = room.matchNow();
    if (now - lastB >= B_EVERY && bm.bots.length > 0) {
      lastB = now;
      room.setState('b', { mid: g.mid, t: Math.round(now), p: bm.snapshots() });
    }
  }

  // ---------------------------------------------------------------- messages
  function allow(id, lines) {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let b = buckets.get(id);
    if (!b) buckets.set(id, (b = { tokens: BUCKET_CAP, at: now }));
    b.tokens = Math.min(BUCKET_CAP, b.tokens + ((now - b.at) / 1000) * BUCKET_RATE);
    b.at = now;
    if (b.tokens < lines) return false;
    b.tokens -= lines;
    return true;
  }

  function onAtk(g, d, from) {
    if (g.phase !== 'play' || typeof d.to !== 'string') return;
    const lines = int(d.lines, 1, 24);
    const col = int(d.col, 0, 9);
    if (lines === null || col === null) return;
    // Who sent it: the sender, or (for the host's page) a bot it speaks for.
    let f = from.id;
    if (from.id === room.host && typeof d.f === 'string') {
      const e = rosterEntry(g, d.f);
      if (e && e.bot) f = d.f;
    }
    const sender = rosterEntry(g, f);
    if (!sender || g.out.includes(f) || f === d.to || !allow(f, lines)) return;
    if (d.to === room.me.id) {
      if (!g.out.includes(room.me.id)) env.onAttack(f, lines, col);
    } else if (hosting(g) && bm && ref && !ref.isOut(d.to)) {
      const target = rosterEntry(g, d.to);
      if (target && target.bot) bm.deliver(f, d.to, lines, col);
    }
  }

  function onKoMessage(g, d, from) {
    if (!hosting(g) || g.phase !== 'play') return;
    const e = rosterEntry(g, from.id);
    if (!e || e.bot) return;
    ensure(g);
    koEvent(from.id, typeof d.by === 'string' && d.by !== from.id && rosterEntry(g, d.by) ? d.by : '');
  }

  room.on('message', (d, from) => {
    if (!isObj(d) || !from || typeof from.id !== 'string') return;
    const g = G();
    if (!g || d.rid !== g.rid) return;
    if (d.t === 'atk') onAtk(g, d, from);
    else if (d.t === 'ko') onKoMessage(g, d, from);
  });

  return {
    G,
    adopt,
    tick,
    frame,
    rosterEntry,
    /** This page's board sent `lines` of garbage to `to`. */
    sendAttack(to, lines, col) {
      const g = G();
      if (!g || g.phase !== 'play' || typeof to !== 'string' || to === room.me.id) return;
      const target = rosterEntry(g, to);
      if (!target || g.out.includes(to)) return;
      if (target.bot) {
        if (room.isHost) {
          if (hosting(g)) {
            ensure(g);
            bm.deliver(room.me.id, to, lines, col);
          }
        } else room.send({ t: 'atk', rid: g.rid, to, lines, col }, { to: room.host });
      } else room.send({ t: 'atk', rid: g.rid, to, lines, col }, { to });
    },
    /** This page's board topped out (`by`: the player whose garbage did it, or ''). */
    sendKo(by) {
      const g = G();
      if (!g || g.phase !== 'play') return;
      if (room.isHost) {
        if (hosting(g)) {
          ensure(g);
          koEvent(room.me.id, by);
        }
      } else room.send({ t: 'ko', rid: g.rid, by: by || '' }, { to: room.host });
    },
    /** The host's bots (for tests and the host's own drawing), or null. */
    get bots() {
      return bm;
    },
    get referee() {
      return ref;
    },
    reset() {
      ref = null;
      bm = null;
      bmMid = '';
      lastB = -1e9;
      awaySince.clear();
      idleSince.clear();
      buckets.clear();
    },
  };
}
