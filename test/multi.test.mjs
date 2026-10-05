// Several fake pages in one fake room: two people (the host and a guest) and bots play a whole match, the host changes hands in the
// middle of it, a late joiner watches, a page reloads and carries on from its last board, and a player whose seat is held too long
// is out. Everything crosses the wire as JSON with a delay, as it would on the platform.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errors, frame, makePage } from './fakedom.mjs';
import { Hub, owFor } from './hub.mjs';
import { parseSnap } from '../game/snap.js';

async function boot(hub, id, tag) {
  const ow = owFor(hub, id, id);
  const page = makePage({ w: 812, h: 375, onceworlds: ow });
  page.install();
  await import(`../game/main.js?page=${tag}`);
  return { ow, room: ow.room, page, id };
}

function assertClean(pages, label) {
  assert.deepEqual(errors.map(String), [], `${label}: no exceptions`);
  for (const p of pages) assert.deepEqual(p.page.ctx.bad, [], `${label}: nothing odd handed to ${p.id}'s canvas`);
}

const stepper = (hub) => () => {
  hub.tick();
  frame();
};

/** Someone who mashes keys: moves, turns, holds and drops. */
function mash(p, n) {
  p.page.install();
  const k = n % 24;
  if (k === 0) {
    p.page.key('KeyA', n % 48 === 0);
    p.page.key('KeyD', n % 48 !== 0);
  }
  if (k === 6) p.page.key('KeyX');
  if (k === 10) p.page.key('KeyC');
  if (k === 14) p.page.key('KeyZ');
  if (k === 18) p.page.key('Space');
}

test('two people and a late watcher play a match; the host changes mid-match', async () => {
  const hub = new Hub();
  const A = await boot(hub, 'alice', 'a');
  const B = await boot(hub, 'bob', 'b');
  const pages = [A, B];
  const step = stepper(hub);
  for (let i = 0; i < 60; i++) step();
  for (const p of pages) {
    p.page.install();
    p.page.key('Space'); // Play
  }
  for (let i = 0; i < 60 * 4; i++) {
    mash(A, i);
    mash(B, i + 7);
    step();
  }
  assertClean(pages, 'lobby');
  const sa = parseSnap(B.room.players.get('alice').presence);
  assert.ok(sa && sa.m === 'lobby', 'bob sees alice practising');
  assert.ok(parseSnap(A.room.players.get('bob').presence), 'alice sees bob');

  hub.start();
  const seen = new Set();
  let switched = false;
  let late = null;
  let n = 0;
  let wasPlaying = false;
  for (; n < 60 * 600; n++) {
    const g = (switched ? B : A).room.state.g;
    const playing = hub.match.phase === 'playing' && g && g.mid === hub.match.id;
    if (playing) wasPlaying = true;
    if (playing && !switched && A.room.matchNow() > 8000 && g.phase === 'play') {
      switched = true;
      hub.setHost('bob');
    }
    if (playing && !late && A.room.matchNow() > 12000 && g.phase === 'play') {
      late = await boot(hub, 'cara', 'c');
      late.page.install();
      late.page.key('Space');
      pages.push(late);
    }
    mash(A, n);
    mash(B, n + 11);
    step();
    const gg = (switched ? B : A).room.state.g;
    if (gg && gg.mid === hub.match.id) seen.add(gg.phase + (switched && gg.by === 'bob' ? '@bob' : ''));
    if (wasPlaying && hub.match.phase === 'lobby') break;
  }
  assertClean(pages, 'match');
  assert.equal(hub.match.phase, 'lobby', `the match ended (frame ${n})`);
  for (const phase of ['play', 'over', 'final']) assert.ok([...seen].some((s) => s.startsWith(phase)), `${phase} was reached: ${[...seen].join(' ')}`);
  assert.ok([...seen].some((s) => s.endsWith('@bob')), 'the new host took over the record');
  assert.ok(late && late.room.state.g, 'the watcher saw the record too');
  assert.equal(A.room.state.g.mid, B.room.state.g.mid);
  assert.equal(B.room.state.g.roster.length, 8);
  assert.equal(late.room.spectating, false, 'back in the lobby, the watcher is nobody special');
  for (let i = 0; i < 60 * 8; i++) step();
  assertClean(pages, 'back in the lobby');
  console.log(`  phases seen: ${[...seen].join(' ')} after ${(n / 60).toFixed(0)} s`);
});

test('a page that reloads in the middle of a match carries on from its last board', async () => {
  const hub = new Hub();
  const A = await boot(hub, 'dan', 'd');
  const B = await boot(hub, 'eve', 'e');
  const step = stepper(hub);
  for (const p of [A, B]) {
    p.page.install();
    p.page.key('Space');
  }
  for (let i = 0; i < 90; i++) step();
  hub.start();
  for (let i = 0; i < 60 * 4 + 120; i++) {
    mash(A, i);
    mash(B, i + 5);
    step();
  }
  assert.equal(hub.match.phase, 'playing');
  const before = parseSnap(hub.players.get('eve').presence);
  assert.ok(before && before.m === hub.match.id, 'eve was publishing her match board');
  assert.ok(before.n >= 3, `eve had dealt ${before.n} pieces`);
  A.page.dead = false;
  B.page.dead = true; // the old page is gone
  const B2 = await boot(hub, 'eve', 'e2');
  for (let i = 0; i < 90; i++) {
    mash(A, i);
    step();
  }
  // the reloaded page has not been told to play yet: it shows the title until a tap, but it has already joined
  B2.page.install();
  B2.page.key('Space');
  for (let i = 0; i < 60 * 3; i++) {
    mash(A, i);
    mash(B2, i);
    step();
  }
  const after = parseSnap(hub.players.get('eve').presence);
  assert.ok(after && after.m === hub.match.id, 'the new page publishes the same match');
  assert.ok(after.n >= before.n, `it carried on from ${before.n}: ${after.n} pieces dealt now`);
  assertClean([A, B2], 'after the reload');
});

test('a player whose seat is held too long is out, and the match still ends', async () => {
  const hub = new Hub();
  const A = await boot(hub, 'fay', 'f');
  const B = await boot(hub, 'gus', 'g');
  const step = stepper(hub);
  for (const p of [A, B]) {
    p.page.install();
    p.page.key('Space');
  }
  for (let i = 0; i < 90; i++) step();
  hub.start();
  for (let i = 0; i < 60 * 3 + 60; i++) {
    mash(A, i);
    step();
  }
  hub.setAway('gus', true);
  let outAt = -1;
  let wasPlaying = true;
  let n = 0;
  for (; n < 60 * 500; n++) {
    mash(A, n);
    step();
    const g = A.room.state.g;
    if (g && g.mid === hub.match.id && g.out.includes('gus') && outAt < 0) outAt = A.room.matchNow();
    if (wasPlaying && hub.match.phase === 'lobby') break;
  }
  assert.ok(outAt > 0, 'gus was put out');
  assert.equal(hub.match.phase, 'lobby', 'and the match ended');
  assertClean([A], 'after the walk-away');
});

test('garbage sent to a page lands on its board and is shown to the others', async () => {
  const hub = new Hub();
  const A = await boot(hub, 'hal', 'h');
  const B = await boot(hub, 'ivy', 'i');
  const step = stepper(hub);
  for (const p of [A, B]) {
    p.page.install();
    p.page.key('Space');
  }
  for (let i = 0; i < 90; i++) step();
  hub.start();
  for (let i = 0; i < 60 * 4 + 90; i++) step();
  const g = A.room.state.g;
  assert.ok(g && g.phase === 'play', 'the match is on');
  // hal's page sends ivy a quad's worth of garbage, the way a clear would
  A.room.send({ t: 'atk', rid: g.rid, to: 'ivy', lines: 4, col: 3 }, { to: 'ivy' });
  for (let i = 0; i < 45; i++) step();
  const snap = parseSnap(hub.players.get('ivy').presence);
  assert.ok(snap && snap.m === hub.match.id);
  const rose = snap.cells.filter((v) => v === 8).length;
  assert.ok(snap.g >= 1 || rose >= 9, `ivy has ${snap.g} lines waiting and ${rose} garbage blocks on her board`);
  // the host's record is untouched by an attack
  assert.deepEqual(A.room.state.g.out, []);
  // and the same message from a stranger, or about a match long gone, does nothing
  const before = parseSnap(hub.players.get('ivy').presence);
  A.room.send({ t: 'atk', rid: 'old.1', to: 'ivy', lines: 20, col: 0 }, { to: 'ivy' });
  for (let i = 0; i < 45; i++) step();
  const after = parseSnap(hub.players.get('ivy').presence);
  assert.ok(after.g <= before.g + 0 || after.cells.filter((v) => v === 8).length <= rose + 4, 'a stale attack changed nothing');
  assertClean([A, B], 'attacks');
});
