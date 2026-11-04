import { P } from './palette';
import type { PixelCanvas } from './pixel';

/** How a character looks. */
export interface Look {
  skin: 0 | 1 | 2 | 3;
  hair: keyof typeof P.hair;
  hairStyle: 'short' | 'bun' | 'curly' | 'bob' | 'long' | 'bald' | 'swept';
  outfit: 'tux' | 'dress';
  /** Dress / bodice ramp (light → dark) when outfit is 'dress'. */
  dress?: number[];
  glasses?: boolean;
  beard?: boolean;
}

export type Eyes = 'open' | 'closed' | 'up' | 'down' | 'side' | 'wide' | 'bliss';
export type Mouth = 'neutral' | 'smile' | 'o' | 'frown' | 'wavy' | 'open';

export interface Face {
  eyes: Eyes;
  lookX?: number; // -1..1
  mouth: Mouth;
  brows?: 'worried' | 'raised' | 'angry';
  sweat?: boolean;
  blush?: boolean;
}

export type Pt = [number, number];

const EYE = 0x24161c;

export function clothes(look: Look) {
  return look.outfit === 'tux' ? P.black : (look.dress ?? P.velvet.slice(1));
}

// ------------------------------------------------------------------ heads

export function drawHead(c: PixelCanvas, hx: number, hy: number, look: Look, face: Face, profile = false) {
  const skin = P.skin[look.skin];
  const hair = P.hair[look.hair];
  // hair behind the head
  if (look.hairStyle === 'long') {
    c.rect(hx - 5, hy - 2, 11, 10, hair[2]);
    c.rect(hx - 5, hy - 2, 2, 9, hair[1]);
  }
  if (profile) {
    c.shadedEllipse(hx, hy, 4.2, 5, [skin[0], skin[1], skin[2]]);
    // nose & chin
    c.set(hx + 5, hy + 1, skin[1]);
    c.set(hx + 4, hy + 3, skin[2]);
    // eye
    const ey = face.eyes === 'down' ? hy + 1 : hy;
    if (face.eyes === 'closed' || face.eyes === 'bliss') c.hline(hx + 2, hx + 3, hy + 1, EYE);
    else c.vline(hx + 3, ey, ey + 1, EYE);
    // mouth
    if (face.mouth === 'o' || face.mouth === 'open') c.set(hx + 4, hy + 3, 0x6a2a2a);
    else if (face.mouth === 'smile') c.set(hx + 4, hy + 3, skin[3]);
    // ear
    c.set(hx - 1, hy + 1, skin[2]);
    c.set(hx - 1, hy, skin[1]);
    // hair: back half
    c.ellipse(hx - 2.5, hy - 3, 3, 2.8, hair[1]);
    c.hline(hx - 3, hx + 3, hy - 5, hair[0]);
    c.hline(hx - 2, hx + 3, hy - 4, hair[1]);
    c.rect(hx - 4, hy - 3, 2, 6, hair[1]);
    c.set(hx - 4, hy + 3, hair[2]);
    if (look.hairStyle === 'bun') c.ellipse(hx - 4, hy - 4, 2, 2, hair[1]);
    if (look.hairStyle === 'long') {
      c.rect(hx - 5, hy - 2, 3, 10, hair[1]);
      c.vline(hx - 2, hy - 2, hy + 6, hair[2]);
    }
    if (look.glasses) {
      c.hline(hx + 2, hx + 4, hy - 1, 0x2a2430);
      c.set(hx + 1, hy - 1, 0x2a2430);
    }
    if (face.sweat) c.set(hx - 2, hy - 1, P.sweat);
    return;
  }

  c.shadedEllipse(hx, hy, 4.5, 5, [skin[0], skin[1], skin[2]]);
  // ears
  c.set(hx - 5, hy + 1, skin[1]);
  c.set(hx + 5, hy + 1, skin[2]);
  // nose shading
  c.set(hx, hy + 2, skin[2]);

  // eyes
  const lx = Math.round(face.lookX ?? 0);
  const ex1 = hx - 2 + lx,
    ex2 = hx + 2 + lx;
  switch (face.eyes) {
    case 'closed':
      c.hline(ex1 - 1, ex1, hy + 1, EYE);
      c.hline(ex2, ex2 + 1, hy + 1, EYE);
      break;
    case 'bliss':
      c.set(ex1 - 1, hy + 1, EYE);
      c.set(ex1, hy, EYE);
      c.set(ex2, hy, EYE);
      c.set(ex2 + 1, hy + 1, EYE);
      break;
    case 'up':
      c.vline(ex1, hy - 1, hy, EYE);
      c.vline(ex2, hy - 1, hy, EYE);
      break;
    case 'down':
      c.set(ex1, hy + 1, EYE);
      c.set(ex2, hy + 1, EYE);
      break;
    case 'wide':
      c.vline(ex1, hy - 1, hy + 1, EYE);
      c.vline(ex2, hy - 1, hy + 1, EYE);
      c.set(ex1 - 1, hy, P.white[0]);
      c.set(ex2 + 1, hy, P.white[0]);
      break;
    default:
      c.vline(ex1, hy, hy + 1, EYE);
      c.vline(ex2, hy, hy + 1, EYE);
  }
  if (look.glasses) {
    c.hline(ex1 - 1, ex1 + 1, hy - 1, 0x2a2430);
    c.hline(ex2 - 1, ex2 + 1, hy - 1, 0x2a2430);
    c.set(hx, hy - 1, 0x2a2430);
    c.set(ex1 - 1, hy + 2, 0x2a2430);
    c.set(ex2 + 1, hy + 2, 0x2a2430);
  }
  // brows
  if (face.brows === 'worried') {
    c.set(ex1 - 1, hy - 1, EYE);
    c.set(ex1, hy - 2, EYE);
    c.set(ex2, hy - 2, EYE);
    c.set(ex2 + 1, hy - 1, EYE);
  } else if (face.brows === 'angry') {
    c.set(ex1 - 1, hy - 2, EYE);
    c.set(ex1, hy - 1, EYE);
    c.set(ex2, hy - 1, EYE);
    c.set(ex2 + 1, hy - 2, EYE);
  } else if (face.brows === 'raised') {
    c.hline(ex1 - 1, ex1, hy - 2, skin[3]);
    c.hline(ex2, ex2 + 1, hy - 2, skin[3]);
  }
  // mouth
  const my = hy + 3;
  const lip = 0x7a3438;
  switch (face.mouth) {
    case 'smile':
      c.set(hx - 2, my - 1, lip);
      c.hline(hx - 1, hx + 1, my, lip);
      c.set(hx + 2, my - 1, lip);
      break;
    case 'o':
      c.rect(hx, my, 1, 2, 0x4a1a20);
      break;
    case 'open':
      c.rect(hx - 1, my, 3, 2, 0x4a1a20);
      c.set(hx, my + 1, 0xd86a6a);
      break;
    case 'frown':
      c.set(hx - 2, my + 1, lip);
      c.hline(hx - 1, hx + 1, my, lip);
      c.set(hx + 2, my + 1, lip);
      break;
    case 'wavy':
      c.set(hx - 2, my, lip);
      c.set(hx - 1, my + 1, lip);
      c.set(hx, my, lip);
      c.set(hx + 1, my + 1, lip);
      c.set(hx + 2, my, lip);
      break;
    default:
      c.hline(hx - 1, hx, my, skin[3]);
  }
  if (face.blush) {
    c.set(hx - 3, hy + 2, P.blush);
    c.set(hx + 3, hy + 2, P.blush);
  }
  if (look.beard) {
    for (let x = hx - 4; x <= hx + 4; x++) {
      const yy = hy + 3 + (Math.abs(x - hx) < 3 ? 1 : 0);
      c.vline(x, yy, hy + 5 - (Math.abs(x - hx) > 3 ? 1 : 0), hair[1]);
    }
    c.hline(hx - 1, hx + 1, hy + 3, face.mouth === 'o' ? 0x4a1a20 : hair[2]);
  }

  // hair, front
  switch (look.hairStyle) {
    case 'short':
      c.ellipse(hx, hy - 3.6, 5, 2.6, hair[1]);
      c.hline(hx - 3, hx + 2, hy - 5, hair[0]);
      c.set(hx - 5, hy - 1, hair[1]);
      c.set(hx + 5, hy - 1, hair[2]);
      c.set(hx + 2, hy - 1, hair[2]);
      break;
    case 'swept':
      c.ellipse(hx, hy - 3.6, 5, 2.6, hair[1]);
      c.hline(hx - 4, hx + 1, hy - 5, hair[0]);
      c.hline(hx - 4, hx - 1, hy - 1, hair[1]);
      c.set(hx - 5, hy, hair[1]);
      c.set(hx + 5, hy - 1, hair[2]);
      break;
    case 'bun':
      c.ellipse(hx, hy - 3.6, 5, 2.6, hair[1]);
      c.ellipse(hx, hy - 7, 2.5, 2, hair[1]);
      c.set(hx - 1, hy - 8, hair[0]);
      c.hline(hx - 3, hx + 1, hy - 5, hair[0]);
      c.set(hx - 5, hy, hair[1]);
      c.set(hx + 5, hy, hair[2]);
      break;
    case 'curly':
      for (const [dx, dy] of [[-4, -3], [-2, -5], [1, -5], [3, -4], [5, -2], [-5, -1], [5, 0], [-5, 1]] as Pt[]) {
        c.ellipse(hx + dx, hy + dy, 1.6, 1.6, hair[1]);
      }
      c.ellipse(hx, hy - 3, 4.5, 2.5, hair[1]);
      c.set(hx - 2, hy - 6, hair[0]);
      c.set(hx + 1, hy - 6, hair[0]);
      c.set(hx - 4, hy - 4, hair[0]);
      break;
    case 'bob':
      c.ellipse(hx, hy - 3.6, 5.2, 2.7, hair[1]);
      c.rect(hx - 6, hy - 2, 2, 7, hair[1]);
      c.rect(hx + 5, hy - 2, 2, 7, hair[2]);
      c.hline(hx - 4, hx + 4, hy - 1, hair[1]);
      c.hline(hx - 3, hx + 1, hy - 5, hair[0]);
      break;
    case 'long':
      c.ellipse(hx, hy - 3.6, 5.2, 2.7, hair[1]);
      c.rect(hx - 6, hy - 2, 2, 9, hair[1]);
      c.rect(hx + 5, hy - 2, 2, 9, hair[2]);
      c.hline(hx - 3, hx + 1, hy - 5, hair[0]);
      c.set(hx - 3, hy - 1, hair[1]);
      break;
    case 'bald':
      c.rect(hx - 5, hy - 2, 1, 3, hair[1]);
      c.rect(hx + 5, hy - 2, 1, 3, hair[1]);
      c.set(hx - 2, hy - 4, skin[0]);
      c.set(hx - 1, hy - 4, 0xffffff);
      break;
  }
  if (face.sweat) {
    c.set(hx + 5, hy - 2, P.sweat);
    c.vline(hx + 5, hy - 1, hy, 0x6aaee0);
  }
}

// ------------------------------------------------------------------ arms

/** Two-segment arm with a simple IK elbow. `out` = which side the elbow bends to. */
export function drawArm(c: PixelCanvas, s: Pt, h: Pt, look: Look, out: 1 | -1, len = 6.5, dark = false, open = false) {
  const tones = clothes(look);
  const sleeve = dark ? tones[3] : tones[1];
  const sleeveDark = dark ? tones[4] ?? tones[3] : tones[2];
  const dx = h[0] - s[0],
    dy = h[1] - s[1];
  const d = Math.min(Math.hypot(dx, dy), len * 2 - 0.01);
  const mx = s[0] + dx / 2,
    my = s[1] + dy / 2;
  const k = Math.sqrt(Math.max(0, len * len - (d / 2) * (d / 2)));
  const nx = -dy / (Math.hypot(dx, dy) || 1),
    ny = dx / (Math.hypot(dx, dy) || 1);
  const e: Pt = [mx + nx * k * out, my + ny * k * out];
  c.line(s[0], s[1], e[0], e[1], sleeve, 2);
  c.line(e[0], e[1], h[0], h[1], sleeve, 2);
  c.line(s[0] + 1, s[1] + 1, e[0] + 1, e[1] + 1, sleeveDark);
  // white cuff
  const cx = h[0] - (h[0] - e[0]) * 0.25,
    cy = h[1] - (h[1] - e[1]) * 0.25;
  if (look.outfit === 'tux') c.set(cx, cy, P.white[1]);
  const skin = P.skin[look.skin];
  if (open) {
    // open palm with fingers up
    c.rect(h[0] - 1, h[1] - 1, 3, 3, skin[1]);
    c.vline(h[0] - 1, h[1] - 3, h[1] - 2, skin[1]);
    c.vline(h[0], h[1] - 4, h[1] - 2, skin[0]);
    c.vline(h[0] + 1, h[1] - 3, h[1] - 2, skin[1]);
    c.set(h[0] + 2, h[1] - 1, skin[1]);
  } else {
    c.rect(h[0] - 1, h[1] - 1, 2, 2, skin[1]);
    c.set(h[0] - 1, h[1] - 1, skin[0]);
  }
}

// ------------------------------------------------------------------ bodies

/** Torso for a front-facing figure. Returns the shoulder points. */
export function drawTorsoFront(c: PixelCanvas, cx: number, sy: number, waistY: number, look: Look): { l: Pt; r: Pt } {
  const t = clothes(look);
  for (let y = sy; y <= waistY; y++) {
    const half = y < sy + 2 ? 6 - (sy + 2 - y) : 6 - Math.floor(((y - sy) / (waistY - sy)) * 1.5);
    for (let x = cx - half; x <= cx + half; x++) {
      const shade = x < cx - half + 2 ? 0 : x > cx + half - 3 ? 2 : 1;
      c.set(x, y, t[shade]);
    }
  }
  const skin = P.skin[look.skin];
  if (look.outfit === 'tux') {
    // shirt V, bow tie, lapels
    for (let y = sy; y < sy + 7; y++) {
      const w = Math.max(0, 2 - Math.floor((y - sy) / 3));
      for (let x = cx - w; x <= cx + w; x++) c.set(x, y, P.white[y === sy ? 1 : 0]);
      c.set(cx - w - 1, y, t[0]);
      c.set(cx + w + 1, y, t[3]);
    }
    c.set(cx - 1, sy + 1, 0x1a1420);
    c.set(cx + 1, sy + 1, 0x1a1420);
    c.set(cx, sy + 1, 0x3a3048);
    c.set(cx, sy + 4, P.white[2]);
  } else {
    // neckline and a little pendant
    c.hline(cx - 2, cx + 2, sy, skin[1]);
    c.hline(cx - 1, cx + 1, sy + 1, skin[2]);
    c.set(cx, sy + 2, P.gold[1]);
    // waist ribbon
    c.hline(cx - 5, cx + 5, waistY - 1, t[3] ?? t[2]);
  }
  // neck
  c.rect(cx - 1, sy - 2, 3, 2, skin[2]);
  return { l: [cx - 6, sy + 2], r: [cx + 6, sy + 2] };
}

/** A chair seen from the front. */
export function drawChair(c: PixelCanvas, cx: number, fy: number, back = true) {
  const w = P.wood;
  if (back) {
    c.rect(cx - 7, fy - 27, 2, 18, w[4]);
    c.rect(cx + 6, fy - 27, 2, 18, w[5]);
    c.hline(cx - 7, cx + 7, fy - 27, w[2]);
    c.hline(cx - 7, cx + 7, fy - 26, w[4]);
  }
  c.rect(cx - 7, fy - 10, 15, 2, w[3]);
  c.hline(cx - 7, cx + 7, fy - 11, P.velvet[2]);
  c.vline(cx - 7, fy - 8, fy, w[4]);
  c.vline(cx + 7, fy - 8, fy, w[5]);
  c.vline(cx - 4, fy - 8, fy - 1, w[5]);
  c.vline(cx + 4, fy - 8, fy - 1, w[5]);
}

/** Seated legs from the front. */
export function drawSeatedLegs(c: PixelCanvas, cx: number, fy: number, look: Look) {
  const t = clothes(look);
  const pants = look.outfit === 'tux' ? P.black : t;
  // lap
  c.rect(cx - 5, fy - 12, 11, 3, pants[1]);
  c.hline(cx - 5, cx + 5, fy - 12, pants[0]);
  if (look.outfit === 'dress') {
    // long skirt falls to the floor
    for (let y = fy - 9; y < fy - 1; y++) {
      const half = 5 + Math.floor((y - (fy - 9)) / 3);
      for (let x = cx - half; x <= cx + half; x++) c.set(x, y, t[x < cx - half + 2 ? 0 : x > cx + half - 2 ? 2 : 1]);
    }
    c.rect(cx - 4, fy - 2, 3, 2, P.black[3]);
    c.rect(cx + 2, fy - 2, 3, 2, P.black[3]);
    return;
  }
  c.rect(cx - 5, fy - 9, 3, 7, pants[2]);
  c.rect(cx + 3, fy - 9, 3, 7, pants[2]);
  c.vline(cx - 5, fy - 9, fy - 3, pants[1]);
  c.vline(cx + 3, fy - 9, fy - 3, pants[1]);
  // shoes
  c.rect(cx - 6, fy - 2, 4, 2, 0x0e0c12);
  c.rect(cx + 3, fy - 2, 4, 2, 0x0e0c12);
  c.set(cx - 5, fy - 2, 0x5a566e);
  c.set(cx + 4, fy - 2, 0x5a566e);
}

/** Standing legs from the front (walk = -1..1 stride). */
export function drawStandingLegs(c: PixelCanvas, cx: number, fy: number, hipY: number, look: Look, walk = 0) {
  const t = clothes(look);
  const pants = look.outfit === 'tux' ? P.black : t;
  if (look.outfit === 'dress') {
    for (let y = hipY; y < fy - 1; y++) {
      const half = 5 + Math.floor((y - hipY) / 4);
      for (let x = cx - half; x <= cx + half; x++) c.set(x, y, t[x < cx - half + 2 ? 0 : x > cx + half - 2 ? 2 : 1]);
    }
    const s = Math.round(walk * 2);
    c.rect(cx - 4 + s, fy - 2, 3, 2, P.black[3]);
    c.rect(cx + 2 - s, fy - 2, 3, 2, P.black[3]);
    return;
  }
  const s = Math.round(walk * 2);
  c.rect(cx - 5, hipY, 11, 2, pants[1]);
  c.rect(cx - 4 + s, hipY + 2, 3, fy - hipY - 4, pants[1]);
  c.rect(cx + 2 - s, hipY + 2, 3, fy - hipY - 4, pants[2]);
  c.rect(cx - 5 + s, fy - 2, 4, 2, 0x0e0c12);
  c.rect(cx + 2 - s, fy - 2, 4, 2, 0x0e0c12);
}

/** Music stand with a sheet; `flip` 0..1 animates a page turn. */
export function drawStand(c: PixelCanvas, x: number, fy: number, deskY: number, flip = -1) {
  c.vline(x, deskY + 4, fy - 1, 0x2a2734);
  c.hline(x - 3, x + 3, fy - 1, 0x2a2734);
  c.set(x - 3, fy - 2, 0x2a2734);
  c.set(x + 3, fy - 2, 0x2a2734);
  // desk
  c.rect(x - 6, deskY, 13, 5, 0x1c1a25);
  c.hline(x - 6, x + 6, deskY + 4, 0x3c394b);
  // sheet music
  c.rect(x - 5, deskY - 3, 11, 6, P.white[1]);
  c.hline(x - 5, x + 5, deskY - 3, P.white[0]);
  for (let k = 0; k < 3; k++) {
    for (let i = x - 4; i <= x + 4; i += 2) c.set(i, deskY - 2 + k * 2, P.white[3]);
  }
  c.set(x - 2, deskY - 1, 0x3a3048);
  c.set(x + 2, deskY + 1, 0x3a3048);
  if (flip >= 0 && flip < 1) {
    // a page lifting and travelling across
    const px = Math.round(x + 5 - flip * 10);
    const lift = Math.round(Math.sin(flip * Math.PI) * 3);
    const w = Math.max(1, Math.round(Math.abs(Math.cos(flip * Math.PI)) * 5));
    const left = flip < 0.5 ? px - w : px;
    c.rect(left, deskY - 3 - lift, w + 1, 6, P.white[0]);
    c.vline(flip < 0.5 ? left : left + w, deskY - 3 - lift, deskY + 2 - lift, P.white[2]);
  }
}
