// Drawing helpers: colours, outlined text, glossy bevelled blocks (cached as small sprites), rounded rectangles. Browser code, but
// nothing runs at import and every helper copes with a canvas that has no offscreen support.

export const TAU = Math.PI * 2;
export const FONT = '"Exo 2", "Segoe UI", system-ui, sans-serif';

/** Cell colours by piece type: I cyan, O yellow, T purple, S green, Z red, J blue, L orange, then garbage grey. */
export const PIECE_COLORS = [null, '#1fd7f2', '#ffd23f', '#b25cff', '#37d983', '#ff4a5c', '#3f7dff', '#ff9a2b', '#586179'];
export const INK = '#030814'; // outlines and dark panels
export const ACCENT = '#46e0ff';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const easeOutBack = (t, s = 1.7) => {
  const x = clamp(t, 0, 1) - 1;
  return 1 + (s + 1) * x * x * x + s * x * x;
};

function parse(hex) {
  const h = String(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h.slice(0, 6), 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [255, 255, 255];
}

/** `hex` mixed toward white (amount > 0) or black (amount < 0). */
export function shade(hex, amount) {
  const [r, g, b] = parse(hex);
  const t = amount < 0 ? 0 : 255;
  const k = Math.abs(amount);
  const f = (v) => Math.round(v + (t - v) * k);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

export function rgba(hex, a) {
  const [r, g, b] = parse(hex);
  return `rgba(${r},${g},${b},${clamp(a, 0, 1)})`;
}

/** A rounded rectangle path (r is capped to half the shorter side). */
export function rr(ctx, x, y, w, h, r) {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.lineTo(x + w - k, y);
  ctx.arcTo(x + w, y, x + w, y + k, k);
  ctx.lineTo(x + w, y + h - k);
  ctx.arcTo(x + w, y + h, x + w - k, y + h, k);
  ctx.lineTo(x + k, y + h);
  ctx.arcTo(x, y + h, x, y + h - k, k);
  ctx.lineTo(x, y + k);
  ctx.arcTo(x, y, x + k, y, k);
  ctx.closePath();
}

export function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, r), 0, TAU);
}

/**
 * White text with a dark outline. o: { align, base, color, weight, italic, outline (0 for none), alpha, maxWidth }.
 * Returns the width drawn.
 */
export function text(ctx, str, x, y, size, o = {}) {
  const s = String(str);
  ctx.font = `${o.italic ? 'italic ' : ''}${o.weight ?? 800} ${Math.max(1, size)}px ${FONT}`;
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = o.base ?? 'middle';
  const prev = ctx.globalAlpha;
  if (o.alpha !== undefined) ctx.globalAlpha = prev * o.alpha;
  ctx.lineJoin = 'round';
  if (o.outline !== 0) {
    ctx.lineWidth = Math.max(2, size * (o.outline ?? 0.16));
    ctx.strokeStyle = o.outlineColor ?? 'rgba(2,6,20,0.9)';
    ctx.strokeText(s, x, y);
  }
  ctx.fillStyle = o.color ?? '#fff';
  ctx.fillText(s, x, y);
  ctx.globalAlpha = prev;
  return s.length * size * 0.6;
}

/** Shortens `str` with an ellipsis so it fits `maxW` px at the context's current font. */
export function fit(ctx, str, maxW) {
  let s = String(str);
  if (maxW <= 0) return '';
  if (ctx.measureText(s).width <= maxW) return s;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

// ---------------------------------------------------------------- blocks
/** One glossy bevelled block at (x, y), s px wide: light top-left edge, dark bottom-right edge, a soft gloss on top. */
export function paintBlock(ctx, x, y, s, type) {
  const base = PIECE_COLORS[type] ?? PIECE_COLORS[8];
  const b = Math.max(1, Math.round(s * 0.11));
  if (type === 8) {
    ctx.fillStyle = shade(base, -0.38);
    ctx.fillRect(x, y, s, s);
    ctx.fillStyle = base;
    ctx.fillRect(x + b, y + b, s - 2 * b, s - 2 * b);
    ctx.fillStyle = shade(base, 0.22);
    ctx.fillRect(x + b, y + b, s - 2 * b, Math.max(1, b));
    ctx.strokeStyle = 'rgba(8,12,26,0.5)';
    ctx.lineWidth = Math.max(1, s * 0.07);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.28, y + s * 0.28);
    ctx.lineTo(x + s * 0.72, y + s * 0.72);
    ctx.moveTo(x + s * 0.72, y + s * 0.28);
    ctx.lineTo(x + s * 0.28, y + s * 0.72);
    ctx.stroke();
    return;
  }
  ctx.fillStyle = shade(base, -0.3);
  ctx.fillRect(x, y, s, s);
  ctx.fillStyle = base;
  ctx.fillRect(x + b, y + b, s - 2 * b, s - 2 * b);
  // light edge, top and left
  ctx.fillStyle = shade(base, 0.55);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + s, y);
  ctx.lineTo(x + s - b, y + b);
  ctx.lineTo(x + b, y + b);
  ctx.lineTo(x + b, y + s - b);
  ctx.lineTo(x, y + s);
  ctx.closePath();
  ctx.fill();
  // dark edge, bottom and right
  ctx.fillStyle = shade(base, -0.5);
  ctx.beginPath();
  ctx.moveTo(x + s, y + s);
  ctx.lineTo(x, y + s);
  ctx.lineTo(x + b, y + s - b);
  ctx.lineTo(x + s - b, y + s - b);
  ctx.lineTo(x + s - b, y + b);
  ctx.lineTo(x + s, y);
  ctx.closePath();
  ctx.fill();
  // gloss
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.fillRect(x + b, y + b, s - 2 * b, Math.max(1, (s - 2 * b) * 0.42));
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(x + b * 1.6, y + b * 1.6, Math.max(1, s * 0.16), Math.max(1, s * 0.16));
}

const sprites = new Map();
let spritesOk = true;

function sprite(type, dev) {
  if (!spritesOk) return null;
  const key = type * 4096 + dev;
  let c = sprites.get(key);
  if (c) return c;
  try {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      spritesOk = false;
      return null;
    }
    c = document.createElement('canvas');
    c.width = dev;
    c.height = dev;
    const g = c.getContext('2d');
    if (!g) {
      spritesOk = false;
      return null;
    }
    paintBlock(g, 0, 0, dev, type);
    if (sprites.size > 160) sprites.clear();
    sprites.set(key, c);
    return c;
  } catch {
    spritesOk = false;
    return null;
  }
}

/**
 * Draws a block of type 1-8 at (x, y), s css px wide, on a context scaled by `pr`. Uses a cached sprite at the device resolution
 * unless `direct` (while sizes are changing every frame, painting straight is cheaper than making sprites).
 */
export function drawBlock(ctx, x, y, s, type, pr = 1, direct = false) {
  if (!direct) {
    const dev = Math.max(2, Math.round(s * pr));
    const sp = sprite(type, dev);
    if (sp) {
      ctx.drawImage(sp, x, y, s, s);
      return;
    }
  }
  paintBlock(ctx, x, y, s, type);
}

/** Drops cached sprites (the pixel ratio changed). */
export function resetSprites() {
  sprites.clear();
  spritesOk = true;
}
