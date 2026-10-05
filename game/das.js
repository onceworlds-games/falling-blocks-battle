// Delayed auto shift on held direction keys: one step at once, after DAS ms a repeat every ARR ms. Pure: fed with a direction
// (-1, 0, 1) and the time that passed, it says how many steps to take.

import { ARR_MS, DAS_MS } from './rules.js';

export class Das {
  constructor(das = DAS_MS, arr = ARR_MS) {
    this.das = das;
    this.arr = Math.max(1, arr);
    this.dir = 0;
    this.t = 0;
    this.made = 0; // repeats made since the delay ran out
  }

  reset() {
    this.dir = 0;
    this.t = 0;
    this.made = 0;
  }

  /** Switch to `dir` as if it had been held long enough already (the other key of a pair let go while this one stayed down). */
  charge(dir) {
    this.dir = dir;
    this.t = this.das;
    this.made = 1;
  }

  /** Steps to take now in direction `dir` (always >= 0), after `dt` ms. */
  update(dir, dt) {
    if (dir === 0) {
      this.reset();
      return 0;
    }
    if (dir !== this.dir) {
      this.dir = dir;
      this.t = 0;
      this.made = 0;
      return 1;
    }
    this.t += dt;
    if (this.t < this.das) return 0;
    const total = Math.floor((this.t - this.das) / this.arr) + 1;
    const steps = total - this.made;
    this.made = total;
    return steps > 0 ? steps : 0;
  }
}
