// The 7-bag randomizer: every seven pieces are a shuffled set of all seven, so droughts are short and every player's luck is fair.
// Each player has their own bag, seeded from the match seed and their id.

import { shuffle } from './rng.js';

export class Bag {
  constructor(rng) {
    this.rng = rng;
    this.queue = [];
    this.taken = 0; // how many pieces have been dealt
  }

  fill(n) {
    while (this.queue.length < n) {
      const bag = [1, 2, 3, 4, 5, 6, 7];
      shuffle(bag, this.rng);
      for (let i = 0; i < 7; i++) this.queue.push(bag[i]);
    }
  }

  /** The `i`th piece to come (0 is the next); nothing is dealt. */
  at(i) {
    this.fill(i + 1);
    return this.queue[i];
  }

  /** The next `n` pieces (a copy). */
  peek(n) {
    this.fill(n);
    return this.queue.slice(0, n);
  }

  take() {
    this.fill(1);
    this.taken++;
    return this.queue.shift();
  }

  /** Deal `n` pieces and throw them away (catching up after a reload). */
  skip(n) {
    for (let i = 0; i < n; i++) this.take();
  }
}
