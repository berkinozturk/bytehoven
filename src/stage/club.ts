import { FLOOR_TOP, H, LIP_Y, RISER_FRONT, RISER_TOP, W } from './hall';
import { P } from './palette';
import { PixelCanvas, bayer, seeded } from './pixel';

/** The jazz club: brick, a neon sign, a dark wood stage, candle-lit tables. Same grid as the hall. */

const BRICK = [0xa8553c, 0x8a4430, 0x6c3426, 0x52281e, 0x3a1c16, 0x26120f, 0x170b0a];
const MORTAR = 0x1c100e;
export const NEON = 0xff5aa8;
export const NEON_BLUE = 0x6ad8ff;

const ramp = (tones: number[], v: number, x: number, y: number) =>
  tones[Math.max(0, Math.min(tones.length - 1, Math.round(v * (tones.length - 1) + bayer(x, y) - 0.5)))];
const clamp = (v: number) => Math.max(0, Math.min(1, v));

/** 5×7 letters for the sign. */
const FONT: Record<string, string[]> = {
  B: ['1111.', '1...1', '1...1', '1111.', '1...1', '1...1', '1111.'],
  Y: ['1...1', '1...1', '.1.1.', '..1..', '..1..', '..1..', '..1..'],
  T: ['11111', '..1..', '..1..', '..1..', '..1..', '..1..', '..1..'],
  E: ['11111', '1....', '1....', '1111.', '1....', '1....', '11111'],
  H: ['1...1', '1...1', '1...1', '11111', '1...1', '1...1', '1...1'],
  O: ['.111.', '1...1', '1...1', '1...1', '1...1', '1...1', '.111.'],
  V: ['1...1', '1...1', '1...1', '1...1', '.1.1.', '.1.1.', '..1..'],
  N: ['1...1', '11..1', '1.1.1', '1.1.1', '1..11', '1...1', '1...1'],
};

/** Neon letters: a bright core with a softer halo around each stroke. */
function neonText(c: PixelCanvas, text: string, x0: number, y0: number, scale: number, color: number) {
  const core = 0xfff0f8;
  const lit = new Set<string>();
  [...text].forEach((ch, i) => {
    const g = FONT[ch];
    if (!g) return;
    g.forEach((row, ry) =>
      [...row].forEach((on, rx) => {
        if (on !== '1') return;
        for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) lit.add(`${x0 + (i * 6 + rx) * scale + dx},${y0 + ry * scale + dy}`);
      }),
    );
  });
  for (const key of lit) {
    const [x, y] = key.split(',').map(Number);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) if (!lit.has(`${x + dx},${y + dy}`)) c.blend(x + dx, y + dy, color, 0.45);
  }
  for (const key of lit) {
    const [x, y] = key.split(',').map(Number);
    c.set(x, y, (x + y) % 3 === 0 ? core : color);
  }
}

export function drawClub(): PixelCanvas {
  const c = new PixelCanvas(W, H);
  const rnd = seeded(23);

  // ---- brick wall, lit warmly from the stage, darker up high and at the sides
  const bh = 6,
    bw = 14;
  for (let y = 0; y < RISER_TOP; y++) {
    const row = Math.floor(y / bh);
    const off = row % 2 ? bw / 2 : 0;
    for (let x = 0; x < W; x++) {
      const dx = (x - W / 2) / (W / 2);
      const light = 0.15 + 0.55 * (y / RISER_TOP) - 0.4 * dx * dx;
      const col = Math.floor((x + off) / bw);
      const seam = y % bh === 0 || (x + off) % bw === 0;
      if (seam) c.set(x, y, MORTAR);
      else {
        const vary = ((col * 7 + row * 13) % 5) / 25;
        c.set(x, y, ramp(BRICK, clamp(1 - light + vary), x, y));
      }
    }
  }
  // a few chipped bricks
  for (let i = 0; i < 40; i++) c.set(Math.floor(rnd() * W), Math.floor(rnd() * RISER_TOP), BRICK[5]);

  // ---- the neon sign, with a fermata above it
  const sx = Math.round(W / 2 - (9 * 6 * 2) / 2);
  neonText(c, 'BYTEHOVEN', sx, 26, 2, NEON);
  for (let a = Math.PI; a <= Math.PI * 2; a += 0.04) {
    c.set(Math.round(W / 2 + Math.cos(a) * 9), Math.round(20 + Math.sin(a) * 6), NEON_BLUE);
  }
  c.rect(W / 2 - 1, 17, 2, 2, NEON_BLUE);
  // its mounting rails
  c.hline(sx - 4, sx + 9 * 12 + 2, 44, 0x2a2220);

  // ---- wall lamps: bare bulbs on brass arms
  for (const lx of [70, W - 70]) {
    c.hline(lx - 4, lx, 58, B(2));
    c.vline(lx - 4, 54, 62, B(3));
    c.rect(lx - 1, 59, 3, 3, 0xfff0b0);
    c.set(lx, 58, 0xffe08a);
  }

  // ---- riser: dark polished wood with a brass edge
  for (let y = RISER_TOP; y < RISER_FRONT; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x - W / 2) / (W / 2);
      c.set(x, y, ramp(P.floor, clamp(0.72 + 0.2 * dx * dx + (RISER_FRONT - y) / 70), x, y));
    }
  }
  for (let y = RISER_TOP + 2; y < RISER_FRONT; y += 4) c.hline(0, W - 1, y, P.floor[6]);
  c.hline(0, W - 1, RISER_FRONT, B(2));
  for (let y = RISER_FRONT + 1; y < FLOOR_TOP; y++) for (let x = 0; x < W; x++) c.set(x, y, ramp(P.wood, clamp(0.82 + (y - RISER_FRONT) / 30), x, y));

  // ---- stage floor: dark planks, a warm pool of light in the middle
  let y = FLOOR_TOP;
  let row = 0;
  while (y < LIP_Y) {
    const hRow = Math.max(2, Math.round(2 + (y - FLOOR_TOP) / 13));
    const tone = 0.6 + (row % 2) * 0.05 + rnd() * 0.04;
    for (let j = 0; j < hRow && y + j < LIP_Y; j++) {
      for (let x = 0; x < W; x++) {
        const dx = (x - W / 2) / (W / 2);
        c.set(x, y + j, ramp(P.floor, clamp(tone + 0.3 * dx * dx + (j === 0 ? 0.06 : 0)), x, y + j));
      }
    }
    c.hline(0, W - 1, y + hRow - 1, P.floor[6]);
    const seg = 34 + row * 5;
    for (let x = Math.floor(rnd() * seg); x < W; x += seg + Math.floor(rnd() * 18)) c.vline(x, y, y + hRow - 2, P.floor[6]);
    y += hRow;
    row++;
  }

  // ---- brass rail at the stage lip, the dark room beyond
  c.hline(0, W - 1, LIP_Y, B(1));
  c.hline(0, W - 1, LIP_Y + 1, B(3));
  for (let yy = LIP_Y + 2; yy < LIP_Y + 8; yy++) for (let x = 0; x < W; x++) c.set(x, yy, ramp(P.wood, clamp(0.85 + (yy - LIP_Y) / 20), x, yy));
  for (let yy = LIP_Y + 8; yy < H; yy++) for (let x = 0; x < W; x++) c.set(x, yy, P.ink);
  return c;
}

/** Brick pillars at the sides and a string of bulbs across the top, in front of the band. */
export function drawClubDrapes(): PixelCanvas {
  const c = new PixelCanvas(W, H);
  const pw = 20;
  for (let yy = 0; yy < LIP_Y + 2; yy++) {
    for (let i = 0; i < pw; i++) {
      for (const x of [i, W - 1 - i]) {
        const row = Math.floor(yy / 6);
        const seam = yy % 6 === 0 || (x + (row % 2 ? 4 : 0)) % 10 === 0;
        const edge = x === pw - 1 || x === W - pw;
        c.set(x, yy, edge ? BRICK[2] : seam ? MORTAR : ramp(BRICK, clamp(0.75 + Math.abs(i - pw / 2) / 40), x, yy));
      }
    }
  }
  // a narrow dark velvet curtain hanging just inside each pillar
  for (let yy = 0; yy < LIP_Y + 2; yy++) {
    for (let i = 0; i < 9; i++) {
      const v = 0.55 - Math.cos((i / 9) * Math.PI * 3) * 0.25 + (yy < 20 ? 0.2 : 0);
      c.set(pw + i, yy, ramp(P.velvet, clamp(v + 0.15), pw + i, yy));
      c.set(W - 1 - pw - i, yy, ramp(P.velvet, clamp(v + 0.15), W - 1 - pw - i, yy));
    }
  }
  // string lights sagging between hooks
  const hooks = [0, 64, 128, 192, 256, 320, W];
  for (let k = 0; k < hooks.length - 1; k++) {
    const a = hooks[k],
      b = hooks[k + 1];
    for (let x = a; x < b; x++) {
      const t = (x - a) / (b - a);
      const yy = Math.round(4 + Math.sin(t * Math.PI) * 6);
      c.set(x, yy, 0x2a2220);
      if ((x - a) % 16 === 8) {
        c.rect(x - 1, yy + 1, 3, 3, 0xffe9a8);
        c.set(x, yy + 1, 0xfff8e0);
        c.set(x, yy + 4, 0xd9a04a);
      }
    }
  }
  return c;
}

/** Seated silhouettes at small round tables, each with a candle. */
export function drawClubAudience(): PixelCanvas {
  const c = new PixelCanvas(W, H);
  const rnd = seeded(31);
  for (const tx of TABLES) {
    // two guests per table
    for (const side of [-1, 1]) {
      const hx = tx + side * 11 + Math.floor(rnd() * 3);
      const hy = 200 + Math.floor(rnd() * 3);
      c.ellipse(hx, H + 2, 10, 10, 0x0c0709);
      c.ellipse(hx, hy, 4.5, 5.5, 0x0f090c);
      if (rnd() < 0.3) c.hline(hx - 6, hx + 6, hy - 4, 0x0f090c); // a hat brim
      for (let yy = hy - 6; yy < hy; yy++)
        for (let xx = hx - 6; xx <= hx + 6; xx++) if (c.opaque(xx, yy) && !c.opaque(xx, yy - 1)) c.set(xx, yy, 0x5a3036);
    }
    // the table and its candle
    c.ellipse(tx, 207, 9, 2.5, 0x1c1210);
    c.hline(tx - 8, tx + 8, 206, 0x3a261c);
    c.rect(tx - 1, 202, 2, 4, 0xe8d8c0);
    c.set(tx, 201, 0xffd060);
    c.set(tx, 200, 0xfff0b0);
  }
  return c;
}

/** Where the tables (and their candle glows) are. */
export const TABLES = [40, 112, 272, 344];

function B(i: number) {
  return P.gold[i];
}
