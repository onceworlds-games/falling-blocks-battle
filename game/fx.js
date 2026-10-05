// Effects: pooled particles (sparks, shards, debris), expanding rings, attack projectiles, floating numbers, callouts that pop in
// and fade, screen flash, hit-stop and camera shake from a decaying trauma value. All of it scales with quality and goes quiet
// with reduced motion. Browser code but nothing runs at import.

import { TAU, clamp, easeOut, easeOutBack, text } from './gfx.js';

const MAX = 480;

export function createFx() {
  const parts = Array.from({ length: MAX }, () => ({ on: false, x: 0, y: 0, vx: 0, vy: 0, g: 0, life: 0, max: 1, size: 3, color: '#fff', kind: 0, rot: 0, vr: 0 }));
  let cursor = 0;
  const off = { x: 0, y: 0 };

  const fx = {
    q: 1, // 0.4 low, 0.7 medium, 1 high
    reduced: false,
    rand: Math.random,
    trauma: 0,
    flashA: 0,
    flashColor: '#ffffff',
    frozen: 0,
    timeScale: 1,
    callouts: [],
    floats: [],
    rings: [],
    beams: [],
    onBeamHit: null,
    live: 0,

    /** Everything off (a new match, a new scene). */
    clear() {
      for (const p of parts) p.on = false;
      this.callouts.length = 0;
      this.floats.length = 0;
      this.rings.length = 0;
      this.beams.length = 0;
      this.trauma = 0;
      this.flashA = 0;
      this.frozen = 0;
      this.timeScale = 1;
      this.live = 0;
    },

    spawn() {
      for (let i = 0; i < MAX; i++) {
        const p = parts[(cursor + i) % MAX];
        if (!p.on) {
          cursor = (cursor + i + 1) % MAX;
          p.on = true;
          return p;
        }
      }
      return null; // the pool is full: skip this one
    },

    /** n particles from (x, y). o: { colors, speed, angle, spread, life, size, g, kind }. */
    burst(x, y, n, o = {}) {
      const count = Math.round(n * this.q * (this.reduced ? 0.35 : 1));
      const colors = o.colors ?? ['#ffffff'];
      const speed = o.speed ?? 160;
      const angle = o.angle ?? 0;
      const spread = o.spread ?? TAU;
      for (let i = 0; i < count; i++) {
        const p = this.spawn();
        if (!p) return;
        const a = angle + (this.rand() - 0.5) * spread;
        const v = speed * (0.35 + this.rand() * 0.8);
        p.x = x;
        p.y = y;
        p.vx = Math.cos(a) * v;
        p.vy = Math.sin(a) * v;
        p.g = o.g ?? 380;
        p.max = p.life = (o.life ?? 0.7) * (0.6 + this.rand() * 0.7);
        p.size = (o.size ?? 4) * (0.6 + this.rand() * 0.8);
        p.color = colors[Math.floor(this.rand() * colors.length)];
        p.kind = o.kind ?? 0;
        p.rot = this.rand() * TAU;
        p.vr = (this.rand() - 0.5) * 12;
      }
    },

    ring(x, y, r0, r1, color, dur = 0.45, lw = 3) {
      if (this.rings.length > 24) this.rings.shift();
      this.rings.push({ x, y, r0, r1, age: 0, dur, color, lw });
    },

    /** A projectile of garbage from one board to another; onBeamHit(beam) fires on arrival. */
    beam(x0, y0, x1, y1, lines, color, tag = '') {
      if (this.beams.length > 12) this.beams.shift();
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2 - Math.min(160, Math.hypot(x1 - x0, y1 - y0) * 0.35);
      this.beams.push({ x0, y0, x1, y1, cx: mx, cy: my, age: 0, dur: 0.42, lines, color, tag, x: x0, y: y0 });
    },

    /** A floating label (+4) that drifts up and fades. */
    float(str, x, y, color = '#ffffff', size = 18, dur = 0.9) {
      if (this.floats.length > 16) this.floats.shift();
      this.floats.push({ str, x, y, age: 0, dur, color, size });
    },

    /** A big word in the middle of the board: pops in, holds, fades. */
    callout(str, o = {}) {
      if (this.callouts.length >= 3) this.callouts.shift();
      this.callouts.push({ str, sub: o.sub ?? '', color: o.color ?? '#ffffff', size: o.size ?? 1, age: 0, dur: o.dur ?? 1.25 });
    },

    shake(amount) {
      if (this.reduced) return;
      this.trauma = Math.min(1, this.trauma + amount);
    },

    flash(color, a) {
      if (this.reduced) return;
      this.flashColor = color;
      this.flashA = Math.max(this.flashA, a);
    },

    /** Hit-stop: the effects hold still for `ms` (the game itself never stops). */
    freeze(ms) {
      if (this.reduced) return;
      this.frozen = Math.max(this.frozen, Math.min(120, ms) / 1000);
    },

    /** Camera offset in px for this moment (smooth, from trauma squared). */
    offset(time) {
      const s = this.trauma * this.trauma;
      off.x = Math.sin(time * 43) * s * 16;
      off.y = Math.sin(time * 59 + 1.3) * s * 11;
      return off;
    },

    update(rawDt) {
      if (this.frozen > 0) {
        this.frozen -= rawDt;
        return;
      }
      const dt = rawDt * this.timeScale;
      this.trauma = Math.max(0, this.trauma - 1.7 * dt);
      this.flashA = Math.max(0, this.flashA - 3.2 * dt);
      let live = 0;
      for (const p of parts) {
        if (!p.on) continue;
        p.life -= dt;
        if (p.life <= 0) {
          p.on = false;
          continue;
        }
        live++;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += p.g * dt;
        p.rot += p.vr * dt;
      }
      this.live = live;
      for (let i = this.callouts.length - 1; i >= 0; i--) {
        const c = this.callouts[i];
        c.age += dt;
        if (c.age >= c.dur) this.callouts.splice(i, 1);
      }
      for (let i = this.floats.length - 1; i >= 0; i--) {
        const f = this.floats[i];
        f.age += dt;
        if (f.age >= f.dur) this.floats.splice(i, 1);
      }
      for (let i = this.rings.length - 1; i >= 0; i--) {
        const r = this.rings[i];
        r.age += dt;
        if (r.age >= r.dur) this.rings.splice(i, 1);
      }
      for (let i = this.beams.length - 1; i >= 0; i--) {
        const b = this.beams[i];
        b.age += dt;
        const t = clamp(b.age / b.dur, 0, 1);
        const u = 1 - t;
        b.x = u * u * b.x0 + 2 * u * t * b.cx + t * t * b.x1;
        b.y = u * u * b.y0 + 2 * u * t * b.cy + t * t * b.y1;
        if (this.q > 0.5 && !this.reduced) {
          const p = this.spawn();
          if (p) {
            p.x = b.x;
            p.y = b.y;
            p.vx = (this.rand() - 0.5) * 30;
            p.vy = (this.rand() - 0.5) * 30;
            p.g = 0;
            p.max = p.life = 0.3;
            p.size = 3 + b.lines * 0.3;
            p.color = b.color;
            p.kind = 0;
            p.rot = 0;
            p.vr = 0;
          }
        }
        if (b.age >= b.dur) {
          this.beams.splice(i, 1);
          if (this.onBeamHit) this.onBeamHit(b);
        }
      }
    },

    /** Particles, rings, projectiles and floating numbers (screen px; the caller has applied the camera shake). */
    draw(ctx) {
      for (const r of this.rings) {
        const t = clamp(r.age / r.dur, 0, 1);
        const rad = r.r0 + (r.r1 - r.r0) * easeOut(t);
        ctx.globalAlpha = (1 - t) * 0.9;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = Math.max(1, r.lw * (1 - t * 0.6));
        ctx.beginPath();
        ctx.arc(r.x, r.y, Math.max(0.1, rad), 0, TAU);
        ctx.stroke();
      }
      for (const p of parts) {
        if (!p.on) continue;
        const a = clamp(p.life / p.max, 0, 1);
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        if (p.kind === 1) {
          ctx.strokeStyle = p.color;
          ctx.lineWidth = Math.max(1, p.size * 0.5);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.045, p.y - p.vy * 0.045);
          ctx.stroke();
        } else if (p.kind === 2) {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
          ctx.restore();
        } else {
          ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        }
      }
      for (const b of this.beams) {
        const s = 8 + b.lines * 1.6;
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = b.color;
        ctx.fillRect(b.x - s, b.y - s, s * 2, s * 2);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(b.x - s * 0.5, b.y - s * 0.5, s, s);
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 2;
        ctx.strokeRect(b.x - s * 0.5, b.y - s * 0.5, s, s);
      }
      ctx.globalAlpha = 1;
      for (const f of this.floats) {
        const t = clamp(f.age / f.dur, 0, 1);
        text(ctx, f.str, f.x, f.y - t * 34, f.size * (0.8 + 0.2 * easeOutBack(t * 3)), { align: 'center', color: f.color, alpha: 1 - t * t });
      }
    },

    /** The callouts, stacked above (cx, y). `unit` scales the type (the board's cell size). */
    drawCallouts(ctx, cx, y, unit) {
      for (let i = 0; i < this.callouts.length; i++) {
        const c = this.callouts[i];
        const t = clamp(c.age / c.dur, 0, 1);
        const pop = easeOutBack(c.age / 0.2, 2.2);
        const fade = t > 0.72 ? 1 - (t - 0.72) / 0.28 : 1;
        const rank = this.callouts.length - 1 - i; // the newest sits lowest
        const size = Math.max(16, unit * 1.9 * c.size) * pop;
        const yy = y - rank * unit * 2.5 - t * unit * 0.8;
        ctx.save();
        ctx.globalAlpha = clamp(fade, 0, 1);
        text(ctx, c.str, cx, yy, size, { align: 'center', color: c.color, italic: true, weight: 900, outline: 0.2 });
        if (c.sub) text(ctx, c.sub, cx, yy + size * 0.78, Math.max(11, unit * 0.85) * pop, { align: 'center', color: '#e8f4ff', weight: 800 });
        ctx.restore();
      }
    },

    /** Full-screen colour flash (a quad, a knockout). */
    drawFlash(ctx, w, h) {
      if (this.flashA <= 0.01) return;
      ctx.globalAlpha = Math.min(0.6, this.flashA);
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    },
  };
  return fx;
}
