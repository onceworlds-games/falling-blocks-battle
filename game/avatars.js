// Heads for name tags: the player's platform avatar once it has loaded, else a flat disc in their colour with their initial
// (always for bots). Images load once per id and are cached; a failed or missing avatar just keeps the disc.

import { FONT, circle, shade } from './gfx.js';

const cache = new Map(); // id -> { img, ok }
let lookup = null;

/** `getUrl(id)` resolves with an avatar URL or null (ow.player.avatarUrl(id, 'head')). Never call it for bots. */
export function initAvatars(getUrl) {
  lookup = typeof getUrl === 'function' ? getUrl : null;
}

/** The loaded avatar image for a person, or null (and the load is started the first time). */
export function headImage(id) {
  let e = cache.get(id);
  if (!e) {
    e = { img: null, ok: false };
    cache.set(id, e);
    if (lookup && typeof Image !== 'undefined') {
      Promise.resolve()
        .then(() => lookup(id))
        .then((url) => {
          if (!url || typeof url !== 'string') return;
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            e.ok = true;
          };
          img.onerror = () => {
            e.ok = false;
          };
          e.img = img;
          img.src = url;
        })
        .catch(() => {});
    }
  }
  return e.ok ? e.img : null;
}

/** A head centred on (x, y) with radius r: the avatar in a round window, or a disc in `color` with the name's first letter. */
export function drawHead(ctx, id, name, color, x, y, r, bot = false) {
  const img = bot ? null : headImage(id);
  if (img) {
    ctx.save();
    circle(ctx, x, y, r);
    ctx.fillStyle = '#16213f';
    ctx.fill();
    ctx.clip();
    try {
      ctx.drawImage(img, x - r * 1.1, y - r * 1.1, r * 2.2, r * 2.2);
    } catch {
      // a broken image never stops the frame
    }
    ctx.restore();
  } else {
    circle(ctx, x, y, r);
    ctx.fillStyle = shade(color, -0.25);
    ctx.fill();
    const initial = String(name ?? '?').trim().charAt(0).toUpperCase() || '?';
    ctx.font = `800 ${Math.max(7, r * 1.2)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(initial, x, y + r * 0.06);
  }
  circle(ctx, x, y, r);
  ctx.lineWidth = Math.max(1, r * 0.16);
  ctx.strokeStyle = color;
  ctx.stroke();
}
