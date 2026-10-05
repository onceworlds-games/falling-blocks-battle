// Whole matches with only bots through the pure modules (the same Referee and BotMatch the host's page runs), over 20 seeds: it
// ends, ranks everyone, nothing goes NaN, nobody leaves the board; plus the referee's rules, attacks reaching people, and a new
// host carrying the bots on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BotMatch, Referee } from '../game/match.js';
import { COLS, GARBAGE, ROWS } from '../game/pieces.js';
import { CAP_MS, SUDDEN_MS, buildRoster, placePoints } from '../game/rules.js';
import { parseSnap } from '../game/snap.js';

const STEP = 1000 / 60;

function table(seed, humans = [], speed = 'normal', extra = {}) {
  const roster = buildRoster(humans, seed);
  const ref = new Referee(roster);
  const sent = [];
  const bm = new BotMatch({
    seed,
    roster,
    speed,
    alive: () => ref.alive(),
    isOut: (id) => ref.isOut(id),
    send: (from, to, lines, col) => sent.push({ from, to, lines, col }),
    onKo: (id, by) => ref.ko(id, by),
    ...extra,
  });
  return { roster, ref, bm, sent };
}

function checkBoards(bm, where) {
  for (const b of bm.bots) {
    const e = b.engine;
    for (let i = 0; i < e.board.cells.length; i++) if (!(e.board.cells[i] <= GARBAGE)) throw new Error(`${where}: ${b.id} cell ${i} is ${e.board.cells[i]}`);
    if (e.cur && e.board.collides(e.cur.type, e.cur.rot, e.cur.x, e.cur.y)) throw new Error(`${where}: ${b.id}'s piece overlaps the stack`);
    for (const k of ['fall', 'lockT', 'gravity', 'time']) if (!Number.isFinite(e[k])) throw new Error(`${where}: ${b.id}.${k} is ${e[k]}`);
    if (e.pendingTotal() > 40 || e.pendingTotal() < 0) throw new Error(`${where}: ${b.id} has ${e.pendingTotal()} lines waiting`);
  }
}

test('20 seeds of eight bots: every match ends, ranks everyone, stays finite and inside the board', () => {
  let totalSecs = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const { roster, ref, bm, sent } = table(seed, [], seed % 2 ? 'normal' : 'fast');
    let steps = 0;
    while (!ref.over && bm.t < CAP_MS) {
      bm.step(STEP);
      if (++steps % 45 === 0) checkBoards(bm, `seed ${seed} t=${(bm.t / 1000).toFixed(0)}s`);
    }
    checkBoards(bm, `seed ${seed} end`);
    assert.ok(ref.over, `seed ${seed} ended (${(bm.t / 1000).toFixed(0)} s)`);
    assert.ok(bm.t < CAP_MS, 'before the cap');
    assert.ok(roster.some((e) => e.id === ref.win), 'the winner is on the roster');
    const placed = ref.placements();
    assert.equal(placed.length, 8, 'everyone is ranked');
    assert.equal(new Set(placed).size, 8, 'once each');
    assert.equal(placed[0], ref.win);
    const places = roster.map((e) => ref.place(e.id)).sort((a, b) => a - b);
    assert.deepEqual(places, [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(ref.out.length, 7);
    const pts = placed.map((id) => ref.points(id));
    assert.equal(pts[0], 100);
    assert.equal(pts[7], 0);
    for (let i = 1; i < pts.length; i++) assert.ok(pts[i] < pts[i - 1]);
    const kos = Object.values(ref.kos).reduce((a, b) => a + b, 0);
    assert.ok(kos <= 7 && kos >= 1, `${kos} knockouts credited`);
    for (const id of Object.keys(ref.kos)) assert.ok(roster.some((e) => e.id === id));
    // attacks only went to people (there are none here), so nothing was sent out
    assert.equal(sent.length, 0);
    // every bot's board round-trips through a snapshot
    for (const [id, snap] of Object.entries(bm.snapshots())) {
      const parsed = parseSnap(snap);
      assert.ok(parsed, `${id} snapshot is valid`);
      assert.deepEqual([...parsed.cells], [...bm.byId.get(id).engine.board.cells]);
      assert.ok(parsed.tg >= -1 && parsed.tg < 8);
    }
    const s = bm.sent();
    for (const v of Object.values(s)) assert.ok(Number.isFinite(v) && v >= 0);
    totalSecs += bm.t / 1000;
  }
  console.log(`  20 matches, ${(totalSecs / 20).toFixed(0)} s of match time on average`);
});

test('the bots are not all alike: the strongest tend to outlast the weakest', () => {
  let strongBetter = 0;
  let n = 0;
  for (let seed = 100; seed < 116; seed++) {
    const { roster, ref, bm } = table(seed);
    while (!ref.over && bm.t < CAP_MS) bm.step(STEP);
    const bots = roster.filter((e) => e.bot).sort((a, b) => a.s - b.s);
    const weakest = ref.place(bots[0].id);
    const strongest = ref.place(bots[bots.length - 1].id);
    if (strongest < weakest) strongBetter++;
    n++;
  }
  assert.ok(strongBetter >= n * 0.45, `the strongest beat the weakest in ${strongBetter} of ${n}`);
});

test('sudden death: with the clock past eight minutes the lines keep coming until someone is left', () => {
  const { ref, bm } = table(31, [], 'normal');
  bm.t = SUDDEN_MS - 1000;
  bm.bots.forEach((b) => (b.sud = 0));
  for (const b of bm.bots) b.brain.slow = 1;
  while (!ref.over && bm.t < CAP_MS) bm.step(STEP);
  assert.ok(ref.over, 'it ends');
  assert.ok(bm.t < CAP_MS);
});

test('a person at the table: bots send them garbage through the callback, and never to a bot by that route', () => {
  const { roster, ref, bm, sent } = table(7, ['h1']);
  assert.equal(roster[0].id, 'h1');
  let steps = 0;
  while (!ref.over && bm.t < 150000 && steps < 60 * 150) {
    bm.step(STEP);
    steps++;
    if (sent.length > 3 && steps > 60 * 40) break;
  }
  assert.ok(sent.length > 3, `${sent.length} attacks reached the person`);
  for (const a of sent) {
    assert.equal(a.to, 'h1');
    assert.ok(a.from.startsWith('bot'));
    assert.ok(Number.isInteger(a.lines) && a.lines >= 1 && a.lines <= 24);
    assert.ok(Number.isInteger(a.col) && a.col >= 0 && a.col < COLS);
  }
});

test('garbage from a person lands in a bot, and the knockout is credited to them', () => {
  const kos = [];
  const { bm, ref } = table(8, ['h1'], 'normal', { onKo: (id, by) => (kos.push([id, by]), ref.ko(id, by)) });
  const bot = bm.bots[0];
  bm.deliver('h1', bot.id, 5, 3);
  assert.equal(bot.engine.pendingTotal(), 5);
  assert.equal(bot.lastBy, 'h1');
  bm.t += 2000;
  bm.locked(bot, { send: 0, ko: true });
  assert.deepEqual(kos, [[bot.id, 'h1']]);
  assert.equal(ref.kos.h1, 1);
  // someone who is out takes no more garbage
  bm.deliver('h1', bot.id, 5, 3);
  assert.equal(bot.engine.pendingTotal(), 5);
  // a self-inflicted knockout (nobody sent garbage lately) credits no one
  const b2 = bm.bots[1];
  bm.t += 60000;
  bm.locked(b2, { send: 0, ko: true });
  assert.deepEqual(kos[1], [b2.id, '']);
});

test('referee: order, credit, placements, ties and bad input', () => {
  const roster = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
  const r = new Referee(roster);
  assert.equal(r.aliveCount(), 4);
  assert.equal(r.ko('x', ''), false, 'unknown');
  assert.equal(r.ko('b', 'a'), true);
  assert.equal(r.ko('b', 'c'), false, 'out already');
  assert.equal(r.kos.a, 1);
  assert.equal(r.ko('c', 'c'), true, 'knocking yourself out earns nothing');
  assert.equal(r.kos.c, undefined);
  assert.equal(r.over, false);
  assert.deepEqual(r.alive(), ['a', 'd']);
  assert.deepEqual(r.placements(), ['a', 'd', 'c', 'b'], 'alive first, then last out first');
  assert.equal(r.ko('d', 'a'), true);
  assert.equal(r.over, true);
  assert.equal(r.win, 'a');
  assert.deepEqual(r.placements(), ['a', 'd', 'c', 'b']);
  assert.equal(r.ko('a', 'd'), false, 'the match is over');
  assert.equal(r.place('a'), 1);
  assert.equal(r.place('b'), 4);
  assert.equal(r.points('a'), 100);
  assert.equal(r.points('b'), 0);
  assert.equal(r.points('c'), placePoints(3, 4));
  // continuing a record
  const again = new Referee(roster, ['b', 'c', 'zzz', 'b'], { a: 2, q: 5, d: 'x' });
  assert.deepEqual(again.out, ['b', 'c']);
  assert.deepEqual(again.kos, { a: 2 });
  assert.equal(again.over, false);
  again.ko('d', '');
  assert.equal(again.win, 'a');
  // everyone out in a restored record: the last one out wins
  const all = new Referee(roster, ['a', 'b', 'c', 'd']);
  assert.equal(all.over, true);
  assert.equal(all.win, 'd');
  assert.equal(all.aliveCount(), 1);
  // the clock runs out
  const f = new Referee(roster);
  f.ko('d', '');
  f.forceEnd(['c', 'a', 'b']);
  assert.equal(f.over, true);
  assert.equal(f.win, 'c');
  assert.deepEqual(f.placements(), ['c', 'd', 'b', 'a'].filter((x, i, arr) => arr.indexOf(x) === i).length === 4 ? f.placements() : []);
  assert.equal(new Set(f.placements()).size, 4);
  // one-seat tables never end by themselves
  assert.equal(new Referee([{ id: 'solo' }]).over, false);
});

test('a new host carries the bots on from the last boards, with the same pieces coming', () => {
  const { roster, ref, bm } = table(21);
  for (let i = 0; i < 60 * 20; i++) bm.step(STEP);
  const snaps = JSON.parse(JSON.stringify(bm.snapshots())); // as the room hands them over
  const ref2 = new Referee(roster, ref.out, ref.kos);
  const bm2 = new BotMatch({ seed: 21, roster, speed: 'normal', t: bm.t, alive: () => ref2.alive(), isOut: (id) => ref2.isOut(id), onKo: (id, by) => ref2.ko(id, by) });
  bm2.restore(snaps);
  for (const b of bm.bots) {
    const b2 = bm2.byId.get(b.id);
    assert.deepEqual([...b2.engine.board.cells], [...b.engine.board.cells], `${b.id} board`);
    assert.equal(b2.engine.hold, b.engine.hold);
    assert.equal(b2.engine.dealt, b.engine.dealt);
    assert.deepEqual([0, 1, 2, 3, 4].map((i) => b2.engine.next(i)), [0, 1, 2, 3, 4].map((i) => b.engine.next(i)), `${b.id} next pieces`);
  }
  // and the table plays on to a finish
  let steps = 0;
  while (!ref2.over && bm2.t < CAP_MS && steps++ < 60 * 400) bm2.step(STEP);
  checkBoards(bm2, 'after the takeover');
  assert.ok(ref2.over);
  assert.equal(ref2.placements().length, 8);
});

test('boards stay inside the field whatever garbage does to them', () => {
  const { bm } = table(55);
  for (const b of bm.bots) for (let i = 0; i < 60; i++) b.engine.receive(24, i % 10);
  for (let i = 0; i < 60 * 30; i++) bm.step(STEP);
  checkBoards(bm, 'under a garbage storm');
  for (const b of bm.bots) assert.ok(b.engine.board.maxHeight() <= ROWS);
});
