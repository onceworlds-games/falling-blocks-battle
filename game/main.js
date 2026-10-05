// Falling Blocks Battle: boot, the frame loop and the screens.
//
// Every page runs its own board (engine.js) at a fixed 60 Hz and publishes it as presence about four times a second. The other
// boards are drawn from presence (people) or from the host's record of the bots (room.state.b). The host's page also runs the
// bots, the order people go out in and the match record `g` (net.js). What is on screen is derived from room.match.phase plus `g`:
// title -> lobby (a practice board) -> countdown -> match -> results over the lobby.

import { createAudio } from './audio.js';
import { initAvatars } from './avatars.js';
import { renderScene } from './draw.js';
import { Engine } from './engine.js';
import { createFx } from './fx.js';
import { ACCENT, PIECE_COLORS, clamp } from './gfx.js';
import { TOUCH_BUTTONS, createInput } from './input.js';
import { computeLayout } from './layout.js';
import { BotMatch, Referee } from './match.js';
import { createNet } from './net.js';
import { CELLS, COLS, HIDDEN, ROWS } from './pieces.js';
import { runPoster } from './poster.js';
import { hashStr, mulberry32 } from './rng.js';
import {
  COLORS, DEFAULT_SPEED, LEVEL_MS, MAX_PLAYERS, REVENGE_WINDOW, RETARGET_MIN, RETARGET_SPREAD, SPEEDS, SUDDEN_MS, buildRoster, gravityAt, levelAt, pickTarget, placePoints, suddenCol, suddenDue,
} from './rules.js';
import { parseSnap } from './snap.js';
import { makeStubOw, makeStubRoom } from './stub.js';
import * as ui from './ui.js';
import { easePiece, fillEmpty, fillFromEngine, fillFromSnap, makeView } from './views.js';

const params = new URLSearchParams(location.search);
const posterName = params.get('poster');
const canvas = document.getElementById('c');

async function boot() {
  const standalone = !window.onceworlds;
  const ow = window.onceworlds || makeStubOw();
  try {
    ow.ui.setOrientation('landscape');
  } catch {
    // not on the platform
  }
  // Join first, before anything heavy is built, so a reload doesn't miss its seat.
  let room;
  let offline = standalone;
  try {
    room = await ow.rooms.join({
      maxPlayers: MAX_PLAYERS,
      minPlayers: 1,
      lobby: 'bar',
      settings: [{ id: 'speed', label: 'Speed', options: SPEEDS, default: DEFAULT_SPEED }],
    });
  } catch (err) {
    console.error('could not join a room', err);
    room = standalone ? ow.room : makeStubRoom(() => ow.now());
    offline = true;
  }
  try {
    document.fonts?.load('800 40px "Exo 2"');
    document.fonts?.load('italic 900 40px "Exo 2"');
  } catch {
    // fonts are only for looks
  }
  run(ow, room, room.kind === 'solo' && typeof room.tick === 'function' ? room : null, offline);
}

const STEP = 1000 / 60;
const QUALITY = { low: 0.4, medium: 0.7, high: 1 };
const fin = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 24) || 'Player';
const TSPIN_NAME = ['', 'SINGLE', 'DOUBLE', 'TRIPLE'];

/** Where each blend of two layouts goes: every number moves a bit, arrays of the same length too. */
function blend(a, b, k) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 0.4 ? b : a + (b - a) * k;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) return b.map((v, i) => blend(a[i], v, k));
  if (isObj(a) && isObj(b)) {
    const o = {};
    for (const key of Object.keys(b)) o[key] = blend(a[key], b[key], k);
    return o;
  }
  return b;
}

/** For new row r after a clear: how many rows it falls (it came from old row r - shift[r]). */
function clearShift(rows) {
  const set = new Set(rows);
  const shift = new Float32Array(ROWS);
  let o = ROWS - 1;
  for (let r = ROWS - 1; r >= rows.length; r--) {
    while (set.has(o)) o--;
    shift[r] = r - o;
    o--;
  }
  return shift;
}

function run(ow, room, tickable, offline) {
  const ctx = canvas.getContext('2d');
  const audio = createAudio();
  const input = createInput(ow);
  const fx = createFx();
  const meId = room.me.id;
  initAvatars((id) => ow.player.avatarUrl(id, 'head'));

  // The scene the renderer draws (see draw.js); main.js refills it every frame.
  const Sc = {
    w: 1,
    h: 1,
    pr: 1,
    time: 0,
    pulse: 0,
    mode: 'title',
    L: null,
    busy: false,
    fx,
    reduced: false,
    q: 1,
    main: null,
    minis: [],
    hud: null,
    danger: 0,
    shake: { x: 0, y: 0 },
    labels: true,
  };

  const S = {
    started: false, // PLAY was tapped
    mode: 'title',
    acc: 0,
    last: 0,
    eng: null, // this page's board
    engKey: '',
    engKind: '', // 'practice' | 'match'
    engSpawned: false,
    rng: mulberry32(hashStr(`${meId}:${Date.now()}`)),
    attackers: new Map(), // id -> match ms of their last attack on me
    lastBy: '',
    lastByAt: -1e9,
    target: '',
    retargetAt: 0,
    revenge: false,
    sud: 0,
    views: new Map(),
    slotOf: new Map(), // id -> its slot on screen
    titleDemo: null,
    lobbyDemo: null,
    hit: { play: null, speed: [] },
    stats: { matches: 0, wins: 0, kos: 0, lines: 0, best: 0 },
    badged: new Set(),
    savedMid: '',
    results: null,
    resultsMid: '',
    resultsAt: -99,
    cardUntil: -99,
    seenMid: '',
    seenOut: 0,
    seenKos: 0,
    koAt: -99,
    koSentAt: -99,
    koBy: '',
    practiceKoAt: -99,
    lastCount: -99,
    wasPlaying: false,
    lastPublish: -99,
    controls: '',
    dangerAt: -99,
    featured: '',
    overAt: -99,
    overSeen: '',
    errors: 0,
    mainId: meId,
  };

  // ---------------------------------------------------------------- saves and badges
  Promise.resolve()
    .then(() => ow.save.get('stats'))
    .then((s) => {
      if (isObj(s)) S.stats = { matches: fin(s.matches), wins: fin(s.wins), kos: fin(s.kos), lines: fin(s.lines), best: fin(s.best) };
    })
    .catch(() => {});

  function badge(id) {
    if (S.badged.has(id)) return;
    S.badged.add(id);
    Promise.resolve()
      .then(() => ow.badges.award(id))
      .catch(() => {});
  }

  const speedOf = () => (room.settings && room.settings.speed === 'fast' ? 'fast' : 'normal');
  const seedOf = () => fin(room.match.seed, 1) >>> 0;
  const nameOf = (id, g) => {
    const e = g ? g.roster.find((r) => r.id === id) : null;
    if (e && e.bot) return cleanName(e.n);
    return cleanName(room.players.get(id)?.name);
  };

  // ---------------------------------------------------------------- the net
  function onAttack(from, lines, col) {
    if (!S.eng || S.engKind !== 'match' || S.eng.ko) return;
    const g = net.G();
    if (!g || g.phase !== 'play') return;
    const took = S.eng.receive(lines, col);
    if (took <= 0) return;
    const now = room.matchNow();
    S.attackers.set(from, now);
    S.lastBy = from;
    S.lastByAt = now;
    audio.incoming(took);
    fx.flash('#ff2d44', 0.08 + Math.min(0.2, took * 0.02));
    fx.shake(0.05 + Math.min(0.2, took * 0.02));
  }
  const net = createNet(room, { onAttack });

  room.on('matchstart', () => {
    net.adopt();
  });
  room.on('host', () => net.adopt());
  room.on('reconnect', () => net.adopt());
  room.on('matchend', () => {
    net.reset();
    S.cardUntil = Sc.time + 7;
    S.target = '';
    S.attackers.clear();
    S.engKey = ''; // the practice board comes back
    fx.clear();
    S.views.clear();
    S.featured = '';
  });
  room.on('starting', () => {
    S.results = null;
    S.cardUntil = -99;
    fx.clear();
    S.views.clear();
    S.featured = '';
  });
  ow.on('pause', () => input.clear());
  setInterval(() => {
    try {
      net.tick();
    } catch (err) {
      console.error(err);
    }
  }, 100);

  // ---------------------------------------------------------------- layout and settings
  function resize() {
    const w = Math.max(1, window.innerWidth || 800);
    const h = Math.max(1, window.innerHeight || 450);
    const pr = Math.max(0.5, Number(ow.settings.pixelRatio(2)) || 1);
    Sc.w = w;
    Sc.h = h;
    Sc.pr = pr;
    canvas.width = Math.floor(w * pr);
    canvas.height = Math.floor(h * pr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    Sc.L = null;
  }
  function applySettings() {
    Sc.q = QUALITY[ow.settings.quality] ?? 1;
    Sc.reduced = Boolean(ow.settings.reducedMotion);
    fx.q = Sc.q;
    fx.reduced = Sc.reduced;
  }
  resize();
  applySettings();
  addEventListener('resize', resize);
  try {
    ow.settings.on('change', () => {
      applySettings();
      resize();
    });
  } catch {
    // older platform
  }
  room.hideLobby(true);

  // ---------------------------------------------------------------- this page's board
  const myView = () => {
    let v = S.views.get(meId);
    if (!v) {
      v = makeView(meId, { name: cleanName(room.me.name), color: ACCENT, me: true });
      S.views.set(meId, v);
    }
    return v;
  };

  function newPractice() {
    S.engKind = 'practice';
    S.engSpawned = true;
    S.eng = new Engine({ seed: (S.rng() * 4294967296) >>> 0, id: meId, gravity: gravityAt(speedOf(), 0) });
    S.practiceKoAt = -99;
    const v = myView();
    v.anim.clear = null;
    v.anim.lock = null;
    v.ko = false;
    v.koAt = -1;
    S.koAt = -99;
  }

  function newMatchEngine() {
    const m = room.match;
    S.engKind = 'match';
    S.attackers.clear();
    S.lastBy = '';
    S.target = '';
    S.koAt = -99;
    S.koSentAt = -99;
    S.engSpawned = false;
    const v = myView();
    v.anim.clear = null;
    v.anim.lock = null;
    v.ko = false;
    v.koAt = -1;
    if (!room.isParticipant(meId)) {
      S.eng = null;
      return;
    }
    const ms = room.matchNow();
    S.eng = new Engine({ seed: seedOf(), id: meId, gravity: gravityAt(speedOf(), ms), start: false });
    S.sud = suddenDue(ms);
    // A reload in the middle of a match: carry on from the board this page last published.
    const p = room.me.presence;
    const snap = isObj(p) && p.m === m.id ? parseSnap(p) : null;
    if (snap && m.phase === 'playing') {
      S.eng.restore(snap);
      S.engSpawned = true;
      if (S.eng.ko) S.koAt = Sc.time - 3;
    }
  }

  function syncEngine() {
    if (!S.started) {
      S.eng = null;
      S.engKey = '';
      S.engKind = '';
      return;
    }
    const m = room.match;
    const key = m.phase === 'lobby' ? 'practice' : `match:${m.id}`;
    if (key !== S.engKey) {
      S.engKey = key;
      if (key === 'practice') newPractice();
      else newMatchEngine();
    }
    if (S.engKind === 'match' && S.eng && !S.engSpawned && m.phase === 'playing' && !S.eng.ko) {
      S.eng.spawn(0);
      S.engSpawned = true;
    }
    if (S.engKind === 'practice' && S.eng && S.eng.ko && Sc.time - S.practiceKoAt > 1.5) newPractice();
  }

  // ---------------------------------------------------------------- what a lock does
  // The layout can be briefly missing right after a resize: fall back to a fresh one so effects never throw.
  const lay = () => Sc.L ?? (Sc.L = computeLayout(Sc.w, Sc.h, S.mode === 'lobby' ? 'lobby' : 'play', 7, false));
  const boardPos = (x, y) => {
    const B = lay().board;
    const c = lay().c;
    return [B.x + (x + 0.5) * c, B.y + (y - HIDDEN + 0.5) * c];
  };

  function currentTarget(g, now) {
    if (!g) return '';
    if (S.target && !g.out.includes(S.target) && now < S.retargetAt) return S.target;
    const alive = g.roster.map((e) => e.id).filter((id) => !g.out.includes(id));
    S.target = pickTarget(S.rng, meId, alive, S.attackers, now);
    S.retargetAt = now + RETARGET_MIN + S.rng() * RETARGET_SPREAD;
    S.revenge = S.target !== '' && now - (S.attackers.get(S.target) ?? -Infinity) <= REVENGE_WINDOW;
    return S.target;
  }

  function beamTo(id, lines) {
    const slot = S.slotOf.get(id);
    const B = lay().board;
    if (!slot) return;
    fx.beam(B.x + B.w / 2, B.y + B.h * 0.3, slot.bx + slot.bw / 2, slot.by + slot.bh * 0.4, lines, '#ffe14d', id);
  }

  fx.onBeamHit = (b) => {
    audio.hit();
    fx.ring(b.x1, b.y1, 4, 30, '#ffe14d', 0.4, 3);
    fx.burst(b.x1, b.y1, 10, { colors: ['#ffe14d', '#ff7b3b', '#ffffff'], speed: 150, life: 0.5, size: 3, g: 200 });
  };

  function clearFx(res, v) {
    const B = lay().board;
    const c = lay().c;
    const lines = res.lines;
    v.anim.clear = { t0: Sc.time, rows: res.rows, shift: clearShift(res.rows), color: PIECE_COLORS[res.type] };
    for (const y of res.rows) {
      for (let x = 0; x < COLS; x++) {
        fx.burst(B.x + (x + 0.5) * c, B.y + (y - HIDDEN + 0.5) * c, 2, { colors: [PIECE_COLORS[res.type], '#ffffff', PIECE_COLORS[((x + y) % 7) + 1]], speed: 130 + lines * 40, g: 700, kind: 2, size: c * 0.34, life: 0.8, angle: -Math.PI / 2, spread: Math.PI * 1.2 });
      }
    }
    if (lines === 4) audio.quad();
    else audio.clear(lines, res.combo);
    if (res.tspin > 0) audio.tspin();
    if (res.combo >= 1) audio.combo(res.combo);
    if (res.b2b) audio.b2b();
    if (res.perfect) audio.perfect();
    // callouts
    let main = '';
    let color = '#ffffff';
    let size = 1;
    if (res.perfect) {
      main = 'PERFECT CLEAR!';
      color = '#ffe14d';
      size = 0.62;
    } else if (res.tspin > 0) {
      main = res.tspin === 1 && lines === 1 ? 'T-SPIN MINI!' : `T-SPIN ${TSPIN_NAME[Math.min(3, lines)]}!`;
      color = '#d28bff';
      size = main.length > 12 ? 0.58 : 0.8;
    } else if (lines === 4) {
      main = 'QUAD!';
      color = ACCENT;
    } else if (lines >= 2) {
      main = lines === 2 ? 'DOUBLE' : 'TRIPLE';
      size = 0.55;
    }
    if (main) fx.callout(main, { color, size });
    if (res.b2b) fx.callout('BACK-TO-BACK', { color: '#ff9f2b', size: 0.42 });
    if (res.combo >= 1) fx.callout(`${res.combo} COMBO`, { color: '#ffe14d', size: 0.46 });
    const big = lines === 4 || res.tspin > 0 || res.perfect;
    fx.shake(big ? 0.45 : 0.06 + 0.04 * lines);
    if (big) {
      fx.freeze(60);
      fx.flash(res.tspin > 0 ? '#d28bff' : '#ffffff', 0.16);
      fx.ring(B.x + B.w / 2, B.y + B.h * 0.5, c, c * 9, color, 0.55, 4);
    }
    if (lines === 4) badge('four-lines');
    if (res.combo >= 5) badge('combo-5');
    if (res.tspin > 0) badge('t-spin');
  }

  function riseFx(res) {
    const B = lay().board;
    let rows = 0;
    for (const r of res.rise) rows += r.n;
    audio.rise(rows);
    fx.shake(0.14 + 0.03 * rows);
    fx.burst(B.x + B.w / 2, B.y + B.h, 14, { colors: ['#ff5468', '#586179', '#ffffff'], speed: 220, life: 0.6, size: 4, g: 500, angle: -Math.PI / 2, spread: Math.PI * 0.9 });
  }

  function lastAttacker(now) {
    return S.lastBy && now - S.lastByAt < 20000 ? S.lastBy : '';
  }

  function myKo(now) {
    S.koAt = Sc.time;
    audio.ko();
    fx.shake(0.7);
    fx.flash('#ff2d44', 0.3);
    fx.freeze(90);
    if (S.engKind === 'match') {
      S.koBy = lastAttacker(now);
      S.koSentAt = Sc.time;
      net.sendKo(S.koBy);
    } else S.practiceKoAt = Sc.time;
  }

  function onMyLock(res) {
    const v = myView();
    const inMatch = S.engKind === 'match';
    const s = CELLS[res.type][res.rot];
    const cells = [];
    for (let i = 0; i < 8; i += 2) cells.push(res.x + s[i], res.y + s[i + 1]);
    v.anim.lock = { t0: Sc.time, cells };
    const B = lay().board;
    const c = lay().c;
    if (res.drop > 0) {
      audio.hard(res.drop);
      fx.shake(Math.min(0.14, 0.03 + res.drop * 0.006));
      for (let i = 0; i < 8; i += 2) {
        const [px, py] = boardPos(res.x + s[i], res.y + s[i + 1] + 1);
        fx.burst(px, py - c * 0.3, 2, { colors: [PIECE_COLORS[res.type], '#ffffff'], speed: 90, life: 0.35, size: 3, g: 300, kind: 1, angle: -Math.PI / 2, spread: 1.4 });
      }
    } else audio.lock();
    if (res.lines > 0) clearFx(res, v);
    else if (res.tspin > 0) {
      fx.callout('T-SPIN', { color: '#d28bff', size: 0.8 });
      audio.tspin();
      fx.shake(0.2);
    }
    if (res.rise && res.rise.length > 0) riseFx(res);
    if (res.send > 0) {
      fx.float(`+${res.send}`, B.x + B.w / 2, B.y + c * 2.5, '#ffe14d', Math.max(18, c * 0.95));
      audio.send(res.send);
      if (inMatch) {
        const g = net.G();
        const to = currentTarget(g, room.matchNow());
        if (to) {
          net.sendAttack(to, res.send, Math.floor(S.rng() * 10));
          beamTo(to, res.send);
        }
      } else {
        const slots = [...S.slotOf.keys()].filter((id) => id !== meId);
        if (slots.length > 0) beamTo(slots[Math.floor(S.rng() * slots.length)], res.send);
      }
    }
    if (res.ko) myKo(room.matchNow());
  }

  // ---------------------------------------------------------------- the fixed step
  function applyInput(inp) {
    const e = S.eng;
    let moved = false;
    const dir = inp.move < 0 ? -1 : 1;
    for (let i = 0, n = Math.abs(inp.move); i < n; i++) {
      if (!e.move(dir)) break;
      moved = true;
    }
    if (moved) audio.move();
    for (let i = 0; i < inp.cw; i++) if (e.rotate(1)) audio.rotate();
    for (let i = 0; i < inp.ccw; i++) if (e.rotate(-1)) audio.rotate();
    for (let i = 0; i < inp.hold; i++) {
      if (e.holdSwap()) {
        audio.hold();
        const B = lay().board;
        fx.burst(B.x - lay().c * 2.5, B.y + lay().c * 2, 6, { colors: ['#9fc4ff', '#ffffff'], speed: 90, life: 0.4, size: 3, g: 0 });
      }
      if (e.ko) break;
    }
    for (let i = 0; i < inp.hard && !e.ko; i++) {
      const res = e.hardDrop();
      if (res) onMyLock(res);
    }
  }

  function step(ms) {
    const g = net.G();
    const m = room.match;
    let canPlay = false;
    const e = S.eng;
    if (S.started && e && !e.ko && room.connected) {
      if (S.engKind === 'practice') canPlay = S.mode === 'lobby';
      else if (S.engKind === 'match') canPlay = room.running && m.phase === 'playing' && g !== null && g.phase === 'play' && S.engSpawned;
    }
    const inp = input.poll(ms, canPlay);
    if (canPlay) {
      const nowMs = room.matchNow();
      if (S.engKind === 'match') {
        e.gravity = gravityAt(speedOf(), nowMs);
        const due = suddenDue(nowMs);
        while (S.sud < due) {
          e.forceGarbage(suddenCol(seedOf(), S.sud));
          S.sud++;
        }
      }
      applyInput(inp);
      if (!e.ko) {
        const y0 = e.cur ? e.cur.y : 0;
        const res = e.tick(ms, inp.soft);
        if (inp.soft && e.cur && e.cur.y !== y0) audio.soft();
        if (res) onMyLock(res);
      }
    }
    try {
      net.frame(ms);
    } catch (err) {
      if (S.errors++ < 5) console.error(err);
    }
    // the title's and the lobby's worlds
    const td = S.titleDemo;
    if (td && S.mode === 'title') {
      td.bm.step(ms);
      if (td.ref.over) {
        td.overFor += ms;
        if (td.overFor > 2500) S.titleDemo = makeTitleDemo(td.seed + 1);
      }
    }
    const ld = S.lobbyDemo;
    if (ld && S.mode === 'lobby') {
      ld.bm.step(ms);
      ld.bm.t = Math.min(ld.bm.t, 25000);
    }
  }

  function makeTitleDemo(seed) {
    const roster = buildRoster([], seed, 8);
    const ref = new Referee(roster);
    const bm = new BotMatch({ seed, roster, speed: 'fast', t: 45000, alive: () => ref.alive(), isOut: (id) => ref.isOut(id), onKo: (id, by) => ref.ko(id, by) });
    return { seed, roster, ref, bm, overFor: 0 };
  }
  function makeLobbyDemo() {
    const roster = buildRoster([], 777, 7);
    const bm = new BotMatch({ seed: 777, roster, speed: 'normal', t: 5000, isolated: true });
    return { roster, bm };
  }
  S.titleDemo = makeTitleDemo(20261);
  S.lobbyDemo = makeLobbyDemo();

  // ---------------------------------------------------------------- views
  function viewFor(id, name, color, bot) {
    let v = S.views.get(id);
    if (!v) {
      v = makeView(id, { name, color, bot, me: id === meId });
      S.views.set(id, v);
    }
    v.name = name;
    v.color = color;
    v.bot = bot;
    return v;
  }

  function finishView(v, dt, koFlag) {
    if (koFlag) v.ko = true;
    if (v.ko) {
      if (v.koAt < 0) v.koAt = Sc.time;
      v.koAge = Sc.time - v.koAt;
    } else {
      v.koAt = -1;
      v.koAge = 0;
    }
    easePiece(v, dt);
  }

  function engineViewOf(id, name, color, bot, engine, withNext) {
    const v = viewFor(id, name, color, bot);
    fillFromEngine(v, engine, withNext);
    v.hot = false;
    v.target = false;
    v.kos = 0;
    v.place = 0;
    v.ready = false;
    return v;
  }

  function botSnap(g, id) {
    const b = room.state.b;
    if (!g || !isObj(b) || b.mid !== g.mid || !isObj(b.p)) return null;
    return parseSnap(b.p[id]);
  }

  function peerSnap(g, id) {
    const p = room.players.get(id)?.presence;
    const s = isObj(p) ? parseSnap(p) : null;
    return s && g && s.m === g.mid ? s : null;
  }

  const rosterIndex = (g, id) => (g ? g.roster.findIndex((e) => e.id === id) : -1);

  function featuredOf(g, alive) {
    if (S.featured && alive.includes(S.featured)) return S.featured;
    let best = alive[0] ?? '';
    let bestK = -1;
    for (const id of alive) {
      const k = g.kos[id] ?? 0;
      if (k > bestK) {
        best = id;
        bestK = k;
      }
    }
    S.featured = best;
    return best;
  }

  // Everything the renderer needs for the title and the lobby.
  function sceneTitle(dt) {
    const td = S.titleDemo;
    const bots = td.bm.bots;
    const views = bots.map((b, i) => {
      const e = td.roster[b.idx];
      const v = engineViewOf(`demo:${b.id}`, cleanName(e.n), COLORS[e.c % COLORS.length], true, b.engine, i === 0);
      v.kos = td.ref.kos[b.id] ?? 0;
      const out = td.ref.isOut(b.id);
      finishView(v, dt, out);
      if (out) v.place = td.roster.length - td.ref.out.indexOf(b.id);
      return v;
    });
    Sc.main = views[0];
    Sc.minis = views.slice(1);
    Sc.hud = null;
    Sc.danger = 0;
    return Sc.minis.length;
  }

  function sceneLobby(dt) {
    const mine = engineViewOf(meId, cleanName(room.me.name), ACCENT, false, S.eng ?? S.lobbyDemo.bm.bots[0].engine, true);
    mine.me = true;
    finishView(mine, dt, S.eng ? S.eng.ko : false);
    const minis = [];
    const humans = room.online.filter((p) => p.id !== meId).slice(0, MAX_PLAYERS - 1);
    humans.forEach((p, i) => {
      const v = viewFor(p.id, cleanName(p.name), COLORS[(i + 2) % COLORS.length], false);
      const s = isObj(p.presence) ? parseSnap(p.presence) : null;
      v.ko = false;
      if (s && s.m === 'lobby') fillFromSnap(v, s);
      else fillEmpty(v);
      v.ready = Boolean(p.ready);
      v.hot = false;
      v.target = false;
      v.kos = 0;
      v.place = 0;
      v.pending = 0;
      finishView(v, dt, false);
      minis.push(v);
    });
    mine.ready = Boolean(room.me.ready);
    const total = Math.max(7, humans.length);
    const bots = S.lobbyDemo.bm.bots;
    for (let i = 0; minis.length < total && i < bots.length; i++) {
      const b = bots[i];
      const e = S.lobbyDemo.roster[b.idx];
      const v = engineViewOf(`demo:${b.id}`, cleanName(e.n), COLORS[e.c % COLORS.length], true, b.engine, false);
      v.ready = true;
      finishView(v, dt, b.engine.ko);
      minis.push(v);
    }
    Sc.main = mine;
    Sc.minis = minis;
    Sc.hud = null;
    Sc.danger = 0;
    return minis.length;
  }

  function sceneMatch(dt) {
    const m = room.match;
    const g = net.G();
    const roster = g ? g.roster : buildRoster(m.participants ?? [], seedOf());
    const out = g ? g.out : [];
    const ms = room.matchNow();
    const iAmIn = roster.some((e) => e.id === meId) && room.isParticipant(meId);
    const meOut = iAmIn && (out.includes(meId) || (S.eng !== null && S.eng.ko));
    const alive = roster.map((e) => e.id).filter((id) => !out.includes(id));
    const showMine = iAmIn && (!meOut || Sc.time - S.koAt < 2.4);
    let mainId = meId;
    if (!showMine) mainId = g ? featuredOf(g, alive) : (roster[0]?.id ?? meId);
    S.mainId = mainId;
    const myIdx = rosterIndex(g, meId);
    const views = new Map();
    for (const e of roster) {
      const color = COLORS[e.c % COLORS.length];
      const name = e.bot ? cleanName(e.n) : e.id === meId ? cleanName(room.me.name) : cleanName(room.players.get(e.id)?.name);
      let v;
      let snap = null;
      if (e.id === meId && S.eng) {
        v = engineViewOf(e.id, name, ACCENT, false, S.eng, true);
        v.ko = S.eng.ko;
      } else {
        v = viewFor(e.id, name, e.id === meId ? ACCENT : color, Boolean(e.bot));
        v.ko = false;
        snap = e.bot ? botSnap(g, e.id) : peerSnap(g, e.id);
        if (snap) fillFromSnap(v, snap);
        else fillEmpty(v);
      }
      const isOut = out.includes(e.id);
      v.kos = g ? (g.kos[e.id] ?? 0) : 0;
      v.place = isOut ? roster.length - out.indexOf(e.id) : g && g.win === e.id ? 1 : 0;
      v.hot = Boolean(snap && snap.tg >= 0 && snap.tg === myIdx && myIdx >= 0 && !meOut && !isOut && e.id !== mainId);
      v.target = e.id === S.target && !isOut && e.id !== mainId;
      v.ready = false;
      v.me = e.id === meId;
      finishView(v, dt, isOut);
      views.set(e.id, v);
    }
    if (iAmIn && !meOut && g && g.phase === 'play') {
      currentTarget(g, ms);
      const tv0 = views.get(S.target);
      if (tv0 && tv0.id !== mainId) tv0.target = true;
    }
    const main = views.get(mainId) ?? null;
    Sc.main = main;
    Sc.minis = roster.filter((e) => e.id !== mainId).map((e) => views.get(e.id));
    // the HUD
    const eng = S.eng;
    const over = g && g.phase !== 'play';
    const level = levelAt(ms);
    const aliveN = over ? 1 : Math.max(1, alive.length);
    const tv = S.target ? views.get(S.target) : null;
    Sc.hud = {
      time: ms / 1000,
      level: level + 1,
      levelFrac: (ms % LEVEL_MS) / LEVEL_MS,
      alive: aliveN,
      total: roster.length,
      kos: g ? (g.kos[meId] ?? 0) : 0,
      lines: eng ? eng.stats.lines : 0,
      combo: eng && eng.combo >= 1 && !eng.ko ? eng.combo : 0,
      b2b: Boolean(eng && eng.b2b && !eng.ko),
      target: tv && !out.includes(S.target) ? tv : null,
      revenge: S.revenge,
      label: !iAmIn || meOut ? 'WATCHING' : ms >= SUDDEN_MS ? 'OVERTIME' : '',
    };
    const maxH = eng && !eng.ko ? eng.board.maxHeight() : 0;
    Sc.danger = showMine ? clamp((maxH - 13) / 6, 0, 1) : 0;
    return roster.length - 1;
  }

  // ---------------------------------------------------------------- results and saving
  function buildResults(g) {
    const placements = [g.win, ...[...g.out].reverse()].filter(Boolean);
    const seen = new Set();
    const order = placements.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
    const n = g.roster.length;
    const rows = order.map((id, i) => {
      const e = g.roster.find((r) => r.id === id);
      return {
        id,
        name: nameOf(id, g),
        bot: Boolean(e && e.bot),
        color: COLORS[(e ? e.c : i) % COLORS.length],
        place: i + 1,
        pts: placePoints(i + 1, n),
        kos: g.kos[id] ?? 0,
        sent: isObj(g.sn) ? fin(g.sn[id]) : 0,
      };
    });
    const me = rows.find((r) => r.id === meId) ?? null;
    const awards = [];
    const mostKos = [...rows].sort((a, b) => b.kos - a.kos)[0];
    if (mostKos && mostKos.kos > 0) awards.push({ label: 'MOST KOS', name: `${mostKos.name} ×${mostKos.kos}` });
    const mostSent = [...rows].sort((a, b) => b.sent - a.sent)[0];
    if (mostSent && mostSent.sent >= 8) awards.push({ label: 'MOST SENT', name: `${mostSent.name} ${mostSent.sent}` });
    return { rows, me, awards, mid: g.mid };
  }

  function overSeen(g) {
    // The winner is known: sound, a stat line, a badge and the leaderboard, once per match.
    if (S.overSeen === g.mid) return;
    S.overSeen = g.mid;
    S.overAt = Sc.time;
    const iPlayed = g.roster.some((e) => e.id === meId);
    if (g.win === meId) {
      audio.win();
      const B = lay().board;
      fx.burst(B.x + B.w / 2, 30, 80, { colors: [ACCENT, '#ffe14d', '#ff4d6d', '#b25cff', '#37d983'], speed: 360, life: 1.6, size: 6, g: 420, kind: 2, angle: Math.PI / 2, spread: Math.PI * 1.1 });
      fx.flash('#ffe14d', 0.2);
    } else if (iPlayed) audio.lose();
    else audio.win();
    if (!iPlayed || S.savedMid === g.mid) return;
    S.savedMid = g.mid;
    const place = g.win === meId ? 1 : g.roster.length - g.out.indexOf(meId);
    const s = S.stats;
    s.matches++;
    s.kos += g.kos[meId] ?? 0;
    if (S.eng) s.lines += S.eng.stats.lines;
    if (place === 1) s.wins++;
    s.best = s.best > 0 ? Math.min(s.best, place) : place;
    Promise.resolve()
      .then(() => ow.save.set('stats', s))
      .catch(() => {});
    if (place === 1) {
      badge('first-win');
      Promise.resolve()
        .then(() => ow.leaderboards.submit('wins', s.wins))
        .catch(() => {});
    }
  }

  // ---------------------------------------------------------------- events from the room's record
  function syncRecord(g) {
    if (!g) return;
    if (S.seenMid !== g.mid) {
      S.seenMid = g.mid;
      S.seenOut = 0;
      S.seenKos = 0;
    }
    for (let i = S.seenOut; i < g.out.length; i++) {
      const id = g.out[i];
      if (id !== meId) {
        audio.koOther();
        const slot = S.slotOf.get(id);
        if (slot) fx.burst(slot.bx + slot.bw / 2, slot.by + slot.bh / 2, 16, { colors: ['#ff4a5e', '#ffffff', '#586179'], speed: 170, life: 0.7, size: 3, g: 300 });
      }
    }
    S.seenOut = g.out.length;
    const k = g.kos[meId] ?? 0;
    if (k > S.seenKos) {
      fx.callout('KO!', { color: '#ff6b7d', size: 0.9, sub: k - S.seenKos > 1 ? `+${k - S.seenKos}` : '' });
      fx.shake(0.25);
      audio.combo(2);
      S.seenKos = k;
    }
    // the host says I'm out (I was away too long): my board goes with it
    if (S.eng && S.engKind === 'match' && !S.eng.ko && g.out.includes(meId)) {
      S.eng.knockOut('out');
      S.koAt = Sc.time;
      audio.ko();
    }
    // my own knockout never reached the host: say it again
    if (S.eng && S.engKind === 'match' && S.eng.ko && g.phase === 'play' && !g.out.includes(meId) && Sc.time - S.koSentAt > 2) {
      S.koSentAt = Sc.time;
      net.sendKo(S.koBy);
    }
    if (g.phase !== 'play') overSeen(g);
    if (g.phase === 'final' && S.resultsMid !== g.mid) {
      S.resultsMid = g.mid;
      S.results = buildResults(g);
      S.resultsAt = Sc.time;
    }
  }

  // ---------------------------------------------------------------- controls
  function syncControls() {
    const wantOn = S.started && S.eng !== null && (S.engKind === 'practice' || !S.eng.ko) && (S.mode === 'lobby' || S.mode === 'count' || S.mode === 'play');
    const key = wantOn ? 'on' : 'off';
    if (key === S.controls) return;
    S.controls = key;
    try {
      if (wantOn) ow.controls.set({ stick: 'analog', buttons: TOUCH_BUTTONS });
      else ow.controls.set(null);
    } catch {
      // not on the platform
    }
  }

  // ---------------------------------------------------------------- pointer and keys
  function startPlay() {
    if (S.started) return;
    S.started = true;
    audio.unlock();
    audio.click();
    room.hideLobby(false);
    input.clear();
  }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault?.();
    const x = fin(e.clientX);
    const y = fin(e.clientY);
    if (!S.started) {
      startPlay();
      return;
    }
    audio.unlock();
    if (S.mode === 'lobby' && room.isHost) {
      for (const h of S.hit.speed) {
        const r = h.rect;
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
          room.setSetting('speed', h.value);
          audio.click();
          break;
        }
      }
    }
  });
  addEventListener('keydown', (e) => {
    if (!S.started && (e.code === 'Space' || e.code === 'Enter')) {
      e.preventDefault?.();
      startPlay();
    }
  });

  // ---------------------------------------------------------------- draw
  function draw(dt) {
    Sc.time += dt;
    Sc.pulse = Math.pow(1 - clamp(audio.beatPhase(), 0, 1), 3);
    const m = room.match;
    const g = net.G();
    // which screen
    let mode = 'title';
    if (S.started) {
      if (m.phase === 'lobby') mode = 'lobby';
      else if (m.phase === 'starting') mode = 'count';
      else if (g) mode = g.phase === 'final' ? 'final' : g.phase === 'over' ? 'over' : 'play';
      else mode = 'play';
    }
    S.mode = mode;
    Sc.mode = mode;
    syncEngine();
    syncRecord(g);
    // the scene
    let others;
    if (mode === 'title') others = sceneTitle(dt);
    else if (mode === 'lobby') others = sceneLobby(dt);
    else others = sceneMatch(dt);
    // the layout, eased between the lobby's and the match's
    const touch = Boolean(ow.controls && ow.controls.touch);
    const T = computeLayout(Sc.w, Sc.h, mode === 'lobby' ? 'lobby' : 'play', others, touch);
    if (!Sc.L || Sc.reduced) {
      Sc.L = T;
      Sc.busy = false;
    } else {
      const d = Math.abs(Sc.L.c - T.c) + Math.abs(Sc.L.board.x - T.board.x) + Math.abs(Sc.L.board.y - T.board.y);
      if (d < 0.5 && Sc.L.slots.length === T.slots.length) {
        Sc.L = T;
        Sc.busy = false;
      } else {
        Sc.L = blend(Sc.L, T, 1 - Math.exp(-11 * dt));
        Sc.busy = true;
      }
    }
    S.slotOf.clear();
    const ids = Sc.minis;
    for (let i = 0; i < ids.length; i++) if (Sc.L.slots[i] && ids[i]) S.slotOf.set(ids[i].id, Sc.L.slots[i]);
    // main-board animation: the clear and lock marks live on the view; minis don't get them
    fx.update(dt);
    Sc.shake = fx.offset(Sc.time);
    syncControls();
    audio.setLevel(mode === 'play' || mode === 'over' ? 'play' : 'menu');
    audio.setTension(Math.max(Sc.danger, clamp((levelAt(room.matchNow()) - 2) / 8, 0, 0.8)));
    if (Sc.danger > 0.6 && S.eng && !S.eng.ko && S.mode === 'play') audio.danger();
    renderScene(ctx, Sc);
    overlays(mode, g);
  }

  function overlays(mode, g) {
    const sc = Sc;
    if (mode === 'title') {
      S.hit.play = ui.drawTitle(ctx, sc).play;
      S.hit.speed = [];
      return;
    }
    if (mode === 'lobby') {
      const isHost = room.isHost;
      S.hit = { play: null, ...ui.drawLobbyTop(ctx, sc, { speed: speedOf(), options: SPEEDS, host: isHost }) };
      ui.drawYouTag(ctx, sc, Boolean(room.me.ready));
      if (S.results && Sc.time < S.cardUntil) ui.drawResults(ctx, sc, S.results, 99, 100);
      return;
    }
    S.hit.speed = [];
    ui.drawYouTag(ctx, sc);
    const m = room.match;
    if (mode === 'count') {
      const left = (fin(m.startsAt, Date.now()) - ow.now()) / 1000;
      const n = Math.ceil(left);
      if (n !== S.lastCount) {
        if (n > 0 && n <= 3) audio.tick();
        S.lastCount = n;
      }
      ui.drawCountdown(ctx, sc, left);
      return;
    }
    const ms = room.matchNow();
    if (mode === 'play' && !S.wasPlaying) {
      S.wasPlaying = true;
      if (ms < 1500) audio.go();
      S.lastCount = -99;
    }
    if (mode === 'play') {
      if (ms < 800) ui.drawCountdown(ctx, sc, -ms / 1000); // GO
      if (room.isParticipant(meId)) ui.drawYouArrow(ctx, sc, ms / 1000);
      ui.drawBanner(ctx, sc, 'LAST BOARD WINS', ms / 1000 - 0.7);
      if (S.eng && S.eng.ko && S.engKind === 'match' && Sc.time - S.koAt < 2.4 && g) {
        const place = g.out.includes(meId) ? g.roster.length - g.out.indexOf(meId) : g.roster.length - g.out.length;
        ui.drawKoOverlay(ctx, sc, place, Sc.time - S.koAt);
      }
    } else if (mode === 'over' && g) {
      ui.drawWinnerBanner(ctx, sc, nameOf(g.win, g), g.win === meId, Sc.time - S.overAt);
    } else if (mode === 'final' && S.results) {
      ui.drawResults(ctx, sc, S.results, Sc.time - S.resultsAt, 24);
    }
  }

  // ---------------------------------------------------------------- the frame loop
  let lastTs = 0;
  function frame(ts) {
    requestAnimationFrame(frame);
    try {
      const dt = clamp((ts - lastTs) / 1000, 0, 0.1);
      lastTs = ts;
      if (tickable) tickable.tick();
      S.acc += dt * 1000;
      let n = 0;
      while (S.acc >= STEP && n < 6) {
        step(STEP);
        S.acc -= STEP;
        n++;
      }
      if (n === 6) S.acc = 0;
      if (S.mode !== 'play' && S.mode !== 'count') S.wasPlaying = false;
      ctx.setTransform(Sc.pr, 0, 0, Sc.pr, 0, 0);
      draw(dt);
      publish();
    } catch (err) {
      if (S.errors++ < 5) console.error(err);
    }
  }

  // This page's board, for everyone else, about four times a second.
  function publish() {
    const e = S.eng;
    if (!e || !S.started) return;
    const now = performance.now();
    if (now - S.lastPublish < 250) return;
    S.lastPublish = now;
    const snap = e.snapshot();
    snap.m = S.engKind === 'match' ? room.match.id : 'lobby';
    const g = net.G();
    snap.tg = S.engKind === 'match' && S.target ? rosterIndex(g, S.target) : -1;
    room.setPresence(snap);
  }

  net.adopt();
  requestAnimationFrame(frame);
  void offline;
}

if (posterName) {
  runPoster(canvas, posterName).catch((err) => console.error('poster failed', err));
} else {
  boot();
}
