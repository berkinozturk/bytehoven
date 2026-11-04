import { NEON_CYAN, NEON_PINK } from './chip-figures';
import { FLOOR_TOP, H, LIP_Y, RISER_TOP, W } from './hall';
import { PixelCanvas, bayer, seeded } from './pixel';

/**
 * The chiptune arcade: a dark hall of cabinets with glowing screens, a neon grid
 * floor, players at the machines in front. Original cabinets, no real games.
 * Same grid as the hall.
 */

const WALL = [0x2a1e48, 0x22183c, 0x1a1230, 0x140e26, 0x0e0a1c, 0x080612];
const CAB = [0x5a4a8a, 0x40346a, 0x2c244c, 0x1c1834, 0x100e20];
/** Each cabinet's screen colour; its glow uses the same. */
export const SCREENS = [0x4fe8ff, 0xff4fb8, 0x8aff6a, 0xffd84f, 0xb86aff];
/** Cabinet centres along the back wall. */
export const CABINETS = [36, 96, 156, 228, 288, 348];

const ramp = (tones: number[], v: number, x: number, y: number) =>
  tones[Math.max(0, Math.min(tones.length - 1, Math.round(v * (tones.length - 1) + bayer(x, y) - 0.5)))];
const clamp = (v: number) => Math.max(0, Math.min(1, v));

/** 3×5 letters for the marquee. */
const FONT: Record<string, string[]> = {
  B: ['11.', '1.1', '11.', '1.1', '11.'],
  Y: ['1.1', '1.1', '.1.', '.1.', '.1.'],
  T: ['111', '.1.', '.1.', '.1.', '.1.'],
  E: ['111', '1..', '11.', '1..', '111'],
  H: ['1.1', '1.1', '111', '1.1', '1.1'],
  O: ['111', '1.1', '1.1', '1.1', '111'],
  V: ['1.1', '1.1', '1.1', '1.1', '.1.'],
  N: ['11.', '1.1', '1.1', '1.1', '1.1'],
};

function text(c: PixelCanvas, s: string, x0: number, y0: number, scale: number, color: number) {
  [...s].forEach((ch, i) =>
    FONT[ch]?.forEach((row, ry) =>
      [...row].forEach((on, rx) => {
        if (on === '1') c.rect(x0 + (i * 4 + rx) * scale, y0 + ry * scale, scale, scale, color);
      }),
    ),
  );
}

/** A cabinet seen from the front: marquee, a glowing screen with a few shapes, the control deck. */
function cabinet(c: PixelCanvas, cx: number, top: number, screen: number, rnd: () => number) {
  const w = 30,
    x0 = cx - w / 2;
  for (let y = top; y < FLOOR_TOP - 2; y++) for (let x = x0; x < x0 + w; x++) c.set(x, y, ramp(CAB, clamp(0.35 + (x - x0) / w / 2 + (y - top) / 200), x, y));
  c.vline(x0, top, FLOOR_TOP - 3, CAB[0]);
  // marquee
  c.rect(x0 + 2, top + 2, w - 4, 6, screen);
  c.hline(x0 + 2, x0 + w - 3, top + 2, 0xffffff);
  // the screen: dark glass with simple original shapes in the screen colour
  const sx = x0 + 4,
    sy = top + 11,
    sw = w - 8,
    sh = 22;
  c.rect(sx - 1, sy - 1, sw + 2, sh + 2, 0x05040a);
  c.rect(sx, sy, sw, sh, 0x0c0a1c);
  for (let i = 0; i < 5; i++) c.rect(sx + 2 + Math.floor(rnd() * (sw - 5)), sy + 2 + Math.floor(rnd() * (sh - 8)), 2 + Math.floor(rnd() * 2), 2, screen);
  c.hline(sx + 1, sx + sw - 2, sy + sh - 3, screen);
  for (let y = sy; y < sy + sh; y += 2) for (let x = sx; x < sx + sw; x++) c.blend(x, y, 0x000000, 0.25); // scanlines
  // control deck: a stick and two buttons
  const dy = sy + sh + 4;
  c.rect(x0 + 1, dy, w - 2, 4, CAB[1]);
  c.hline(x0 + 1, x0 + w - 2, dy, CAB[0]);
  c.vline(x0 + 9, dy - 3, dy, 0x2a2232);
  c.rect(x0 + 8, dy - 4, 3, 2, NEON_PINK);
  c.set(x0 + 18, dy + 1, NEON_CYAN);
  c.set(x0 + 22, dy + 1, 0xffd84f);
}

export function drawArcade(): PixelCanvas {
  const c = new PixelCanvas(W, H);
  const rnd = seeded(61);

  // ---- the back wall: deep violet, pixel stars painted up high
  for (let y = 0; y < RISER_TOP; y++) for (let x = 0; x < W; x++) c.set(x, y, ramp(WALL, clamp(0.2 + y / 260 + Math.abs(x - W / 2) / W), x, y));
  for (let i = 0; i < 60; i++) {
    const x = Math.floor(rnd() * W),
      y = Math.floor(rnd() * 34);
    c.set(x, y, rnd() < 0.3 ? 0xffffff : 0x8a7ac8);
    if (rnd() < 0.15) {
      c.set(x - 1, y, 0x6a5aa8);
      c.set(x + 1, y, 0x6a5aa8);
      c.set(x, y - 1, 0x6a5aa8);
      c.set(x, y + 1, 0x6a5aa8);
    }
  }
  // ---- the sign: BYTEHOVEN in blocky letters, a neon tube under it
  const s = 'BYTEHOVEN';
  const scale = 3;
  const sx = Math.round(W / 2 - (s.length * 4 * scale) / 2);
  text(c, s, sx + 1, 13, scale, 0x3a1040);
  text(c, s, sx, 12, scale, NEON_PINK);
  c.hline(sx - 6, sx + s.length * 4 * scale + 4, 31, NEON_CYAN);

  // ---- the cabinets along the wall
  CABINETS.forEach((x, i) => cabinet(c, x, 38 + (i % 2) * 2, SCREENS[i % SCREENS.length], rnd));

  // ---- the floor: dark, with a neon grid running to the front
  for (let y = RISER_TOP; y < LIP_Y; y++) {
    for (let x = 0; x < W; x++) c.set(x, y, y < FLOOR_TOP ? WALL[4] : ramp(WALL, clamp(0.75 - (y - FLOOR_TOP) / 200), x, y));
  }
  c.hline(0, W - 1, FLOOR_TOP - 1, NEON_PINK);
  for (let y = FLOOR_TOP + 4, gap = 4; y < LIP_Y; y += gap, gap += 2) for (let x = 0; x < W; x++) c.blend(x, y, NEON_PINK, 0.35);
  for (let k = -12; k <= 12; k++) {
    // lines fanning out from a vanishing point far behind the wall
    const x0 = W / 2 + k * 10,
      x1 = W / 2 + k * 44;
    c.line(Math.round(x0), FLOOR_TOP, Math.round(x1), LIP_Y - 1, 0x6a2a7a);
  }
  // ---- the front edge, and the dark beyond
  c.hline(0, W - 1, LIP_Y, NEON_CYAN);
  for (let yy = LIP_Y + 1; yy < H; yy++) for (let x = 0; x < W; x++) c.set(x, yy, 0x05040a);
  return c;
}

/** In front of the band: a dark pillar of cabinets' sides at each edge, a neon strip on top. */
export function drawArcadeFront(): PixelCanvas {
  const c = new PixelCanvas(W, H);
  for (let y = 0; y < LIP_Y + 2; y++) {
    for (let i = 0; i < 14; i++) {
      c.set(i, y, ramp(CAB, 0.8 + i / 80, i, y));
      c.set(W - 1 - i, y, ramp(CAB, 0.8 + i / 80, W - 1 - i, y));
    }
    c.set(14, y, NEON_CYAN);
    c.set(W - 15, y, NEON_PINK);
  }
  for (let x = 0; x < W; x++) {
    c.set(x, 2, x % 8 < 4 ? NEON_PINK : NEON_CYAN);
    c.set(x, 3, 0x2a1e48);
  }
  return c;
}

/** Players at the front machines, seen from behind, lit by their screens. */
export function drawArcadeAudience(): PixelCanvas {
  const c = new PixelCanvas(W, H);
  const rnd = seeded(71);
  PLAYERS.forEach((px, i) => {
    const glow = SCREENS[(i + 2) % SCREENS.length];
    const hx = px + Math.floor(rnd() * 3) - 1;
    const hy = 199 + Math.floor(rnd() * 3);
    c.ellipse(hx, H + 2, 10, 10, 0x0a0812);
    c.ellipse(hx, hy, 4.5, 5.5, 0x0c0a16);
    if (rnd() < 0.4) c.hline(hx - 5, hx + 5, hy - 4, 0x0c0a16); // a cap
    for (let yy = hy - 7; yy < hy; yy++) for (let xx = hx - 7; xx <= hx + 7; xx++) if (c.opaque(xx, yy) && !c.opaque(xx, yy - 1)) c.set(xx, yy, glow);
  });
  return c;
}

/** Where the players in front stand (and their screen glows). */
export const PLAYERS = [40, 110, 274, 344];
