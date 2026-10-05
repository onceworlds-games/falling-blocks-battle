// The store art is drawn by the real renderer on a fake page: every poster has its exact size, draws something, hands nothing odd to
// the canvas, flags itself ready, and has only the text the brief allows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errors, makePage } from './fakedom.mjs';

const WANT = {
  cover: { size: [1280, 720], text: true },
  action: { size: [1280, 720], text: false },
  win: { size: [1280, 720], text: true },
  icon: { size: [512, 512], text: false },
  'badge-first-win': { size: [256, 256], text: false },
  'badge-four-lines': { size: [256, 256], text: false },
  'badge-combo-5': { size: [256, 256], text: true },
  'badge-t-spin': { size: [256, 256], text: false },
};

for (const [name, want] of Object.entries(WANT)) {
  test(`poster ${name}`, async () => {
    const page = makePage({ w: want.size[0], h: want.size[1], search: `?poster=${name}` });
    page.install();
    const { runPoster, POSTER_SIZES } = await import('../game/poster.js');
    assert.deepEqual(POSTER_SIZES[name], want.size);
    await runPoster(page.canvas, name);
    assert.equal(page.document.body.dataset.ready, '1', 'flagged ready');
    assert.deepEqual([page.canvas.width, page.canvas.height], want.size);
    assert.deepEqual(page.ctx.bad, [], 'nothing odd handed to the canvas');
    assert.ok(page.ctx.counts.calls > (name.startsWith('badge') ? 20 : 150), `${page.ctx.counts.calls} drawing calls`);
    assert.equal(page.ctx.depth, 0, 'every save() was restored');
    const texts = page.ctx.texts.map((t) => t.text);
    if (!want.text) assert.deepEqual(texts, [], `no text on ${name}`);
    assert.deepEqual(errors, []);
    if (name === 'cover') {
      assert.ok(texts.includes('FALLING BLOCKS') && texts.includes('BATTLE'), 'the name, big');
      assert.ok(texts.includes('QUAD!'));
      const big = page.ctx.texts.find((t) => t.text === 'BATTLE');
      assert.ok(big.size >= 60, `the title is ${big.size.toFixed(0)} px`);
      assert.ok(big.y < 720 / 3 + 20, 'in the top third');
    }
    if (name === 'win') assert.ok(texts.includes('1ST'));
    if (name === 'badge-combo-5') assert.deepEqual(texts, ['×5']);
  });
}

test('the posters are the same every time', async () => {
  const draws = [];
  for (let i = 0; i < 2; i++) {
    const page = makePage({ w: 1280, h: 720 });
    page.install();
    const { runPoster } = await import('../game/poster.js');
    await runPoster(page.canvas, 'cover');
    draws.push(page.ctx.counts.calls);
  }
  assert.equal(draws[0], draws[1]);
});

test('an unknown poster is refused', async () => {
  const page = makePage({ w: 100, h: 100 });
  page.install();
  const { runPoster } = await import('../game/poster.js');
  await assert.rejects(() => runPoster(page.canvas, 'nope'));
});
