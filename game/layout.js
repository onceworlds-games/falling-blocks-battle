// Where everything goes on the screen. Pure (numbers in, rectangles out) so the tests can check every screen size: your board big
// in the middle, Hold on its left and the next pieces on its right, the other boards as minis on both sides, the top-left corner
// (the platform's buttons) clear, and in the lobby the bottom clear for the platform's Ready bar.

export const TOP_PLAY = 58; // the HUD strip; also keeps the top-left 130 x 56 clear
export const TOP_LOBBY = 66;
export const BOTTOM_PLAY = 10;
export const BOTTOM_LOBBY = 98; // the platform's Ready / Start bar
export const CORNER = 150; // the thumbs' corners on a touch screen

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rect = (x, y, w, h) => ({ x, y, w, h });
const intersects = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * mode: 'play' (also the title), 'lobby'. others: how many mini boards. touch: the platform's on-screen controls are showing, so
 * the minis keep out of the two lower corners. o: { top, bottom } override the strips above and below (store art). Returns { c, top, bottom, board, hold, next, meter, slots: [slot | null] } where a
 * slot is { x, y, w, h, bx, by, bw, bh, mc, lh, side } in the order of the others (null: no room on this screen).
 */
export function computeLayout(w, h, mode, others, touch = false, o = {}) {
  const lobby = mode === 'lobby';
  const top = o.top ?? (lobby ? TOP_LOBBY : TOP_PLAY);
  const bottom = o.bottom ?? (lobby ? BOTTOM_LOBBY : BOTTOM_PLAY);
  const pad = 8;
  const availH = Math.max(60, h - top - bottom);
  const n = Math.max(0, Math.min(11, Math.floor(others)));
  const nL = Math.ceil(n / 2);
  let rows = n === 0 ? 0 : nL <= 4 ? 2 : 3;
  if (touch && n > 0) rows = 3;
  const cols = rows === 0 ? 0 : 2;

  let c = Math.max(5, Math.floor((availH - 14) / 20)); // room for the frame's glow around the board
  let m;
  for (let guard = 0; guard < 80; guard++) {
    m = measure(c, rows, cols);
    if (m.total <= w - 2 * pad || c <= 5) break;
    c--;
  }
  const startX = Math.round((w - m.total) / 2);
  const boardY = Math.round(top + (availH - 20 * c) / 2);
  const boardX = startX + m.leftW + m.gM + m.holdW + m.gH;
  const board = rect(boardX, boardY, 10 * c, 20 * c);
  const hold = rect(boardX - m.gH - m.holdW, boardY, m.holdW, Math.round(3.6 * c));
  const next = rect(boardX + 10 * c + m.gN, boardY, m.nextW, Math.round(15.6 * c));
  const meter = rect(boardX - Math.round(c * 0.55), boardY, Math.max(3, Math.round(c * 0.35)), 20 * c);

  const make = (x, y, side) => ({
    x,
    y,
    w: m.sw,
    h: m.sh,
    bx: x + 3,
    by: y + m.lh + 2,
    bw: 10 * m.mc,
    bh: 20 * m.mc,
    mc: m.mc,
    lh: m.lh,
    side,
  });
  const corners = touch ? [rect(0, h - CORNER, CORNER, CORNER), rect(w - CORNER, h - CORNER, CORNER, CORNER)] : [];
  const left = [];
  const right = [];
  const leftUnder = [];
  const rightUnder = [];
  if (rows > 0) {
    const rightX = startX + m.leftW + m.gM + m.holdW + m.gH + 10 * c + m.gN + m.nextW + m.gM;
    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < rows; row++) {
        const y = boardY + row * m.sh;
        const l = make(startX + (cols - 1 - col) * (m.sw + m.gx), y, 'L');
        const r = make(rightX + col * (m.sw + m.gx), y, 'R');
        // slots under a thumb's corner come last: they are used only when the others run out
        l.under = corners.some((k) => intersects(k, l));
        r.under = corners.some((k) => intersects(k, r));
        (l.under ? leftUnder : left).push(l);
        (r.under ? rightUnder : right).push(r);
      }
    }
    left.push(...leftUnder);
    right.push(...rightUnder);
  }
  const slots = [];
  let li = 0;
  let ri = 0;
  for (let i = 0; i < n; i++) {
    const preferLeft = i % 2 === 0;
    let s = null;
    if (preferLeft) s = li < left.length ? left[li++] : ri < right.length ? right[ri++] : null;
    else s = ri < right.length ? right[ri++] : li < left.length ? left[li++] : null;
    slots.push(s);
  }
  return { c, top, bottom, board, hold, next, meter, slots, availH };
}

function measure(c, rows, cols) {
  const holdW = Math.round(4.3 * c);
  const nextW = Math.round(4.3 * c);
  const gH = Math.max(14, Math.round(c * 0.95)); // never less than the frame's glow
  const gN = Math.max(12, Math.round(c * 0.75));
  const gM = rows > 0 ? Math.round(c * 0.6) : 0;
  const gx = Math.max(4, Math.round(c * 0.3));
  let sh = 0;
  let lh = 0;
  let mc = 0;
  let sw = 0;
  let leftW = 0;
  if (rows > 0) {
    sh = Math.floor((20 * c) / rows);
    lh = clamp(Math.round(c * 0.9), 11, 18);
    mc = Math.min((sh - lh - 6) / 20, c * 0.5);
    mc = Math.max(1, Math.floor(mc * 4) / 4);
    sw = Math.ceil(10 * mc) + 6;
    leftW = cols * sw + (cols - 1) * gx;
  }
  const total = leftW + gM + holdW + gH + 10 * c + gN + nextW + gM + leftW;
  return { holdW, nextW, gH, gN, gM, gx, sh, lh, mc, sw, leftW, total };
}
