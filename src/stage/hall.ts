import { P } from './palette';
import { PixelCanvas, bayer, seeded } from './pixel';

/** The pixel world. Everything on stage lives in this 384×216 grid. */
export const W = 384;
export const H = 216;
export const RISER_TOP = 112;
export const RISER_FRONT = 128;
export const FLOOR_TOP = 134;
export const LIP_Y = 197;

const ramp = (tones: number[], v: number, x: number, y: number) =>
  tones[Math.max(0, Math.min(tones.length - 1, Math.round(v * (tones.length - 1) + bayer(x, y) - 0.5)))];

/** Back wall, organ, riser and floor. Drawn once. */
export function drawHall(): PixelCanvas {
  const c = new PixelCanvas(W, H);
  const rnd = seeded(7);

  // ---- back wall: warm acoustic wood panels, darker towards the ceiling and the sides
  for (let y = 0; y < RISER_TOP; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x - W / 2) / (W / 2);
      const vy = y / RISER_TOP;
      const light = 0.2 + 0.55 * vy - 0.35 * dx * dx;
      c.set(x, y, ramp(P.wall, 1 - Math.max(0, Math.min(1, light)), x, y));
    }
  }
  // panels
  const panelW = 22;
  for (let px = 2; px < W; px += panelW) {
    c.vline(px, 22, RISER_TOP - 1, P.wall[6]);
    c.vline(px + 1, 22, RISER_TOP - 1, P.wall[2]);
    // inset
    for (let y = 30; y < RISER_TOP - 10; y++) {
      c.set(px + 4, y, P.wall[5]);
      c.set(px + panelW - 4, y, P.wall[1]);
    }
    c.hline(px + 4, px + panelW - 4, 29, P.wall[5]);
    c.hline(px + 4, px + panelW - 4, RISER_TOP - 10, P.wall[1]);
  }
  // gold mouldings
  for (const my of [26, RISER_TOP - 5]) {
    c.hline(0, W - 1, my, P.gold[3]);
    c.hline(0, W - 1, my + 1, P.gold[4]);
    for (let x = 0; x < W; x += 2) c.set(x, my - 1, P.gold[2]);
  }

  // ---- sconces
  for (const sx of [64, W - 64]) {
    const sy = 58;
    c.rect(sx - 1, sy, 3, 8, P.gold[3]);
    c.set(sx, sy, P.gold[1]);
    c.hline(sx - 5, sx + 5, sy + 7, P.gold[3]);
    c.hline(sx - 4, sx + 4, sy + 8, P.gold[4]);
    for (const ox of [-5, 0, 5]) {
      c.rect(sx + ox - 1, sy + 1, 2, 5, P.white[1]);
      c.set(sx + ox, sy - 1, 0xfff2c0);
      c.set(sx + ox, sy, 0xffd77a);
    }
  }

  // ---- organ: gilded arch with silver pipes
  const ax0 = 136,
    ax1 = 248,
    acx = (ax0 + ax1) / 2;
  const archTop = 8;
  const archR = (ax1 - ax0) / 2;
  // dark niche
  for (let y = archTop; y < RISER_TOP - 6; y++) {
    for (let x = ax0; x <= ax1; x++) {
      const dy = y - (archTop + archR * 0.55);
      const inside = y > archTop + archR * 0.55 || ((x - acx) / archR) ** 2 + (dy / (archR * 0.55)) ** 2 <= 1;
      if (inside) c.set(x, y, ramp(P.wall, 0.82 + 0.12 * (1 - y / RISER_TOP), x, y));
    }
  }
  // pipes, tallest in the middle
  const pipeW = 5;
  const n = 19;
  const startX = Math.round(acx - (n * pipeW) / 2);
  const baseY = 86;
  for (let i = 0; i < n; i++) {
    const t = Math.abs(i - (n - 1) / 2) / ((n - 1) / 2);
    const top = Math.round(archTop + 14 + t * t * 34 + (i % 2) * 3);
    const x = startX + i * pipeW;
    for (let y = top; y < baseY; y++) {
      c.set(x, y, P.pipe[2]);
      c.set(x + 1, y, P.pipe[0]);
      c.set(x + 2, y, P.pipe[1]);
      c.set(x + 3, y, P.pipe[3]);
      c.set(x + 4, y, P.pipe[5]);
    }
    // conical top and mouth
    c.hline(x, x + 3, top, P.pipe[1]);
    c.set(x + 1, top - 1, P.pipe[0]);
    c.set(x + 2, top - 1, P.pipe[2]);
    const my = baseY - 9 - (i % 3);
    c.rect(x + 1, my, 2, 2, P.pipe[5]);
    c.set(x + 1, my - 1, P.pipe[4]);
    c.set(x + 2, my - 1, P.pipe[4]);
    // pipe foot taper
    c.set(x, baseY - 2, P.pipe[4]);
    c.set(x + 4, baseY - 2, P.wall[5]);
  }
  // organ case
  for (let y = baseY; y < RISER_TOP - 6; y++) {
    for (let x = ax0 + 6; x <= ax1 - 6; x++) c.set(x, y, ramp(P.wood, 0.45 + (y - baseY) / 60, x, y));
  }
  c.hline(ax0 + 6, ax1 - 6, baseY, P.gold[2]);
  c.hline(ax0 + 6, ax1 - 6, baseY + 1, P.gold[4]);
  for (let x = ax0 + 12; x < ax1 - 8; x += 12) {
    c.rect(x, baseY + 5, 7, 9, P.wood[4]);
    c.hline(x, x + 6, baseY + 5, P.wood[5]);
    c.vline(x + 6, baseY + 5, baseY + 13, P.wood[2]);
  }
  // gilded arch frame
  for (let a = 0; a <= Math.PI; a += 0.004) {
    const x = acx - Math.cos(a) * archR;
    const y = archTop + archR * 0.55 - Math.sin(a) * archR * 0.55;
    c.set(x, y, P.gold[1]);
    c.set(x, y + 1, P.gold[3]);
    c.set(x, y - 1, P.gold[4]);
  }
  for (const fx of [ax0, ax1]) {
    for (let y = Math.round(archTop + archR * 0.55); y < RISER_TOP - 5; y++) {
      c.set(fx - 1, y, P.gold[4]);
      c.set(fx, y, fx === ax0 ? P.gold[1] : P.gold[3]);
      c.set(fx + 1, y, P.gold[3]);
    }
  }
  // keystone ornament
  c.rect(acx - 3, archTop - 2, 7, 5, P.gold[2]);
  c.rect(acx - 2, archTop - 1, 5, 3, P.gold[1]);
  c.set(acx, archTop, P.gold[0]);

  // ---- riser (back row platform)
  for (let y = RISER_TOP; y < RISER_FRONT; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x - W / 2) / (W / 2);
      c.set(x, y, ramp(P.floor, 0.5 + 0.25 * dx * dx + (RISER_FRONT - y) / 50, x, y));
    }
  }
  for (let y = RISER_TOP + 2; y < RISER_FRONT; y += 4) c.hline(0, W - 1, y, P.floor[5]);
  c.hline(0, W - 1, RISER_FRONT, P.gold[3]);
  for (let y = RISER_FRONT + 1; y < FLOOR_TOP; y++) {
    for (let x = 0; x < W; x++) c.set(x, y, ramp(P.wood, 0.7 + (y - RISER_FRONT) / 20, x, y));
  }
  for (let x = 6; x < W; x += 16) c.vline(x, RISER_FRONT + 2, FLOOR_TOP - 1, P.wood[6]);

  // ---- main stage floor: planks in perspective
  let y = FLOOR_TOP;
  let row = 0;
  while (y < LIP_Y) {
    const hRow = Math.max(2, Math.round(2 + (y - FLOOR_TOP) / 13));
    const tone = 0.36 + (row % 2) * 0.06 + rnd() * 0.04;
    for (let j = 0; j < hRow && y + j < LIP_Y; j++) {
      for (let x = 0; x < W; x++) {
        const dx = (x - W / 2) / (W / 2);
        const glow = 0.32 * dx * dx - 0.12 * (1 - (y - FLOOR_TOP) / (LIP_Y - FLOOR_TOP));
        const v = tone + glow + (j === 0 ? 0.08 : 0) - (j === hRow - 1 ? -0.06 : 0);
        c.set(x, y + j, ramp(P.floor, v, x, y + j));
      }
    }
    // seam line
    c.hline(0, W - 1, y + hRow - 1, P.floor[5]);
    // plank ends, staggered
    const seg = 40 + row * 6;
    for (let x = Math.floor(rnd() * seg); x < W; x += seg + Math.floor(rnd() * 20)) {
      c.vline(x, y, y + hRow - 2, P.floor[6]);
      c.vline(x + 1, y, y + hRow - 2, P.floor[2]);
    }
    y += hRow;
    row++;
  }

  // ---- stage lip and orchestra pit
  c.hline(0, W - 1, LIP_Y, P.gold[1]);
  c.hline(0, W - 1, LIP_Y + 1, P.gold[3]);
  for (let yy = LIP_Y + 2; yy < LIP_Y + 8; yy++) {
    for (let x = 0; x < W; x++) c.set(x, yy, ramp(P.wood, 0.72 + (yy - LIP_Y) / 14, x, yy));
  }
  for (let x = 4; x < W; x += 12) {
    c.set(x, LIP_Y + 4, P.gold[3]);
    c.set(x + 1, LIP_Y + 4, P.gold[4]);
  }
  for (let yy = LIP_Y + 8; yy < H; yy++) for (let x = 0; x < W; x++) c.set(x, yy, P.ink);

  return c;
}

const CURTAIN_W = 34;

function curtainTone(x: number, y: number, phase: number, gather: number): number {
  const fold = Math.cos(phase);
  let v = 0.42 - fold * 0.32 * (0.6 + 0.4 * gather);
  v += (y < 30 ? (30 - y) / 90 : 0) + Math.max(0, (y - 170) / 160);
  return ramp(P.velvet, Math.max(0, Math.min(1, v)), x, y);
}

/** Side curtains + valance: drawn in front of the musicians. */
export function drawFrontDrapes(): PixelCanvas {
  const c = new PixelCanvas(W, H);
  const tieY = 120;
  for (let y = 0; y < LIP_Y + 2; y++) {
    // curtain width: gathered at the tie-back, flaring below
    const d = (y - tieY) / (y < tieY ? tieY : LIP_Y - tieY);
    const wy = Math.round(CURTAIN_W - (y < tieY ? 12 * (1 - d * d) : 10 * (1 - Math.min(1, d * 1.6)) * 1) + (y > tieY ? d * 6 : 0));
    for (let i = 0; i < wy; i++) {
      const gather = 1 - Math.abs(d);
      const phase = (i / wy) * Math.PI * 7 + (y < tieY ? 0 : d * 0.6);
      c.set(i, y, curtainTone(i, y, phase, gather));
      c.set(W - 1 - i, y, curtainTone(W - 1 - i, y, phase, gather));
    }
    // inner edge gold trim
    c.set(wy - 1, y, P.gold[3]);
    c.set(W - wy, y, P.gold[3]);
    c.set(wy, y, P.velvet[5]);
    c.set(W - 1 - wy, y, P.velvet[5]);
  }
  // tie-backs with tassels
  for (const side of [0, 1]) {
    const x0 = side ? W - CURTAIN_W + 8 : 6;
    for (let i = 0; i < 22; i++) {
      const xx = x0 + i - (side ? 2 : 0);
      const yy = tieY + Math.round(Math.sin((i / 21) * Math.PI) * 2);
      c.set(xx, yy, P.gold[1]);
      c.set(xx, yy + 1, P.gold[3]);
    }
    const tx = side ? W - CURTAIN_W + 12 : CURTAIN_W - 12;
    c.rect(tx - 1, tieY + 2, 3, 3, P.gold[2]);
    c.set(tx, tieY + 2, P.gold[0]);
    for (let k = 0; k < 9; k++) {
      c.set(tx - 1, tieY + 5 + k, P.gold[3]);
      c.set(tx, tieY + 5 + k, k % 2 ? P.gold[2] : P.gold[1]);
      c.set(tx + 1, tieY + 5 + k, P.gold[4]);
    }
    c.hline(tx - 2, tx + 2, tieY + 14, P.gold[3]);
  }

  // valance with swags and gold fringe
  const swags = 6;
  const sw = W / swags;
  for (let x = 0; x < W; x++) {
    const t = (x % sw) / sw;
    const bottom = Math.round(12 + Math.sin(t * Math.PI) * 7);
    for (let yy = 0; yy <= bottom; yy++) {
      // horizontal folds following the swag curve
      const curve = (yy / Math.max(1, bottom)) * Math.PI * 3;
      const v = 0.35 - Math.cos(curve) * 0.25 + (yy < 3 ? 0.35 : 0) + Math.abs(t - 0.5) * 0.2;
      c.set(x, yy, ramp(P.velvet, Math.max(0, Math.min(1, v)), x, yy));
    }
    c.set(x, bottom + 1, P.gold[2]);
    c.set(x, bottom + 2, P.gold[3]);
    const fringe = 2 + ((x * 7) % 3);
    for (let k = 0; k < fringe; k++) if (x % 2 === 0) c.set(x, bottom + 3 + k, k === fringe - 1 ? P.gold[4] : P.gold[2]);
  }
  for (let s = 0; s <= swags; s++) {
    const x = Math.round(s * sw);
    c.rect(x - 2, 10, 4, 4, P.gold[2]);
    c.set(x - 1, 10, P.gold[0]);
    for (let k = 0; k < 10; k++) {
      c.set(x - 1, 14 + k, P.gold[2]);
      c.set(x, 14 + k, P.gold[3]);
    }
    c.hline(x - 2, x + 1, 24, P.gold[3]);
    c.hline(x - 2, x + 1, 25, P.gold[4]);
  }
  c.hline(0, W - 1, 0, P.gold[3]);
  c.hline(0, W - 1, 1, P.gold[2]);
  return c;
}

/** One half of the closed main curtain (used for the opening). */
export function drawClosedCurtain(side: 'left' | 'right'): PixelCanvas {
  const cw = W / 2 + 6;
  const c = new PixelCanvas(cw, H);
  for (let y = 0; y < H; y++) {
    for (let i = 0; i < cw; i++) {
      const x = side === 'left' ? i : cw - 1 - i;
      const phase = (i / 9) * Math.PI * 2 + Math.sin(y / 40) * 0.2;
      let tone = curtainTone(x, y, phase, 0.8);
      if (y > H - 22 && y < H - 12) {
        // embroidered gold band
        const yy = y - (H - 22);
        tone = yy === 0 || yy === 9 ? P.gold[2] : (i + yy) % 6 === 0 || (i - yy) % 6 === 0 ? P.gold[3] : tone;
      }
      c.set(x, y, tone);
    }
  }
  const edge = side === 'left' ? cw - 1 : 0;
  for (let y = 0; y < H; y++) {
    c.set(edge, y, P.gold[3]);
    c.set(side === 'left' ? edge - 1 : edge + 1, y, P.velvet[4]);
  }
  return c;
}

/** Silhouettes of the audience in the front row. */
export function drawAudience(): PixelCanvas {
  const c = new PixelCanvas(W, H);
  const rnd = seeded(11);
  const rim = 0x5a3036;
  for (let x = -6; x < W + 10; x += 15 + Math.floor(rnd() * 5)) {
    if (Math.abs(x - W / 2) < 16) continue; // leave room for the podium
    const hx = x + Math.floor(rnd() * 3);
    const hy = 203 + Math.floor(rnd() * 4);
    const r = 5 + Math.floor(rnd() * 2);
    // shoulders
    c.ellipse(hx, H + 2, r + 7, 9, 0x0c0709);
    // head (some with hair buns / hats)
    c.ellipse(hx, hy, r - 0.5, r + 0.5, 0x0f090c);
    if (rnd() < 0.25) c.ellipse(hx + 1, hy - r - 1, 2, 2, 0x0f090c);
    // rim light from the stage
    for (let yy = hy - r - 2; yy < hy; yy++) {
      for (let xx = hx - r - 1; xx <= hx + r + 1; xx++) {
        if (c.opaque(xx, yy) && !c.opaque(xx, yy - 1)) c.set(xx, yy, rim);
      }
    }
  }
  return c;
}
