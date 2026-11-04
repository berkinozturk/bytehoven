import { FLOOR_TOP, H, LIP_Y, RISER_TOP, W } from './hall';
import { P } from './palette';
import { PixelCanvas, bayer, mix, seeded } from './pixel';

/**
 * The lo-fi room: a small flat at night. A big rainy window over the city, a low
 * bookshelf along the back wall, a worn wooden floor with a round rug, friends
 * on floor cushions in front. Same grid as the hall.
 */

const WALL = [0x6a5a8a, 0x574a76, 0x463c62, 0x372f4f, 0x29233d, 0x1c182b, 0x12101c];
const SKY = [0x2a2350, 0x3e2d63, 0x5c3a74, 0x8a4c7c, 0xc0687c];
export const LAMP = 0xffc27a;
export const WINDOW_GLOW = 0x9a8cff;

/** The window, in canvas pixels. */
export const WIN = { x0: 122, x1: 262, y0: 12, y1: 90 };

const ramp = (tones: number[], v: number, x: number, y: number) =>
  tones[Math.max(0, Math.min(tones.length - 1, Math.round(v * (tones.length - 1) + bayer(x, y) - 0.5)))];
const clamp = (v: number) => Math.max(0, Math.min(1, v));

export function drawRoom(): PixelCanvas {
  const c = new PixelCanvas(W, H);
  const rnd = seeded(41);

  // ---- the wall: dusky plaster, lit from the window, darker at the sides
  for (let y = 0; y < RISER_TOP; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x - W / 2) / (W / 2);
      c.set(x, y, ramp(WALL, clamp(0.35 + 0.5 * dx * dx + (y < 8 ? 0.15 : 0) - 0.1 * (y / RISER_TOP)), x, y));
    }
  }

  // ---- the window: night sky, the city, rain on the glass
  const { x0, x1, y0, y1 } = WIN;
  for (let y = y0; y < y1; y++) {
    const t = (y - y0) / (y1 - y0);
    for (let x = x0; x < x1; x++) c.set(x, y, ramp(SKY, t * 0.95, x, y));
  }
  // stars and the moon
  for (let i = 0; i < 26; i++) c.set(x0 + 2 + Math.floor(rnd() * (x1 - x0 - 4)), y0 + 2 + Math.floor(rnd() * 26), rnd() < 0.3 ? 0xffffff : 0xc8c0f0);
  c.ellipse(x1 - 30, y0 + 15, 6, 6, 0xfff2d0);
  c.ellipse(x1 - 27, y0 + 13, 5, 5, SKY[0]);
  // the skyline: two rows of blocks, the far one paler, lit windows in both
  const skyline = (base: number, hMin: number, hMax: number, tone: number, lit: number, chance: number) => {
    let x = x0;
    while (x < x1) {
      const w = 7 + Math.floor(rnd() * 12);
      const h = hMin + Math.floor(rnd() * (hMax - hMin));
      for (let yy = base - h; yy < y1; yy++) for (let xx = x; xx < Math.min(x1, x + w); xx++) c.set(xx, yy, tone);
      for (let yy = base - h + 2; yy < y1 - 1; yy += 3) for (let xx = x + 1; xx < Math.min(x1 - 1, x + w - 1); xx += 2) if (rnd() < chance) c.set(xx, yy, lit);
      if (rnd() < 0.25) c.vline(x + (w >> 1), base - h - 4, base - h - 1, tone); // an antenna
      x += w + (rnd() < 0.3 ? 2 : 0);
    }
  };
  skyline(y1 - 10, 18, 34, 0x3a2c58, 0xb08ad0, 0.18);
  skyline(y1, 10, 26, 0x1e1734, 0xffcf7a, 0.22);
  // rain: short slanted streaks, and a few drops on the glass
  for (let i = 0; i < 70; i++) {
    const rx = x0 + Math.floor(rnd() * (x1 - x0)),
      ry = y0 + Math.floor(rnd() * (y1 - y0 - 4));
    for (let k = 0; k < 3; k++) c.blend(rx - k, ry + k * 2, 0xd8e0ff, 0.35);
  }
  for (let i = 0; i < 16; i++) c.blend(x0 + 2 + Math.floor(rnd() * (x1 - x0 - 4)), y0 + 4 + Math.floor(rnd() * (y1 - y0 - 8)), 0xffffff, 0.55);
  // the frame, its cross bars and the sill
  const frame = P.wood[3];
  c.rect(x0 - 4, y0 - 4, x1 - x0 + 8, 4, frame);
  c.rect(x0 - 4, y0, 4, y1 - y0, frame);
  c.rect(x1, y0, 4, y1 - y0, frame);
  c.hline(x0 - 4, x1 + 3, y0 - 4, P.wood[2]);
  c.vline((x0 + x1) >> 1, y0, y1 - 1, frame);
  c.vline(((x0 + x1) >> 1) + 1, y0, y1 - 1, P.wood[4]);
  c.hline(x0, x1 - 1, (y0 + y1) >> 1, frame);
  c.rect(x0 - 8, y1, x1 - x0 + 16, 3, P.wood[2]);
  c.hline(x0 - 8, x1 + 7, y1, P.wood[1]);
  c.hline(x0 - 8, x1 + 7, y1 + 3, P.wood[5]);

  // ---- a cat asleep on the sill, and a mug
  const kx = x0 + 18,
    ky = y1 - 1;
  c.ellipse(kx, ky - 3, 7, 3.5, 0x2a2232);
  c.ellipse(kx - 6, ky - 5, 3, 3, 0x2a2232);
  c.set(kx - 8, ky - 8, 0x2a2232);
  c.set(kx - 5, ky - 8, 0x2a2232);
  c.hline(kx + 4, kx + 9, ky, 0x2a2232);
  for (let x = kx - 9; x <= kx + 7; x++) if (c.opaque(x, ky - 7) && !c.opaque(x, ky - 8)) c.set(x, ky - 7, 0x6a5a8a);
  c.rect(x1 - 24, y1 - 5, 4, 5, 0xe0d0c0);
  c.vline(x1 - 20, y1 - 4, y1 - 2, 0xe0d0c0);
  c.blend(x1 - 23, y1 - 8, 0xffffff, 0.3);
  c.blend(x1 - 22, y1 - 10, 0xffffff, 0.2);

  // ---- picture frames and a record on the wall
  const framed = (fx: number, fy: number, w: number, h: number, inner: number) => {
    c.rect(fx, fy, w, h, P.wood[4]);
    c.rect(fx + 2, fy + 2, w - 4, h - 4, inner);
    c.hline(fx, fx + w - 1, fy, P.wood[2]);
  };
  framed(40, 30, 22, 28, 0xd88a6a);
  c.ellipse(51, 46, 6, 6, 0xf2c070);
  framed(70, 40, 16, 16, 0x5a8a9a);
  for (const rx of [W - 78]) {
    c.rect(rx - 13, 26, 26, 26, P.wood[4]);
    c.ellipse(rx, 39, 11, 11, 0x141018);
    c.ellipse(rx, 39, 4, 4, 0xe86a6a);
    c.set(rx, 39, 0x141018);
    for (let a = 0.6; a < 1.4; a += 0.08) c.set(Math.round(rx + Math.cos(a) * 8), Math.round(39 - Math.sin(a) * 8), 0x3a3048);
  }
  framed(W - 52, 46, 18, 22, 0x8a6aa8);

  // ---- a low bookshelf along the back wall
  for (let y = RISER_TOP; y < FLOOR_TOP; y++) for (let x = 0; x < W; x++) c.set(x, y, ramp(P.wood, clamp(0.68 + (y - RISER_TOP) / 60), x, y));
  c.hline(0, W - 1, RISER_TOP, P.wood[2]);
  const SPINES = [0xc0604a, 0x4a7a8a, 0xd8b060, 0x6a5a9a, 0x8a9a5a, 0xe0d0b0, 0x9a4a5a];
  for (let x = 2; x < W - 2; ) {
    const w = 2 + Math.floor(rnd() * 3);
    const h = 9 + Math.floor(rnd() * 6);
    if (rnd() < 0.12) {
      x += 6; // a gap on the shelf
      continue;
    }
    const col = SPINES[Math.floor(rnd() * SPINES.length)];
    c.rect(x, FLOOR_TOP - 2 - h, w, h, col);
    c.vline(x, FLOOR_TOP - 2 - h, FLOOR_TOP - 3, mix(col, 0x000000, 0.35));
    x += w;
  }
  c.hline(0, W - 1, FLOOR_TOP - 2, P.wood[4]);
  c.hline(0, W - 1, FLOOR_TOP - 1, P.wood[5]);

  // ---- the floor: worn planks, a round rug in the middle
  let y = FLOOR_TOP;
  let row = 0;
  while (y < LIP_Y) {
    const hRow = Math.max(2, Math.round(2 + (y - FLOOR_TOP) / 13));
    const tone = 0.5 + (row % 2) * 0.05 + rnd() * 0.04;
    for (let j = 0; j < hRow && y + j < LIP_Y; j++) {
      for (let x = 0; x < W; x++) {
        const dx = (x - W / 2) / (W / 2);
        c.set(x, y + j, ramp(P.floor, clamp(tone + 0.35 * dx * dx), x, y + j));
      }
    }
    c.hline(0, W - 1, y + hRow - 1, P.floor[6]);
    const seg = 30 + row * 5;
    for (let x = Math.floor(rnd() * seg); x < W; x += seg + Math.floor(rnd() * 16)) c.vline(x, y, y + hRow - 2, P.floor[6]);
    y += hRow;
    row++;
  }
  const RUG = [0xc87a6a, 0xa85a5a, 0x7a3e4a];
  const ry0 = 168;
  for (let yy = FLOOR_TOP + 6; yy < LIP_Y; yy++) {
    for (let x = 40; x < W - 40; x++) {
      const d = ((x - W / 2) / 150) ** 2 + ((yy - ry0) / 30) ** 2;
      if (d > 1) continue;
      const band = d > 0.86 ? 2 : d > 0.55 && d < 0.62 ? 0 : 1;
      c.set(x, yy, RUG[band]);
    }
  }

  // ---- the front edge, and the dark beyond
  c.hline(0, W - 1, LIP_Y, P.wood[3]);
  for (let yy = LIP_Y + 1; yy < H; yy++) for (let x = 0; x < W; x++) c.set(x, yy, yy < LIP_Y + 6 ? P.floor[6] : P.ink);
  return c;
}

/** In front of the band: shadowed wall edges, a floor lamp and hanging plants. */
export function drawRoomFront(): PixelCanvas {
  const c = new PixelCanvas(W, H);
  // dark wall corners
  for (let y = 0; y < LIP_Y + 2; y++) {
    for (let i = 0; i < 14; i++) {
      const v = 0.85 + i / 120;
      c.set(i, y, ramp(WALL, v, i, y));
      c.set(W - 1 - i, y, ramp(WALL, v, W - 1 - i, y));
    }
    c.set(14, y, WALL[4]);
    c.set(W - 15, y, WALL[4]);
  }
  // hanging plants: a pot on a cord, leaves trailing down
  for (const [px, len] of [
    [30, 34],
    [W - 32, 26],
  ] as Array<[number, number]>) {
    c.vline(px, 0, 8, 0x2a2232);
    c.rect(px - 4, 9, 9, 5, 0xb8643a);
    c.hline(px - 5, px + 5, 9, 0xd88050);
    for (const side of [-1, 1]) {
      for (let k = 0; k < len; k++) {
        const lx = px + side * (3 + Math.round(Math.sin(k / 4) * 2 + k / 10));
        const ly = 13 + k;
        if (k % 3 === 0) {
          c.set(lx, ly, 0x5a9a4a);
          c.set(lx + side, ly, 0x3a7a3a);
        } else c.set(lx, ly, 0x2e5a30);
      }
    }
  }
  // a floor lamp at the right edge, its shade glowing
  const lx = W - 24;
  c.vline(lx, 70, LIP_Y - 2, 0x2a2232);
  c.rect(lx - 5, LIP_Y - 3, 11, 2, 0x2a2232);
  c.poly(
    [
      [lx - 5, 70],
      [lx + 5, 70],
      [lx + 8, 82],
      [lx - 8, 82],
    ],
    0xf0b060,
  );
  c.hline(lx - 4, lx + 4, 70, 0xffe0a0);
  c.hline(lx - 8, lx + 8, 82, 0xc07a3a);
  return c;
}

/** Friends on floor cushions, seen from behind, some with headphones. */
export function drawRoomAudience(): PixelCanvas {
  const c = new PixelCanvas(W, H);
  const rnd = seeded(53);
  const sil = 0x120e18;
  const rim = 0x6a5a8a;
  for (const cx of CUSHIONS) {
    // the cushion
    c.ellipse(cx, 211, 13, 4, 0x3a2a40);
    c.hline(cx - 11, cx + 11, 208, 0x5a4060);
    if (rnd() < 0.2) continue; // an empty cushion
    const hx = cx + Math.floor(rnd() * 3) - 1;
    const hy = 198 + Math.floor(rnd() * 3);
    c.ellipse(hx, 210, 9, 7, sil);
    c.ellipse(hx, hy, 4.5, 5.5, sil);
    if (rnd() < 0.5) {
      // headphones
      for (let a = Math.PI; a <= Math.PI * 2; a += 0.12) c.set(Math.round(hx + Math.cos(a) * 6), Math.round(hy + Math.sin(a) * 6.5), 0x2a2238);
      c.rect(hx - 7, hy - 1, 2, 4, 0xe86a6a);
      c.rect(hx + 6, hy - 1, 2, 4, 0xe86a6a);
    }
    for (let yy = hy - 7; yy < hy; yy++) for (let xx = hx - 8; xx <= hx + 8; xx++) if (c.opaque(xx, yy) && !c.opaque(xx, yy - 1)) c.set(xx, yy, rim);
  }
  return c;
}

/** Where the cushions are. */
export const CUSHIONS = [44, 108, 276, 340];
