// All the sound, synthesized with Web Audio (no files): punchy effects (a noise burst and a low thump on impacts, whooshes, ticks,
// stingers) and a driving 128 BPM minor-key sequencer (kick, clap, hats, a rolling bass, an arpeggio and a pad). The platform
// applies volume and mute to everything that reaches the context's destination. Safe to import anywhere: nothing happens until
// unlock() is called from a tap, and every call is a no-op without a running context.

const BPM = 128;
const BEAT_S = 60 / BPM;
const STEP_S = BEAT_S / 4; // a sixteenth
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Am F C G Am F G E, one bar each: [bass root, chord notes]
const BARS = [
  [33, [57, 60, 64, 69]],
  [29, [53, 57, 60, 65]],
  [36, [60, 64, 67, 72]],
  [31, [59, 62, 67, 71]],
  [33, [57, 60, 64, 69]],
  [29, [53, 57, 60, 65]],
  [31, [59, 62, 67, 71]],
  [40, [56, 59, 64, 68]],
];
const ARP = [0, 2, 1, 3, 2, 1, 3, 2, 0, 2, 1, 3, 2, 3, 1, 2];
const BASS_ON = [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0];

// how loud each part of the tune is at each level
const LEVELS = {
  off: { master: 0, drums: 0, bass: 0, arp: 0, pad: 0 },
  menu: { master: 0.34, drums: 0.35, bass: 0.7, arp: 0.35, pad: 1 },
  play: { master: 0.62, drums: 1, bass: 1, arp: 0.85, pad: 0.65 },
};

export function createAudio() {
  let ctx = null;
  let sfxGain = null;
  let musicGain = null;
  let noise = null;
  let timer = null;
  let nextTime = 0;
  let step = 0;
  let level = 'menu';
  let applied = '';
  let tension = 0;
  let t0 = 0;
  const last = Object.create(null);

  const live = () => ctx !== null && ctx.state === 'running';
  const can = (name, ms) => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - (last[name] ?? -1e9) < ms) return false;
    last[name] = now;
    return true;
  };

  function tone(type, f0, f1, dur, vol, at = 0, dest = sfxGain, attack = 0.006) {
    if (!live() || !dest) return;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, vol), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  function burst(ftype, f0, f1, dur, vol, at = 0, dest = sfxGain, q = 0.9) {
    if (!live() || !noise || !dest) return;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filt = ctx.createBiquadFilter();
    filt.type = ftype;
    filt.Q.value = q;
    filt.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) filt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, vol), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(dest);
    src.start(t, Math.random() * 0.4, dur + 0.05);
  }

  // ------------------------------------------------------------ the tune
  function playStep(s, t) {
    const L = LEVELS[level] ?? LEVELS.menu;
    const bar = BARS[(s >> 4) % BARS.length];
    const k = s & 15;
    const [root, chord] = bar;
    const at = Math.max(0, t - ctx.currentTime);
    const tens = 0.55 + 0.45 * tension;
    // drums
    if (L.drums > 0) {
      if (k % 4 === 0) {
        tone('sine', 150, 44, 0.2, 0.6 * L.drums, at, musicGain);
        burst('lowpass', 900, 200, 0.05, 0.16 * L.drums, at, musicGain, 0.7);
      }
      if (k === 4 || k === 12) {
        burst('bandpass', 1900, 1500, 0.13, 0.26 * L.drums, at, musicGain, 0.8);
        tone('triangle', 220, 160, 0.08, 0.12 * L.drums, at, musicGain);
      }
      if (k % 2 === 1) burst('highpass', 7500, 7500, 0.035, 0.07 * L.drums * tens, at, musicGain, 0.5);
      if (k === 6 || k === 14) burst('highpass', 6500, 6500, 0.14, 0.06 * L.drums, at, musicGain, 0.5);
      if (k === 10 && (s >> 4) % 2 === 1) tone('sine', 140, 48, 0.14, 0.4 * L.drums, at, musicGain);
    }
    // bass: sixteenths on the root, jumping an octave now and then, ducking under the kick
    if (L.bass > 0 && BASS_ON[k]) {
      const m = root + (k === 3 || k === 11 ? 12 : k === 14 ? 7 : 0);
      tone('sawtooth', hz(m), hz(m), 0.16, 0.19 * L.bass, at + 0.012, musicGain);
      tone('square', hz(m - 12), hz(m - 12), 0.16, 0.12 * L.bass, at + 0.012, musicGain);
    }
    // arpeggio
    if (L.arp > 0 && (level === 'play' || k % 4 === 0)) {
      const idx = ARP[k];
      const m = chord[idx % chord.length] + (idx >= 3 ? 12 : 0);
      tone('square', hz(m), hz(m), 0.12, 0.05 * L.arp * tens, at, musicGain);
      tone('triangle', hz(m + 12), hz(m + 12), 0.1, 0.045 * L.arp * tens, at + 0.003, musicGain);
    }
    // pad, one chord a bar
    if (k === 0 && L.pad > 0) {
      for (const m of chord) {
        tone('sawtooth', hz(m - 12), hz(m - 12), BEAT_S * 4 * 0.98, 0.034 * L.pad, at, musicGain, 0.35);
        tone('sawtooth', hz(m - 12) * 1.006, hz(m - 12) * 1.006, BEAT_S * 4 * 0.98, 0.026 * L.pad, at, musicGain, 0.35);
      }
    }
  }

  function schedule() {
    if (!live()) return;
    if (nextTime < ctx.currentTime - 0.4) nextTime = ctx.currentTime + 0.05;
    while (nextTime < ctx.currentTime + 0.15) {
      playStep(step, nextTime);
      nextTime += STEP_S;
      step = (step + 1) % (16 * BARS.length);
    }
  }

  const api = {
    /** Call from a tap or key: creates the context and starts the tune. True if sound can play. */
    unlock() {
      try {
        if (!ctx) {
          const AC = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
          if (!AC) return false;
          ctx = new AC();
          sfxGain = ctx.createGain();
          sfxGain.gain.value = 0.9;
          sfxGain.connect(ctx.destination);
          musicGain = ctx.createGain();
          musicGain.gain.value = LEVELS[level].master;
          applied = level;
          musicGain.connect(ctx.destination);
          noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
          const d = noise.getChannelData(0);
          for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        }
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        if (!timer) {
          nextTime = ctx.currentTime + 0.1;
          t0 = nextTime;
          step = 0;
          timer = setInterval(schedule, 30);
        }
        return true;
      } catch {
        return false;
      }
    },

    get unlocked() {
      return ctx !== null;
    },

    /** 'menu' (quiet, no drums), 'play' (everything) or 'off'. */
    setLevel(name) {
      const next = LEVELS[name] ? name : 'menu';
      if (next === level && applied === level) return;
      level = next;
      if (ctx && musicGain) {
        musicGain.gain.setTargetAtTime(LEVELS[level].master, ctx.currentTime, 0.4);
        applied = level;
      }
    },

    /** 0..1: how hot things are (a high stack, a fast level): the hats and the arpeggio get louder. */
    setTension(x) {
      tension = Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));
    },

    /** Where in the beat the music is, 0..1 (a clock when sound hasn't started), for the background to pulse with. */
    beatPhase() {
      if (ctx && timer) return (((ctx.currentTime - t0) / BEAT_S) % 1 + 1) % 1;
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      return ((now / 1000 / BEAT_S) % 1 + 1) % 1;
    },

    // ---------------------------------------------------------- the effects
    move() {
      if (!can('move', 28)) return;
      tone('sine', 330, 300, 0.035, 0.07);
    },
    rotate() {
      if (!can('rotate', 28)) return;
      tone('triangle', 560, 820, 0.05, 0.13);
      burst('highpass', 5000, 5000, 0.02, 0.04);
    },
    soft() {
      if (!can('soft', 45)) return;
      tone('sine', 200, 170, 0.03, 0.05);
    },
    hold() {
      if (!can('hold', 60)) return;
      burst('bandpass', 500, 2200, 0.14, 0.2, 0, sfxGain, 1.2);
      tone('triangle', 400, 700, 0.08, 0.08);
    },
    hard(dist = 10) {
      if (!can('hard', 50)) return;
      const p = Math.min(1, 0.35 + dist / 18);
      tone('sine', 190, 48, 0.17, 0.3 + 0.35 * p);
      burst('lowpass', 2200, 300, 0.09, 0.16 + 0.18 * p);
    },
    lock() {
      if (!can('lock', 40)) return;
      tone('sine', 160, 110, 0.06, 0.16);
    },
    clear(lines = 1, combo = 0) {
      const base = [0, 659, 740, 831, 988][Math.min(4, Math.max(1, lines))];
      const notes = [base, base * 1.26, base * 1.5, base * 2].slice(0, Math.min(4, lines + 1));
      notes.forEach((f, i) => tone('triangle', f, f, 0.2, 0.2, i * 0.045));
      burst('bandpass', 1200, 4200, 0.18, 0.16 + lines * 0.03, 0, sfxGain, 1.1);
      if (combo >= 1) tone('sine', 520 * Math.pow(1.0595, Math.min(14, combo * 2)), 520 * Math.pow(1.0595, Math.min(14, combo * 2)) * 1.5, 0.16, 0.16, 0.12);
    },
    quad() {
      [523, 659, 784, 1047].forEach((f, i) => tone('square', f, f, 0.18, 0.14, i * 0.06));
      [523, 659, 784].forEach((f) => tone('triangle', f, f, 0.8, 0.16, 0.26));
      tone('sine', 130, 40, 0.5, 0.55);
      burst('lowpass', 3000, 200, 0.55, 0.4);
    },
    tspin() {
      burst('bandpass', 300, 3600, 0.34, 0.26, 0, sfxGain, 1.3);
      [880, 1175, 1568].forEach((f, i) => tone('sine', f, f, 0.5, 0.15, 0.1 + i * 0.07));
      tone('sawtooth', 120, 360, 0.3, 0.1);
    },
    combo(n = 1) {
      const f = 440 * Math.pow(1.0595, Math.min(24, n * 2));
      tone('sine', f, f * 2, 0.22, 0.2);
      tone('triangle', f * 2, f * 2, 0.3, 0.1, 0.05);
    },
    b2b() {
      tone('square', 988, 988, 0.08, 0.09);
      tone('square', 1319, 1319, 0.14, 0.09, 0.07);
    },
    perfect() {
      [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone('triangle', f, f, 0.35, 0.17, i * 0.07));
      burst('highpass', 3000, 9000, 0.6, 0.2, 0.2, sfxGain, 0.6);
    },
    send(lines = 1) {
      if (!can('send', 70)) return;
      const p = Math.min(1, lines / 8);
      tone('sawtooth', 180, 900 + 700 * p, 0.28, 0.08 + 0.06 * p);
      burst('bandpass', 600, 3200, 0.26, 0.1 + 0.08 * p, 0, sfxGain, 1.4);
    },
    incoming(lines = 1) {
      if (!can('incoming', 120)) return;
      const p = Math.min(1, lines / 8);
      tone('square', 110, 90, 0.2, 0.1 + 0.1 * p);
      tone('square', 104, 84, 0.2, 0.08 + 0.08 * p, 0.12);
    },
    rise(rows = 1) {
      if (!can('rise', 80)) return;
      const p = Math.min(1, rows / 6);
      tone('sine', 100, 38, 0.32, 0.42 + 0.2 * p);
      burst('lowpass', 700, 120, 0.4, 0.34 + 0.2 * p);
    },
    ko() {
      tone('sawtooth', 440, 55, 0.7, 0.2);
      tone('sine', 120, 34, 0.7, 0.5);
      burst('lowpass', 4000, 180, 0.85, 0.5);
    },
    koOther() {
      if (!can('koOther', 120)) return;
      tone('triangle', 640, 320, 0.2, 0.12);
      burst('bandpass', 1500, 400, 0.18, 0.12);
    },
    hit() {
      if (!can('hit', 90)) return;
      tone('sine', 150, 60, 0.14, 0.26);
      burst('lowpass', 1500, 200, 0.1, 0.14);
    },
    danger() {
      if (!can('danger', 450)) return;
      tone('square', 880, 880, 0.07, 0.09);
      tone('square', 660, 660, 0.09, 0.09, 0.1);
    },
    tick() {
      tone('sine', 520, 520, 0.14, 0.4);
    },
    go() {
      tone('sine', 880, 880, 0.42, 0.45);
      tone('sine', 1320, 1320, 0.3, 0.25, 0.04);
      tone('sawtooth', 220, 440, 0.3, 0.12);
    },
    win() {
      [523, 659, 784, 1047].forEach((f, i) => tone('square', f, f, 0.22, 0.16, i * 0.11));
      [523, 659, 784, 1047].forEach((f) => tone('triangle', f, f, 1.1, 0.16, 0.46));
      tone('sine', 130, 50, 0.6, 0.4, 0.46);
    },
    lose() {
      tone('triangle', 330, 196, 0.5, 0.22);
      tone('triangle', 262, 147, 0.6, 0.2, 0.12);
    },
    ready() {
      tone('sine', 784, 1175, 0.16, 0.26);
    },
    click() {
      tone('sine', 660, 660, 0.06, 0.25);
    },
    pop() {
      tone('sine', 500, 920, 0.09, 0.16);
    },
  };
  return api;
}
