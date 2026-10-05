// The host's record of the match and the messages between pages, against a fake room: who is told what, what is refused, how a new
// host carries on, and that nobody who leaves or walks away can stall the match.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAST_FORWARD, createNet } from '../game/net.js';
import { AWAY_KO_MS, FINAL_MS, IDLE_KO_MS, OVER_MS, buildRoster } from '../game/rules.js';
import { parseSnap } from '../game/snap.js';

function fakeRoom({ me = 'h1', host = 'h1', participants = ['h1', 'h2'], seed = 5, speed = 'normal' } = {}) {
  const listeners = new Map();
  const players = new Map(participants.map((id) => [id, { id, name: id, presence: null }]));
  const sent = [];
  const writes = [];
  const room = {
    me: players.get(me),
    players,
    host,
    state: {},
    connected: true,
    match: { phase: 'playing', id: 'm1', seed, participants, startedAt: 0 },
    now: 0,
    ended: 0,
    get isHost() {
      return this.connected && this.host === this.me.id;
    },
    get running() {
      return this.match.phase === 'playing' && !this.match.paused;
    },
    get settings() {
      return { speed };
    },
    matchNow() {
      return this.now;
    },
    setState(k, v) {
      writes.push(k);
      if (v === null || v === undefined) delete this.state[k];
      else this.state[k] = v;
    },
    send(d, o = {}) {
      sent.push({ d, to: o.to });
    },
    endMatch() {
      this.ended++;
    },
    on(ev, fn) {
      if (!listeners.has(ev)) listeners.set(ev, []);
      listeners.get(ev).push(fn);
    },
  };
  const emit = (ev, ...args) => (listeners.get(ev) ?? []).forEach((fn) => fn(...args));
  return { room, sent, writes, emit };
}

const message = (f, d, from) => f.emit('message', d, f.room.players.get(from) ?? { id: from }, 0, 0);
const g0 = (room) => ({ mid: 'm1', by: 'h1', rid: 'm1.1', phase: 'play', until: 0, roster: buildRoster(['h1', 'h2'], 5), out: [], kos: {}, win: '', spd: 'normal', sn: null });

test('the host writes the record from the match participants, with bots to eight seats', () => {
  const f = fakeRoom();
  const net = createNet(f.room, { onAttack() {} });
  net.adopt();
  const g = net.G();
  assert.ok(g);
  assert.equal(g.mid, 'm1');
  assert.equal(g.by, 'h1');
  assert.equal(g.phase, 'play');
  assert.equal(g.rid, 'm1.1');
  assert.equal(g.roster.length, 8);
  assert.deepEqual(g.roster.slice(0, 2).map((e) => e.id), ['h1', 'h2']);
  assert.deepEqual(g.out, []);
  assert.equal(g.spd, 'normal');
  net.adopt();
  net.adopt();
  assert.equal(f.writes.filter((k) => k === 'g').length, 1, 'adopt is safe to call again and again');
  // a stale record from the last match reads as no record
  f.room.match.id = 'm2';
  assert.equal(net.G(), null);
});

test('a page that is not the host never writes the record', () => {
  const f = fakeRoom({ me: 'h2', host: 'h1' });
  const net = createNet(f.room, { onAttack() {} });
  net.adopt();
  net.tick();
  net.frame(16);
  assert.equal(f.room.state.g, undefined);
});

test('knockouts: told by the person, in order, credited, ending the match when one is left', () => {
  const f = fakeRoom();
  const net = createNet(f.room, { onAttack() {} });
  net.adopt();
  net.frame(16); // builds the bots
  message(f, { t: 'ko', rid: 'm1.0', by: 'bot1' }, 'h2'); // an old round: refused
  assert.deepEqual(net.G().out, []);
  message(f, { t: 'ko', rid: 'm1.1', by: 'bot1' }, 'bot4'); // a bot can't speak for itself
  assert.deepEqual(net.G().out, []);
  message(f, { t: 'ko', rid: 'm1.1', by: 'bot1' }, 'stranger');
  assert.deepEqual(net.G().out, []);
  message(f, { t: 'ko', rid: 'm1.1', by: 'bot1' }, 'h2');
  assert.deepEqual(net.G().out, ['h2']);
  assert.equal(net.G().kos.bot1, 1);
  message(f, { t: 'ko', rid: 'm1.1', by: 'bot2' }, 'h2'); // again: ignored
  assert.deepEqual(net.G().out, ['h2']);
  assert.equal(net.G().kos.bot2, undefined);
  // the others go out
  const bm = net.bots;
  for (const e of net.G().roster.filter((x) => x.bot).slice(0, 5)) bm.onKo(e.id, 'h1');
  assert.equal(net.G().phase, 'play');
  assert.equal(net.G().kos.h1, 5);
  f.room.now = 5000;
  bm.onKo(net.G().roster.filter((x) => x.bot)[5].id, 'h1');
  const g = net.G();
  assert.equal(g.phase, 'over');
  assert.equal(g.win, 'h1');
  assert.equal(g.out.length, 7);
  assert.equal(g.until, 5000 + OVER_MS);
  assert.ok(g.sn && typeof g.sn === 'object');
  assert.equal(g.kos.h1, 6);
  // a knockout after the end changes nothing
  message(f, { t: 'ko', rid: 'm1.1', by: 'h1' }, 'h1');
  assert.equal(net.G().out.length, 7);
});

test('the host knocks itself out directly; others send a message to the host', () => {
  const f = fakeRoom();
  const net = createNet(f.room, { onAttack() {} });
  net.adopt();
  net.sendKo('bot3');
  assert.deepEqual(net.G().out, ['h1']);
  assert.equal(net.G().kos.bot3, 1);
  assert.equal(f.sent.length, 0);

  const g = fakeRoom({ me: 'h2', host: 'h1' });
  g.room.state.g = g0(g.room);
  const net2 = createNet(g.room, { onAttack() {} });
  net2.sendKo('bot1');
  assert.deepEqual(g.sent, [{ d: { t: 'ko', rid: 'm1.1', by: 'bot1' }, to: 'h1' }]);
});

test('attacks addressed to this page are checked before they are used', () => {
  const f = fakeRoom({ me: 'h2', host: 'h1' });
  f.room.state.g = g0(f.room);
  const got = [];
  createNet(f.room, { onAttack: (from, lines, col) => got.push([from, lines, col]) });
  const ok = { t: 'atk', rid: 'm1.1', to: 'h2', lines: 4, col: 3 };
  message(f, ok, 'h1');
  assert.deepEqual(got.pop(), ['h1', 4, 3]);
  for (const bad of [{ lines: 0 }, { lines: 25 }, { lines: 'x' }, { lines: NaN }, { lines: null }, { col: -1 }, { col: 10 }, { col: 'a' }, { to: 'h1' }, { to: 5 }, { rid: 'm1.2' }, { t: 'zap' }]) message(f, { ...ok, ...bad }, 'h1');
  assert.deepEqual(got, [], 'nothing odd got through');
  message(f, ok, 'stranger');
  assert.deepEqual(got, [], 'only people at the table can attack');
  message(f, ok, 'h2');
  assert.deepEqual(got, [], 'not from yourself');
  message(f, { ...ok, f: 'bot2' }, 'h1'); // the host's page speaks for a bot
  assert.deepEqual(got.pop(), ['bot2', 4, 3]);
  message(f, { ...ok, f: 'h1' }, 'h1');
  assert.deepEqual(got.pop(), ['h1', 4, 3]);
  f.room.state.g = { ...f.room.state.g, roster: [...f.room.state.g.roster] };
  // a person can't claim to be a bot
  const third = fakeRoom({ me: 'h2', host: 'h1', participants: ['h1', 'h2', 'h3'] });
  third.room.state.g = { ...g0(third.room), roster: buildRoster(['h1', 'h2', 'h3'], 5) };
  const got3 = [];
  createNet(third.room, { onAttack: (from, lines) => got3.push([from, lines]) });
  message(third, { ...ok, f: 'bot1' }, 'h3');
  assert.deepEqual(got3.pop(), ['h3', 4]);
  // someone who is out can't attack
  third.room.state.g = { ...third.room.state.g, out: ['h3'] };
  message(third, ok, 'h3');
  assert.deepEqual(got3, []);
  // nor once the match is over
  third.room.state.g = { ...third.room.state.g, out: [], phase: 'over' };
  message(third, ok, 'h1');
  assert.deepEqual(got3, []);
});

test('one sender cannot flood a board: attacks are rationed', () => {
  const f = fakeRoom({ me: 'h2', host: 'h1' });
  f.room.state.g = g0(f.room);
  let lines = 0;
  createNet(f.room, { onAttack: (from, n) => (lines += n) });
  for (let i = 0; i < 30; i++) message(f, { t: 'atk', rid: 'm1.1', to: 'h2', lines: 10, col: 1 }, 'h1');
  assert.ok(lines <= 60 && lines >= 30, `${lines} lines got through of 300 sent`);
});

test('attacks from a person on a bot go to the host, who hands them to the bot', () => {
  const f = fakeRoom();
  const net = createNet(f.room, { onAttack() {} });
  net.adopt();
  net.frame(16);
  const bot = net.G().roster.find((e) => e.bot).id;
  net.sendAttack(bot, 6, 4);
  assert.equal(net.bots.byId.get(bot).engine.pendingTotal(), 6);
  net.sendAttack('h2', 3, 1);
  assert.deepEqual(f.sent, [{ d: { t: 'atk', rid: 'm1.1', to: 'h2', lines: 3, col: 1 }, to: 'h2' }]);
  net.sendAttack('h1', 3, 1);
  net.sendAttack('nobody', 3, 1);
  assert.equal(f.sent.length, 1, 'not to yourself, not to a stranger');
  // someone out is not attacked
  message(f, { t: 'ko', rid: 'm1.1', by: '' }, 'h2');
  net.sendAttack('h2', 3, 1);
  assert.equal(f.sent.length, 1);
  // and from a page that isn't the host: through the host
  const p = fakeRoom({ me: 'h2', host: 'h1' });
  p.room.state.g = g0(p.room);
  const n2 = createNet(p.room, { onAttack() {} });
  n2.sendAttack(bot, 5, 2);
  assert.deepEqual(p.sent, [{ d: { t: 'atk', rid: 'm1.1', to: bot, lines: 5, col: 2 }, to: 'h1' }]);
  // the host takes such a message and delivers it
  message(f, { t: 'atk', rid: 'm1.1', to: bot, lines: 5, col: 2 }, 'h2'); // h2 is out now: refused
  assert.equal(net.bots.byId.get(bot).engine.pendingTotal(), 6);
  const f2 = fakeRoom();
  const net3 = createNet(f2.room, { onAttack() {} });
  net3.adopt();
  net3.frame(16);
  const bot2 = net3.G().roster.find((e) => e.bot).id;
  message(f2, { t: 'atk', rid: 'm1.1', to: bot2, lines: 5, col: 2 }, 'h2');
  assert.equal(net3.bots.byId.get(bot2).engine.pendingTotal(), 5);
  message(f2, { t: 'atk', rid: 'm1.1', to: 'h1', lines: 5, col: 2 }, 'h2');
});

test('bots send garbage to a person through the net: to this page directly, to others as a message', () => {
  const f = fakeRoom({ participants: ['h1'] });
  const got = [];
  const net = createNet(f.room, { onAttack: (from, lines, col) => got.push([from, lines, col]) });
  net.adopt();
  for (let i = 0; i < 60 * 120 && got.length < 2; i++) {
    f.room.now += 1000 / 60;
    net.frame(1000 / 60);
  }
  assert.ok(got.length >= 2, 'a bot attacked the host page');
  for (const [from, lines, col] of got) {
    assert.match(from, /^bot\d$/);
    assert.ok(lines >= 1 && lines <= 24 && col >= 0 && col <= 9);
  }
  const f2 = fakeRoom({ participants: ['h1', 'h2'] });
  const net2 = createNet(f2.room, { onAttack() {} });
  net2.adopt();
  for (let i = 0; i < 60 * 180 && f2.sent.length < 2; i++) {
    f2.room.now += 1000 / 60;
    net2.frame(1000 / 60);
  }
  assert.ok(f2.sent.length >= 2, 'messages for the other person');
  for (const s of f2.sent) {
    assert.equal(s.to, 'h2');
    assert.equal(s.d.t, 'atk');
    assert.equal(s.d.to, 'h2');
    assert.match(s.d.f, /^bot\d$/);
  }
});

test('the bots\' boards are shared about four times a second', () => {
  const f = fakeRoom();
  const net = createNet(f.room, { onAttack() {} });
  net.adopt();
  for (let i = 0; i < 60 * 10; i++) {
    f.room.now += 1000 / 60;
    net.frame(1000 / 60);
  }
  const n = f.writes.filter((k) => k === 'b').length;
  assert.ok(n >= 35 && n <= 45, `${n} writes in 10 s`);
  const b = f.room.state.b;
  assert.equal(b.mid, 'm1');
  assert.equal(Object.keys(b.p).length, 6);
  assert.ok(JSON.stringify(b).length < 3500, `${JSON.stringify(b).length} bytes`);
});

test('a new host takes the record over and rebuilds the bots from their last boards', () => {
  const old = fakeRoom();
  const net1 = createNet(old.room, { onAttack() {} });
  net1.adopt();
  for (let i = 0; i < 60 * 15; i++) {
    old.room.now += 1000 / 60;
    net1.frame(1000 / 60);
  }
  const g = old.room.state.g;
  const b = JSON.parse(JSON.stringify(old.room.state.b));
  const heir = fakeRoom({ me: 'h2', host: 'h2' });
  heir.room.state = { g: JSON.parse(JSON.stringify(g)), b };
  heir.room.now = old.room.now;
  const net2 = createNet(heir.room, { onAttack() {} });
  net2.adopt();
  assert.equal(heir.room.state.g.by, 'h2');
  net2.frame(16);
  for (const bot of net2.bots.bots) {
    const snap = parseSnap(b.p[bot.id]);
    assert.deepEqual([...bot.engine.board.cells], [...snap.cells], `${bot.id}'s board`);
    assert.equal(bot.engine.dealt, snap.n, `${bot.id}'s pieces dealt`);
  }
  // the old host's late write comes after: the ticker takes it back
  heir.room.state.g = { ...heir.room.state.g, by: 'h1' };
  net2.tick();
  assert.equal(heir.room.state.g.by, 'h2');
});

test('people who leave, drop for good or walk away never stall the match', () => {
  const f = fakeRoom({ participants: ['h1', 'h2', 'h3'] });
  f.room.players.get('h3').connected = true;
  const net = createNet(f.room, { onAttack() {} });
  net.adopt();
  net.tick();
  assert.deepEqual(net.G().out, []);
  // h2's connection drops: held for a while, then out
  f.room.players.get('h2').connected = false;
  f.room.now = 1000;
  net.tick();
  assert.deepEqual(net.G().out, []);
  f.room.now = 1000 + AWAY_KO_MS - 10;
  net.tick();
  assert.deepEqual(net.G().out, []);
  f.room.now = 1000 + AWAY_KO_MS + 10;
  net.tick();
  assert.deepEqual(net.G().out, ['h2']);
  // h3 comes back in time
  f.room.players.get('h3').connected = false;
  f.room.now += 5000;
  net.tick();
  f.room.players.get('h3').connected = true;
  f.room.now += AWAY_KO_MS;
  net.tick();
  assert.deepEqual(net.G().out, ['h2'], 'back in time: still in');
  // idle for too long
  f.room.players.get('h3').idle = true;
  f.room.now += 100;
  net.tick();
  f.room.now += IDLE_KO_MS + 100;
  net.tick();
  assert.deepEqual(net.G().out, ['h2', 'h3']);
  // gone from the room altogether: out at once
  const g = fakeRoom({ participants: ['h1', 'h2'] });
  const n2 = createNet(g.room, { onAttack() {} });
  n2.adopt();
  g.room.players.delete('h2');
  n2.tick();
  assert.deepEqual(n2.G().out, ['h2']);
});

test('the phases run on their own clock: over, then the results, then the match ends', () => {
  const f = fakeRoom();
  const net = createNet(f.room, { onAttack() {} });
  net.adopt();
  net.frame(16);
  net.sendKo('');
  message(f, { t: 'ko', rid: 'm1.1', by: '' }, 'h2');
  for (const e of net.G().roster.filter((x) => x.bot).slice(0, 4)) net.bots.onKo(e.id, 'h1');
  f.room.now = 1000;
  assert.equal(net.G().phase, 'play', 'two bots still stand');
  net.bots.onKo(net.G().roster.filter((x) => x.bot)[4].id, '');
  assert.equal(net.G().phase, 'over');
  const until = net.G().until;
  f.room.now = until - 1;
  net.tick();
  assert.equal(net.G().phase, 'over');
  f.room.now = until;
  net.tick();
  assert.equal(net.G().phase, 'final');
  assert.equal(net.G().until, until + FINAL_MS);
  assert.equal(f.room.ended, 0);
  f.room.now = until + FINAL_MS - 1;
  net.tick();
  assert.equal(f.room.ended, 0);
  f.room.now = until + FINAL_MS;
  net.tick();
  assert.ok(f.room.ended >= 1, 'the host ends the match');
});

test('once no person is left on the table the bots play out faster', () => {
  const f = fakeRoom();
  const net = createNet(f.room, { onAttack() {} });
  net.adopt();
  net.frame(16);
  const t0 = net.bots.t;
  net.frame(10);
  assert.equal(net.bots.t - t0, 10);
  net.sendKo('');
  message(f, { t: 'ko', rid: 'm1.1', by: '' }, 'h2');
  assert.deepEqual(net.G().out, ['h1', 'h2']);
  const t1 = net.bots.t;
  net.frame(10);
  assert.equal(net.bots.t - t1, 10 * FAST_FORWARD);
  // a paused match (too few players connected) stands still
  f.room.match.paused = { since: 0 };
  const t2 = net.bots.t;
  net.frame(10);
  assert.equal(net.bots.t, t2);
});

test('a record that is not a record is ignored', () => {
  const f = fakeRoom({ me: 'h2', host: 'h1' });
  const net = createNet(f.room, { onAttack() {} });
  for (const junk of [null, 5, 'x', [], {}, { mid: 'm1' }, { ...g0(f.room), roster: [] }, { ...g0(f.room), roster: [{ id: 5 }] }, { ...g0(f.room), out: 'no' }, { ...g0(f.room), phase: 'weird' }, { ...g0(f.room), until: 'x' }, { ...g0(f.room), mid: 'old' }, { ...g0(f.room), kos: [] }]) {
    f.room.state.g = junk;
    assert.equal(net.G(), null, JSON.stringify(junk)?.slice(0, 60));
  }
  f.room.state.g = g0(f.room);
  assert.ok(net.G());
});
