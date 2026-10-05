// The rules of the match as numbers and small pure functions: gravity, the attack table, targeting, placement points, rosters.
// Pure: no DOM; everything random takes a seeded rng.

import { hashStr, mulberry32, shuffle } from './rng.js';

// ---------------------------------------------------------------- the match
export const SEATS = 8; // bots fill the table to this many
export const MAX_PLAYERS = 12;
export const SPEEDS = [
  { value: 'normal', label: 'Normal' },
  { value: 'fast', label: 'Fast' },
];
export const DEFAULT_SPEED = 'normal';
export const OVER_MS = 3200; // the winner's moment before the results
export const FINAL_MS = 9000; // the results, then the host ends the match
export const AWAY_KO_MS = 20000; // a player whose connection has been gone this long is out
export const IDLE_KO_MS = 45000; // a player who hasn't touched the game this long is out
export const SUDDEN_MS = 8 * 60 * 1000; // after this, every board gets rising lines that no attack can cancel, more every SUDDEN_EVERY
export const SUDDEN_EVERY = 10000;
export const CAP_MS = 14 * 60 * 1000; // the match ends whatever happens

// ---------------------------------------------------------------- gravity
export const LEVEL_MS = 30000; // gravity steps up every 30 s of match time
export const GRAVITY_CAP = 20; // rows per second
export const GRAVITY_STEP = 1.4;
export const SOFT_FACTOR = 20;
export const LOCK_MS = 500;
export const MAX_RESETS = 15;
export const DAS_MS = 133;
export const ARR_MS = 33;

export const levelAt = (ms) => (ms > 0 ? Math.floor(ms / LEVEL_MS) : 0);

/** Rows per second at `ms` of match time: 1 (Fast: 2) rising by 40% every 30 s up to 20. */
export function gravityAt(speed, ms) {
  const base = speed === 'fast' ? 2 : 1;
  return Math.min(GRAVITY_CAP, base * Math.pow(GRAVITY_STEP, levelAt(ms)));
}

// ---------------------------------------------------------------- attack
/** Lines sent by a plain clear of 1-4 lines. */
export const LINE_ATTACK = [0, 0, 1, 2, 4];
/** Lines sent by a T-spin clear of 1-3 lines, and by a mini T-spin single. */
export const TSPIN_ATTACK = [0, 2, 4, 6];
export const MINI_ATTACK = 1;
export const COMBO_BONUS = [0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5];
export const B2B_BONUS = 1;
export const PERFECT_BONUS = 10;

/** The bonus for the `combo`th clear in a row (0 for the first of a streak). */
export const comboBonus = (combo) => (combo <= 0 ? 0 : COMBO_BONUS[Math.min(combo, COMBO_BONUS.length - 1)]);

/**
 * Lines a clear sends before incoming garbage cancels any of it.
 * tspin: 0 none, 1 mini, 2 full. b2b: the clear is a difficult one that follows another. combo: 0 for the first clear of a streak.
 */
export function attackFor({ lines, tspin = 0, b2b = false, combo = 0, perfect = false }) {
  if (lines <= 0) return { base: 0, b2b: 0, combo: 0, perfect: 0, total: 0 };
  let base;
  if (tspin === 2) base = TSPIN_ATTACK[Math.min(lines, 3)];
  else if (tspin === 1) base = lines === 1 ? MINI_ATTACK : TSPIN_ATTACK[Math.min(lines, 3)];
  else base = LINE_ATTACK[Math.min(lines, 4)];
  const bonusB2b = b2b ? B2B_BONUS : 0;
  const bonusCombo = comboBonus(combo);
  const bonusPerfect = perfect ? PERFECT_BONUS : 0;
  return { base, b2b: bonusB2b, combo: bonusCombo, perfect: bonusPerfect, total: base + bonusB2b + bonusCombo + bonusPerfect };
}

/** Whether a clear is a "difficult" one (a quad or any T-spin that clears): the ones back-to-back counts. */
export const isDifficult = (lines, tspin) => lines === 4 || (tspin > 0 && lines > 0);

/** How much slower than full pace the bots play `ms` into a match: they stack up first, like people do (2.4x slower at the start, full pace from two and a half minutes). */
export const warmUp = (ms) => 1 + 1.4 * Math.max(0, 1 - ms / 150000);

// ---------------------------------------------------------------- sudden death
/** How many lines the sudden death has put on every board by `ms` of match time: one at eight minutes, then more every 10 s (1, 3, 6, 10...). */
export function suddenDue(ms) {
  if (ms < SUDDEN_MS) return 0;
  const k = 1 + Math.floor((ms - SUDDEN_MS) / SUDDEN_EVERY);
  return (k * (k + 1)) / 2;
}

/** The hole of the `i`th sudden-death line: the same on every page. */
export const suddenCol = (seed, i) => hashStr(`${seed >>> 0}:sd:${i}`) % 10;

// ---------------------------------------------------------------- targeting
export const RETARGET_MIN = 3000;
export const RETARGET_SPREAD = 3000;
export const REVENGE_CHANCE = 0.5;
export const REVENGE_WINDOW = 10000;

/**
 * Who an attack goes to: with a 50% chance one of the players who attacked you in the last 10 s (Revenge), else anyone alive at
 * random. `attackers`: Map id -> time (ms) of their last attack on you. Returns '' when nobody else is alive.
 */
export function pickTarget(rng, meId, alive, attackers, now) {
  const others = alive.filter((id) => id !== meId);
  if (others.length === 0) return '';
  if (attackers && attackers.size > 0 && rng() < REVENGE_CHANCE) {
    const recent = others.filter((id) => now - (attackers.get(id) ?? -Infinity) <= REVENGE_WINDOW);
    if (recent.length > 0) return recent[Math.floor(rng() * recent.length)];
  }
  return others[Math.floor(rng() * others.length)];
}

// ---------------------------------------------------------------- placing
/** Points for finishing `place`th (1-based) of `n`: 100 for the winner down to 0 for the first out. */
export function placePoints(place, n) {
  if (n <= 1) return 100;
  return Math.round((100 * (n - Math.min(Math.max(1, place), n))) / (n - 1));
}

export const ordinal = (n) => {
  const m = n % 100;
  if (m >= 11 && m <= 13) return `${n}TH`;
  return `${n}${['TH', 'ST', 'ND', 'RD'][n % 10 < 4 ? n % 10 : 0]}`;
};

// ---------------------------------------------------------------- names, colours, rosters
export const BOT_NAMES = ['Nova', 'Echo', 'Blaze', 'Pixel', 'Rook', 'Vex', 'Kai', 'Juno', 'Orbit', 'Zed', 'Mika', 'Rio', 'Ace', 'Sol'];

/** One accent colour per seat (index c in the roster). */
export const COLORS = ['#ff4d6d', '#ffb703', '#4cc9f0', '#72efdd', '#b388ff', '#ff8fab', '#8ac926', '#ff7b00', '#4895ef', '#f15bb5', '#00f5d4', '#fee440'];

/** The bots' pieces per second by skill 0..1: 1.2 for the weakest to 2.5 for the strongest. */
export const ppsFor = (skill) => 1.2 + 1.3 * Math.min(1, Math.max(0, skill));

/**
 * The table of a match: the participants (people) first, then bots up to 8 seats (none when 8 or more people play).
 * [{ id, bot: 0|1, n: name (bots), c: colour index, s: skill (bots) }]
 */
export function buildRoster(humanIds, seed, seats = SEATS) {
  const people = [...new Set(humanIds.filter((id) => typeof id === 'string' && id))].slice(0, MAX_PLAYERS);
  const rng = mulberry32(hashStr(`${seed >>> 0}:roster`));
  const nBots = Math.max(0, Math.min(seats, MAX_PLAYERS) - people.length);
  const names = shuffle([...BOT_NAMES], rng);
  const skills = [];
  for (let i = 0; i < nBots; i++) skills.push(nBots === 1 ? 0.6 : 0.15 + (0.8 * i) / (nBots - 1));
  shuffle(skills, rng);
  const roster = people.map((id, i) => ({ id, bot: 0, c: i % COLORS.length }));
  for (let i = 0; i < nBots; i++) {
    roster.push({ id: `bot${i + 1}`, bot: 1, n: names[i % names.length], c: (people.length + i) % COLORS.length, s: Math.round(skills[i] * 100) / 100 });
  }
  return roster;
}
