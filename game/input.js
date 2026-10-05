// Keys and the platform's on-screen controls, turned into what the board needs each step: steps left or right (DAS 133 ms / ARR
// 33 ms), whether soft drop is held, and how many hard drops, turns and holds were pressed. Keys: A D / arrows move, S / down
// soft drop, Space / W / up hard drop, X / K turn right, Z / J turn left, C / Shift hold. The stick (analog) moves and soft-drops;
// the buttons press X, Space, C and Z, so they arrive as key events too (and are read as buttons as a fallback, never twice).

import { Das } from './das.js';

const LEFT = new Set(['KeyA', 'ArrowLeft']);
const RIGHT = new Set(['KeyD', 'ArrowRight']);
const SOFT = new Set(['KeyS', 'ArrowDown']);
const HARD = new Set(['Space', 'KeyW', 'ArrowUp']);
const CW = new Set(['KeyX', 'KeyK']);
const CCW = new Set(['KeyZ', 'KeyJ']);
const HOLD = new Set(['KeyC', 'ShiftLeft', 'ShiftRight']);
const MINE = [LEFT, RIGHT, SOFT, HARD, CW, CCW, HOLD];

// The on-screen buttons: the first is the biggest.
export const TOUCH_BUTTONS = [
  { id: 'rotate', label: 'Rotate', key: 'x' },
  { id: 'drop', label: 'Drop', key: ' ' },
  { id: 'hold', label: 'Hold', key: 'c' },
  { id: 'rotate-left', label: '⟲', key: 'z' },
];
const BUTTON_ACTION = { rotate: 'cw', drop: 'hard', hold: 'hold', 'rotate-left': 'ccw' };

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function createInput(ow) {
  const das = new Das();
  const down = new Set(); // codes of the keys held right now
  let lastDir = 0; // the direction key pressed most recently
  let dirPresses = 0; // direction key presses so far (a release and a press between two polls is still a fresh press)
  let seenPresses = 0;
  const counts = { hard: 0, cw: 0, ccw: 0, hold: 0 };
  const stamp = { hard: -1e9, cw: -1e9, ccw: -1e9, hold: -1e9 };
  const wasButton = { rotate: false, drop: false, hold: false, 'rotate-left': false };
  let stickDir = 0;
  let stickSoft = false;
  let usedKeys = false;
  let lastAny = -1e9;
  const out = { move: 0, soft: false, hard: 0, cw: 0, ccw: 0, hold: 0 };

  // A button press arrives as a key event and also as a button held: the second reading of it, a moment later, is the same press.
  function trigger(action, fromButton = false) {
    const t = now();
    if (fromButton && t - stamp[action] < 160) return;
    stamp[action] = t;
    counts[action] = Math.min(4, counts[action] + 1);
    lastAny = t;
  }

  const anyDown = (set) => {
    for (const c of set) if (down.has(c)) return true;
    return false;
  };

  function onKeyDown(e) {
    const code = e.code;
    if (!MINE.some((s) => s.has(code))) return;
    e.preventDefault?.();
    usedKeys = true;
    const fresh = !down.has(code);
    down.add(code);
    if (LEFT.has(code) || RIGHT.has(code)) {
      if (fresh) {
        lastDir = LEFT.has(code) ? -1 : 1;
        dirPresses++;
      }
    } else if (SOFT.has(code)) return;
    else if (e.repeat) return;
    else if (HARD.has(code)) trigger('hard');
    else if (CW.has(code)) trigger('cw');
    else if (CCW.has(code)) trigger('ccw');
    else if (HOLD.has(code)) trigger('hold');
  }

  function onKeyUp(e) {
    const code = e.code;
    if (!down.has(code)) return;
    down.delete(code);
    e.preventDefault?.();
  }

  function releaseAll() {
    down.clear();
    lastDir = 0;
    stickDir = 0;
    stickSoft = false;
    das.reset();
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', releaseAll);
  }
  if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('visibilitychange', () => document.hidden && releaseAll());

  function readStick() {
    const st = ow && ow.controls && ow.controls.stick;
    const x = st && Number.isFinite(st.x) ? st.x : 0;
    const y = st && Number.isFinite(st.y) ? st.y : 0;
    // hysteresis: press past 0.45, let go below 0.3
    if (x > (stickDir === 1 ? 0.3 : 0.45)) stickDir = 1;
    else if (x < (stickDir === -1 ? -0.3 : -0.45)) stickDir = -1;
    else stickDir = 0;
    stickSoft = y > (stickSoft ? 0.35 : 0.55);
  }

  function readButtons() {
    const c = ow && ow.controls;
    if (!c || typeof c.pressed !== 'function') return;
    for (const id of Object.keys(BUTTON_ACTION)) {
      const down = Boolean(c.pressed(id));
      if (down && !wasButton[id]) trigger(BUTTON_ACTION[id], true);
      wasButton[id] = down;
    }
  }

  return {
    /**
     * What to do for the `dt` ms that passed. `enabled` false discards everything pressed (a screen where nothing is played).
     * The returned object is reused: { move: signed steps, soft, hard, cw, ccw, hold } (counts are how many presses).
     */
    poll(dt, enabled = true) {
      readStick();
      readButtons();
      out.move = 0;
      out.hard = out.cw = out.ccw = out.hold = 0;
      if (!enabled) {
        counts.hard = counts.cw = counts.ccw = counts.hold = 0;
        das.reset();
        out.soft = false;
        return out;
      }
      const left = anyDown(LEFT);
      const right = anyDown(RIGHT);
      let dir = 0;
      if (stickDir !== 0) dir = stickDir;
      else if (left && right) dir = lastDir || -1;
      else if (left) dir = -1;
      else if (right) dir = 1;
      // a key let go and pressed again between two polls is a new press
      if (dirPresses !== seenPresses && dir !== 0 && dir === das.dir && stickDir === 0 && dir === lastDir) das.reset();
      seenPresses = dirPresses;
      // the other key was let go and this one is still down: carry on without a fresh step
      if (dir !== 0 && das.dir === -dir && stickDir === 0 && !(dir === 1 ? left : right)) das.charge(dir);
      const steps = das.update(dir, dt);
      out.move = dir * steps;
      out.soft = anyDown(SOFT) || stickSoft;
      out.hard = counts.hard;
      out.cw = counts.cw;
      out.ccw = counts.ccw;
      out.hold = counts.hold;
      counts.hard = counts.cw = counts.ccw = counts.hold = 0;
      return out;
    },
    /** Forget everything held and pressed. */
    clear() {
      releaseAll();
      counts.hard = counts.cw = counts.ccw = counts.hold = 0;
    },
    /** A keyboard player (no touch controls showing). */
    get keyboard() {
      return usedKeys && !(ow && ow.controls && ow.controls.touch);
    },
    get lastInputAt() {
      return lastAny;
    },
  };
}
