import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Bag } from '../game/bag.js';
import { hashStr, mulberry32 } from '../game/rng.js';

const bagFor = (seed, id) => new Bag(mulberry32(hashStr(`${seed}:${id}:bag`)));

test('every aligned run of seven is all seven pieces', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const bag = bagFor(seed, 'p');
    for (let round = 0; round < 40; round++) {
      const seven = [];
      for (let i = 0; i < 7; i++) seven.push(bag.take());
      assert.deepEqual([...seven].sort(), [1, 2, 3, 4, 5, 6, 7], `seed ${seed} round ${round}`);
    }
  }
});

test('droughts are bounded: at most 12 pieces between two of the same kind', () => {
  const bag = bagFor(5, 'x');
  const last = {};
  for (let i = 0; i < 700; i++) {
    const p = bag.take();
    if (last[p] !== undefined) assert.ok(i - last[p] <= 13, `piece ${p} waited ${i - last[p]}`);
    last[p] = i;
  }
});

test('the same seed and player deal the same pieces on every page; another player gets another order', () => {
  const a = bagFor(42, 'ann');
  const b = bagFor(42, 'ann');
  const c = bagFor(42, 'bob');
  const sa = a.peek(70).join('');
  assert.equal(sa, b.peek(70).join(''));
  assert.notEqual(sa, c.peek(70).join(''));
  assert.notEqual(sa, bagFor(43, 'ann').peek(70).join(''));
});

test('peeking deals nothing, skip equals taking', () => {
  const a = bagFor(7, 'z');
  const first = a.peek(5);
  assert.equal(a.taken, 0);
  assert.deepEqual([a.take(), a.take(), a.take(), a.take(), a.take()], first);
  assert.equal(a.taken, 5);
  const s = bagFor(7, 'z');
  s.skip(5);
  assert.equal(s.taken, 5);
  assert.equal(s.take(), a.take());
  assert.equal(a.at(3), a.peek(4)[3]);
});

test('a spread of first pieces is fair (no piece is starved at the start)', () => {
  const firsts = new Array(8).fill(0);
  for (let seed = 1; seed <= 700; seed++) firsts[bagFor(seed, 'q').take()]++;
  for (let t = 1; t <= 7; t++) assert.ok(firsts[t] > 60 && firsts[t] < 150, `piece ${t} came first ${firsts[t]} times of 700`);
});
