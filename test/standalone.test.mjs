// The page opened on its own (no platform around it): it falls back to the stand-in room and still plays.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errors, frames, makePage } from './fakedom.mjs';

test('with no onceworlds on the page the title, the lobby and a practice board still run', async () => {
  const page = makePage({ w: 1100, h: 760, onceworlds: undefined });
  page.install();
  await import('../game/main.js?standalone');
  frames(120);
  assert.deepEqual(errors, []);
  assert.ok(page.ctx.texts.some((t) => t.text === 'PLAY'));
  page.fire('pointerdown', { clientX: 400, clientY: 300 }, 'canvas');
  frames(30);
  for (let i = 0; i < 30; i++) {
    page.key('Space');
    frames(10);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(page.ctx.bad, []);
  assert.ok(page.ctx.texts.some((t) => t.text === 'SPEED'));
});

test('a very small and a very large screen both draw without trouble', async () => {
  for (const [w, h] of [[320, 240], [3000, 1400]]) {
    const page = makePage({ w, h, onceworlds: undefined });
    page.install();
    await import(`../game/main.js?size${w}`);
    frames(60);
    page.key('Space');
    frames(60);
    page.resize(h, w); // rotated
    frames(30);
    assert.deepEqual(errors, [], `${w}x${h}`);
    assert.deepEqual(page.ctx.bad, [], `${w}x${h}`);
  }
});
