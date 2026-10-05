// Keys and touch controls turned into steps for the board: DAS and ARR, two keys at once, soft drop, presses counted once, and a
// button that arrives as a key event and as a held button is one press.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const handlers = { keydown: [], keyup: [], blur: [] };
globalThis.window = { addEventListener: (type, fn) => handlers[type]?.push(fn) };
globalThis.document = { addEventListener() {}, hidden: false };
const { createInput, TOUCH_BUTTONS } = await import('../game/input.js');

const fire = (type, code, extra = {}) => handlers[type].forEach((fn) => fn({ code, repeat: false, preventDefault() {}, ...extra }));
const down = (code, extra) => fire('keydown', code, extra);
const up = (code) => fire('keyup', code);

function make(controls = { stick: { x: 0, y: 0 }, touch: false, pressed: () => false }) {
  for (const k of Object.keys(handlers)) handlers[k].length = 0;
  return { input: createInput({ controls }), controls };
}

test('a held direction steps at once, waits 133 ms, then repeats every 33 ms', () => {
  const { input } = make();
  down('KeyA');
  let steps = input.poll(16.7).move;
  assert.equal(steps, -1, 'one step at once, to the left');
  let total = 0;
  let t = 0;
  while (t < 110) {
    total += input.poll(16.7).move;
    t += 16.7;
  }
  assert.equal(total, 0, 'nothing during the delay');
  for (let i = 0; i < 30; i++) total += input.poll(16.7).move; // 500 ms more
  assert.ok(total <= -11 && total >= -16, `${total} steps in half a second of repeat`);
  up('KeyA');
  assert.equal(input.poll(16.7).move, 0);
});

test('arrows and WASD both work; both directions together go the way pressed last, and letting go resumes the other', () => {
  const { input } = make();
  down('ArrowRight');
  assert.equal(input.poll(16).move, 1);
  down('ArrowLeft');
  assert.equal(input.poll(16).move, -1, 'the newest key wins, with a step at once');
  up('ArrowLeft');
  assert.equal(input.poll(16).move, 0, 'right resumes without a fresh step');
  for (let i = 0; i < 12; i++) input.poll(16);
  up('ArrowRight');
  down('KeyD');
  assert.equal(input.poll(16).move, 1);
});

test('soft drop is held; hard drop, turns and hold are counted once per press and ignore key repeat', () => {
  const { input } = make();
  down('KeyS');
  assert.equal(input.poll(16).soft, true);
  up('ArrowDown');
  assert.equal(input.poll(16).soft, true, 'S is still down');
  up('KeyS');
  assert.equal(input.poll(16).soft, false);
  for (const [code, field] of [['Space', 'hard'], ['KeyW', 'hard'], ['ArrowUp', 'hard'], ['KeyX', 'cw'], ['KeyK', 'cw'], ['KeyZ', 'ccw'], ['KeyJ', 'ccw'], ['KeyC', 'hold'], ['ShiftLeft', 'hold'], ['ShiftRight', 'hold']]) {
    const { input: i2 } = make();
    down(code);
    down(code, { repeat: true });
    down(code, { repeat: true });
    const o = i2.poll(16);
    assert.equal(o[field], 1, `${code} -> ${field}`);
    assert.equal(i2.poll(16)[field], 0, 'once');
  }
});

test('input is discarded on screens where nothing is played', () => {
  const { input } = make();
  down('Space');
  down('KeyA');
  const o = input.poll(16, false);
  assert.deepEqual([o.move, o.hard, o.cw], [0, 0, 0]);
  assert.equal(input.poll(16, true).hard, 0, 'not remembered for later');
});

test('losing focus lets go of every key', () => {
  const { input } = make();
  down('KeyA');
  down('KeyS');
  input.poll(16);
  handlers.blur.forEach((fn) => fn());
  const o = input.poll(16);
  assert.deepEqual([o.move, o.soft], [0, false]);
});

test('the stick moves and soft-drops; the buttons arrive as keys and as buttons, counted once', () => {
  const stick = { x: 0, y: 0 };
  const held = new Set();
  const { input } = make({ stick, touch: true, pressed: (id) => held.has(id) });
  stick.x = 0.8;
  assert.equal(input.poll(16).move, 1);
  stick.x = 0.35;
  input.poll(16);
  assert.equal(input.poll(16).move, 0, 'hysteresis: held, no step yet');
  stick.x = 0;
  stick.y = 0.9;
  assert.equal(input.poll(16).soft, true);
  stick.y = 0;
  assert.equal(input.poll(16).soft, false);
  // the Rotate button: a key event and a held button together
  held.add('rotate');
  down('KeyX'); // the platform's key press
  const o = input.poll(16);
  assert.equal(o.cw, 1, 'one turn, not two');
  held.delete('rotate');
  input.poll(16);
  // a button whose key event never came
  const { input: bare } = make({ stick: { x: 0, y: 0 }, touch: true, pressed: (id) => id === 'drop' });
  assert.equal(bare.poll(16).hard, 1, 'the held button alone still counts');
  assert.equal(bare.poll(16).hard, 0);
  assert.deepEqual(TOUCH_BUTTONS.map((b) => b.id), ['rotate', 'drop', 'hold', 'rotate-left']);
  assert.deepEqual(TOUCH_BUTTONS.map((b) => b.key), ['x', ' ', 'c', 'z']);
});

test('a hundred rapid presses never pile up more than a few', () => {
  const { input } = make();
  for (let i = 0; i < 100; i++) down('KeyX');
  assert.ok(input.poll(16).cw <= 4);
});
