// Runs the real main.js (and draw.js, ui.js, net.js, ...) on a fake page through the title, the lobby's practice board and a whole
// match on the stand-in room, with a person who plays badly. Fails on any exception, NaN handed to the canvas, or a stuck phase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errors, frames, frame, makePage, audioStats } from './fakedom.mjs';
import { makeStubOw } from '../game/stub.js';

test('title, lobby and a whole match with bots on one page', async () => {
  const ow = makeStubOw();
  const room = ow.room;
  const page = makePage({ w: 812, h: 375, onceworlds: ow });
  page.install();
  await import('../game/main.js');
  assert.deepEqual(errors, []);
  frames(90); // the title, with bots playing behind it
  assert.ok(page.ctx.counts.calls > 800, 'the title drew something');
  assert.deepEqual(page.ctx.bad, []);
  assert.ok(page.ctx.texts.some((t) => t.text === 'PLAY'), 'the Play button is there');
  assert.ok(page.ctx.texts.some((t) => t.text === 'BATTLE'));
  page.key('Space'); // PLAY
  frames(10);
  assert.equal(audioStats.contexts, 1, 'sound started from the tap');
  // the lobby: a practice board that answers the keys
  for (let i = 0; i < 40; i++) {
    page.key(i % 3 === 0 ? 'KeyA' : 'KeyD');
    page.key('KeyX');
    if (i % 5 === 4) page.key('Space');
    frames(6);
    page.key('KeyA', false);
    page.key('KeyD', false);
  }
  assert.equal(room.match.phase, 'lobby');
  assert.deepEqual(errors, []);
  assert.deepEqual(page.ctx.bad, []);
  assert.ok(page.ctx.texts.some((t) => t.text === 'SPEED'), 'the lobby shows the setting');
  // the host taps FAST
  const fast = page.ctx.texts.find((t) => t.text === 'FAST');
  assert.ok(fast, 'the FAST choice is drawn');
  page.fire('pointerdown', { clientX: fast.x / 2, clientY: fast.y / 2, pointerType: 'touch' }, 'canvas'); // the canvas is drawn at 2x
  frames(3);
  assert.equal(room.settings.speed, 'fast');
  room.setSetting('speed', 'normal');
  room.setReady(true); // the platform's Ready strip
  const seen = [];
  let n = 0;
  let wasPlaying = false;
  const texts = new Set();
  for (; n < 60 * 700; n++) {
    // a person who plays badly: hard drops, turns, taps hold
    const k = n % 20;
    if (k === 0) page.key('KeyA', n % 40 === 0), page.key('KeyD', n % 40 !== 0);
    if (k === 5) page.key('KeyX');
    if (k === 8) page.key('KeyC');
    if (k === 12) page.key('Space');
    frame();
    for (const t of page.ctx.texts) if (t.text.length < 24) texts.add(t.text);
    page.ctx.texts.length = 0;
    const g = room.state.g;
    const label = room.match.phase === 'playing' && g && g.mid === room.match.id ? `${room.match.phase}:${g.phase}` : room.match.phase;
    if (seen[seen.length - 1] !== label) seen.push(label);
    if (room.match.phase === 'playing') wasPlaying = true;
    if (wasPlaying && room.match.phase === 'lobby') break;
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(page.ctx.bad, [], 'nothing odd was handed to the canvas');
  assert.ok(wasPlaying, 'the match started');
  assert.equal(room.match.phase, 'lobby', `the match ended itself (after ${n} frames)`);
  console.log(`  phases: ${seen.join(' > ')} in ${(n / 60).toFixed(0)} s of play`);
  assert.ok(seen.includes('starting'));
  assert.ok(seen.includes('playing:play'));
  assert.ok(seen.includes('playing:over'));
  assert.ok(seen.includes('playing:final'));
  for (const want of ['LAST BOARD WINS', 'GO', '3', 'HOLD', 'NEXT', 'ALIVE']) assert.ok(texts.has(want), `"${want}" was drawn at some point`);
  frames(60 * 4); // the lobby again, with the results card
  assert.deepEqual(errors, []);
  assert.deepEqual(page.ctx.bad, []);
  assert.equal(page.ctx.depth, 0, 'every save() was restored');
});
