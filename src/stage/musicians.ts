import type { InstrumentId } from '../core/events';
import {
  drawArm,
  drawChair,
  drawHead,
  drawSeatedLegs,
  drawStand,
  drawStandingLegs,
  drawTorsoFront,
  clothes,
  type Face,
  type Look,
  type Pt,
} from './figures';
import { P } from './palette';
import { PixelCanvas } from './pixel';

export type MState = 'playing' | 'tuning' | 'reading' | 'idle' | 'sleeping' | 'waiting' | 'error' | 'walking';

/** Everything a figure needs to draw one frame. */
export interface Frame {
  t: number;
  beatPhase: number;
  running: boolean;
  state: MState;
  stateAge: number;
  hitAge: number;
  hitCount: number;
  hitVel: number;
  pitch: number;
  readAge: number;
  resolveAge: number;
  walk: number;
  /** Draw chair & stand (false while walking on/off). */
  seat: boolean;
}

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export abstract class Figure {
  readonly c: PixelCanvas;
  constructor(
    w: number,
    h: number,
    /** Anchor = the floor point under the musician, in canvas pixels. */
    readonly ax: number,
    readonly ay: number,
    readonly look: Look,
  ) {
    this.c = new PixelCanvas(w, h);
  }
  /** Where notes fly out of, relative to the anchor. */
  abstract emit: Pt;
  /** Head position relative to the anchor (for Zzz, fermata sign, spotlight). */
  abstract head: Pt;
  abstract draw(f: Frame): void;

  render(f: Frame): HTMLCanvasElement {
    this.c.clear();
    this.draw(f);
    this.c.outline(P.outline);
    return this.c.flush();
  }

  protected face(f: Frame): Face {
    const blink = f.t % 4.3 < 0.12 || (f.t + 1.7) % 7.9 < 0.1;
    switch (f.state) {
      case 'sleeping':
        return { eyes: 'closed', mouth: Math.sin(f.t * 1.4) > 0.2 ? 'o' : 'neutral' };
      case 'waiting':
        return { eyes: blink ? 'closed' : 'wide', mouth: 'open', brows: 'raised', lookX: 0 };
      case 'error':
        return { eyes: f.stateAge < 1.2 ? 'wide' : 'down', mouth: 'wavy', brows: 'worried', sweat: true, blush: f.stateAge < 0.8 };
      case 'reading':
        return { eyes: blink ? 'closed' : 'down', lookX: this.standSide, mouth: 'neutral' };
      case 'tuning':
        return { eyes: blink ? 'closed' : 'side', lookX: Math.sin(f.t * 0.9) > 0 ? 1 : -1, mouth: 'neutral' };
      case 'walking':
        return { eyes: blink ? 'closed' : 'open', mouth: 'smile' };
      default: {
        if (f.resolveAge < 3.5) return { eyes: 'bliss', mouth: 'smile', blush: true };
        if (f.state === 'playing' && f.hitAge < 1.2 && f.hitVel > 0.55) return { eyes: 'bliss', mouth: 'neutral' };
        return { eyes: blink ? 'closed' : f.state === 'playing' ? 'down' : 'open', mouth: 'neutral' };
      }
    }
  }

  protected standSide = -1;

  protected bob(f: Frame): number {
    if (!f.running) return 0;
    if (f.state === 'sleeping') return Math.sin(f.t * 1.4) > 0.6 ? 1 : 0;
    if (f.state !== 'playing' && f.state !== 'tuning') return 0;
    return f.beatPhase < 0.22 ? 1 : 0;
  }

  protected shake(f: Frame): number {
    if (f.state !== 'error' || f.stateAge > 0.7) return 0;
    return Math.floor(f.t * 30) % 2 ? 1 : -1;
  }

  protected flip(f: Frame): number {
    return f.readAge < 0.55 ? f.readAge / 0.55 : -1;
  }
}

// ======================================================================= violin

export class Violinist extends Figure {
  emit: Pt = [10, -30];
  head: Pt = [0, -34];
  constructor(look: Look) {
    super(58, 56, 30, 53, look);
    this.standSide = -1;
  }

  draw(f: Frame) {
    const c = this.c;
    const cx = this.ax + this.shake(f),
      fy = this.ay;
    if (f.state === 'walking') return this.drawWalking(f);
    if (f.seat) {
      drawStand(c, cx - 20, fy, fy - 26, this.flip(f));
      drawChair(c, cx, fy);
    }
    const b = this.bob(f);
    const sleep = f.state === 'sleeping';
    const sy = fy - 25 + b + (sleep ? 1 : 0);
    drawSeatedLegs(c, cx, fy, this.look);
    const sh = drawTorsoFront(c, cx, sy, fy - 12, this.look);
    const hx = cx + (f.state === 'tuning' ? 1 : 0) + (sleep ? 1 : 0);
    const hy = sy - 7 + (sleep ? 2 : 0);
    drawHead(c, hx, hy, this.look, this.face(f));

    const playing = f.state === 'playing' || f.state === 'reading' || f.state === 'error' || f.state === 'tuning';
    if (playing) {
      // violin under the chin, pointing to the player's left (viewer's right)
      this.drawViolinUp(cx, sy);
      // left hand on the neck; fingers shift a little with pitch
      const fing = f.hitAge < 0.2 ? 1 : 0;
      const lh: Pt = [cx + 15 - Math.round(((f.pitch - 62) / 26) * 3), sy + 6 - fing];
      drawArm(c, sh.r, lh, this.look, 1);
      // bow arm
      const target = f.hitCount % 2;
      const prev = 1 - target;
      const k = f.state === 'tuning' || f.state === 'reading' ? 0.5 : ease(f.hitAge / 0.38);
      const pos = f.state === 'tuning' ? 0.15 : prev + (target - prev) * k;
      const hand: Pt = [cx - 11 + pos * 10, sy + 9 - pos * 3];
      if (f.state === 'tuning') {
        // bow resting, plucking strings with the bow hand
        const pl = Math.sin(f.t * 6) > 0.5 ? 1 : 0;
        drawArm(c, sh.l, [cx + 5, sy + 5 - pl], this.look, -1);
        c.line(cx - 10, sy + 16, cx - 2, sy + 9, P.wood[5]);
      } else {
        const contact: Pt = [cx + 7, sy + 3];
        const dx = contact[0] - hand[0],
          dy = contact[1] - hand[1];
        const L = Math.hypot(dx, dy) || 1;
        const tip: Pt = [hand[0] + (dx / L) * 22, hand[1] + (dy / L) * 22];
        c.line(hand[0], hand[1], tip[0], tip[1], P.wood[4]);
        c.line(hand[0], hand[1] + 1, tip[0], tip[1] + 1, P.white[2]);
        drawArm(c, sh.l, hand, this.look, -1);
      }
    } else {
      // violin resting on the lap
      this.drawViolinLap(cx, fy);
      if (f.state === 'waiting') {
        const wave = Math.sin(f.t * 5) > 0 ? 1 : 0;
        drawArm(c, sh.l, [cx - 9 + wave, sy - 13], this.look, -1, 7.5, false, true);
      } else {
        drawArm(c, sh.l, [cx - 4, fy - 12], this.look, -1);
        c.line(cx - 6, fy - 12, cx - 16, fy - 4, P.wood[4]);
      }
      drawArm(c, sh.r, [cx + 4, fy - 13], this.look, 1);
    }
  }

  private drawViolinUp(cx: number, sy: number) {
    const c = this.c;
    const v = P.violin;
    c.shadedEllipse(cx + 5, sy + 3, 3.6, 3.2, v);
    c.shadedEllipse(cx + 10, sy + 5, 2.6, 2.4, v);
    c.set(cx + 7, sy + 4, v[1]);
    c.set(cx + 4, sy + 2, v[3]);
    c.set(cx + 9, sy + 4, v[3]);
    // chin rest and tailpiece
    c.rect(cx + 2, sy + 1, 2, 2, 0x1c1418);
    c.line(cx + 4, sy + 3, cx + 7, sy + 4, 0x1c1418);
    // neck & fingerboard
    c.line(cx + 9, sy + 5, cx + 17, sy + 7, 0x1c1418);
    c.line(cx + 9, sy + 4, cx + 16, sy + 6, v[2]);
    c.rect(cx + 17, sy + 6, 2, 2, v[3]);
    c.set(cx + 18, sy + 6, v[1]);
  }

  private drawViolinLap(cx: number, fy: number) {
    const c = this.c;
    const v = P.violin;
    c.shadedEllipse(cx + 1, fy - 14, 3.4, 2.8, v);
    c.shadedEllipse(cx + 6, fy - 14, 2.6, 2.4, v);
    c.line(cx + 7, fy - 14, cx + 13, fy - 15, 0x1c1418);
    c.rect(cx + 13, fy - 16, 2, 2, v[3]);
  }

  private drawWalking(f: Frame) {
    const c = this.c;
    const cx = this.ax,
      fy = this.ay;
    const stride = Math.sin(f.walk * Math.PI * 2);
    const b = Math.abs(stride) > 0.5 ? 0 : 1;
    drawStandingLegs(c, cx, fy, fy - 16 - b, this.look, stride);
    const sy = fy - 30 - b;
    const sh = drawTorsoFront(c, cx, sy, fy - 16 - b, this.look);
    drawHead(c, cx, sy - 7, this.look, this.face(f));
    // violin tucked under the arm, bow in hand
    c.shadedEllipse(cx + 8, sy + 8, 2.6, 3.4, P.violin);
    c.line(cx + 8, sy + 4, cx + 9, sy - 1, 0x1c1418);
    drawArm(c, sh.r, [cx + 8, sy + 11], this.look, 1);
    drawArm(c, sh.l, [cx - 7, sy + 12 + Math.round(stride)], this.look, -1);
    c.line(cx - 7, sy + 12, cx - 12, sy + 26, P.wood[4]);
  }
}

// ======================================================================= flute

export class Flutist extends Figure {
  emit: Pt = [-14, -30];
  head: Pt = [0, -34];
  constructor(look: Look) {
    super(58, 56, 28, 53, look);
    this.standSide = 1;
  }

  draw(f: Frame) {
    const c = this.c;
    const cx = this.ax + this.shake(f),
      fy = this.ay;
    if (f.seat) {
      drawStand(c, cx + 19, fy, fy - 26, this.flip(f));
      drawChair(c, cx, fy);
    }
    const b = this.bob(f);
    const sleep = f.state === 'sleeping';
    const sy = fy - 25 + b + (sleep ? 1 : 0);
    drawSeatedLegs(c, cx, fy, this.look);
    const sh = drawTorsoFront(c, cx, sy, fy - 12, this.look);
    const tilt = f.state === 'playing' ? -1 : 0;
    const hx = cx + tilt,
      hy = sy - 7 + (sleep ? 2 : 0);
    const face = this.face(f);
    const up = f.state === 'playing' || f.state === 'reading' || f.state === 'error' || f.state === 'tuning';
    if (up) face.mouth = 'o';
    drawHead(c, hx, hy, this.look, face);
    if (up) {
      // flute held to the player's right (viewer's left)
      const y0 = hy + 3,
        x0 = hx + 1;
      const x1 = cx - 19,
        y1 = hy + 6;
      c.line(x0, y0, x1, y1, P.silver[1]);
      c.line(x0, y0 + 1, x1, y1 + 1, P.silver[3]);
      c.set(x0 - 1, y0, P.silver[0]);
      // keys; fingers dance on new notes
      for (let k = 0; k < 6; k++) {
        const kx = Math.round(x0 - 3 - k * 2.2);
        const ky = Math.round(y0 + ((kx - x0) / (x1 - x0)) * (y1 - y0));
        const pressed = f.state === 'playing' && f.hitAge < 0.25 && (k + f.hitCount) % 3 === 0;
        c.set(kx, ky, pressed ? P.silver[4] : P.silver[2]);
      }
      drawArm(c, sh.l, [cx - 14, hy + 6], this.look, -1, 6.5);
      drawArm(c, sh.r, [cx - 6, hy + 5], this.look, 1, 7);
    } else {
      // flute across the lap
      c.line(cx - 8, fy - 13, cx + 10, fy - 15, P.silver[1]);
      c.line(cx - 8, fy - 12, cx + 10, fy - 14, P.silver[3]);
      if (f.state === 'waiting') {
        const wave = Math.sin(f.t * 5) > 0 ? 1 : 0;
        drawArm(c, sh.r, [cx + 9 - wave, sy - 13], this.look, 1, 7.5, false, true);
      } else drawArm(c, sh.r, [cx + 5, fy - 14], this.look, 1);
      drawArm(c, sh.l, [cx - 5, fy - 13], this.look, -1);
    }
  }
}

// ======================================================================= contrabass

export class Bassist extends Figure {
  emit: Pt = [-6, -24];
  head: Pt = [3, -42];
  constructor(look: Look) {
    super(64, 64, 34, 61, look);
    this.standSide = 1;
  }

  draw(f: Frame) {
    const c = this.c;
    const cx = this.ax + this.shake(f),
      fy = this.ay;
    if (f.seat) drawStand(c, cx + 20, fy, fy - 30, this.flip(f));
    // a tall stool behind the player
    c.vline(cx + 5, fy - 18, fy - 1, P.wood[4]);
    c.vline(cx - 1, fy - 18, fy - 1, P.wood[5]);
    c.rect(cx - 3, fy - 19, 11, 2, P.wood[3]);

    const b = this.bob(f);
    const sleep = f.state === 'sleeping';
    const px = cx + 3;
    drawStandingLegs(c, px, fy, fy - 17, this.look);
    const sy = fy - 31 + b + (sleep ? 2 : 0);
    const sh = drawTorsoFront(c, px, sy, fy - 17, this.look);
    drawHead(c, px + (sleep ? -2 : 0), sy - 7 + (sleep ? 1 : 0), this.look, this.face(f));

    // the instrument, leaning slightly towards the player
    const bx = cx - 7;
    const tones = P.bass;
    c.vline(bx, fy - 4, fy - 1, 0x2a2734);
    c.shadedEllipse(bx, fy - 12, 8, 7.5, tones);
    c.shadedEllipse(bx + 1, fy - 25, 6, 6, tones);
    c.rect(bx - 5, fy - 20, 11, 3, tones[2]);
    c.rect(bx - 4, fy - 20, 2, 3, tones[1]);
    // f-holes, bridge, tailpiece
    c.vline(bx - 3, fy - 17, fy - 13, 0x2a1408);
    c.vline(bx + 4, fy - 17, fy - 13, 0x2a1408);
    c.hline(bx - 1, bx + 2, fy - 15, P.white[2]);
    c.line(bx + 1, fy - 14, bx, fy - 7, 0x1c1418);
    // neck and scroll
    c.line(bx + 1, fy - 16, bx + 3, fy - 47, 0x1c1418);
    c.line(bx + 2, fy - 16, bx + 4, fy - 46, tones[3]);
    c.rect(bx + 2, fy - 51, 3, 4, tones[2]);
    c.set(bx + 3, fy - 51, tones[0]);
    c.set(bx + 5, fy - 49, tones[3]);

    const pitchY = Math.round(fy - 42 + ((f.pitch - 28) / 22) * 14);
    if (f.state === 'waiting') {
      const wave = Math.sin(f.t * 5) > 0 ? 1 : 0;
      drawArm(c, sh.l, [bx + 4, fy - 40], this.look, -1, 8);
      drawArm(c, sh.r, [px + 10 + wave, sy - 14], this.look, 1, 7.5, false, true);
      return;
    }
    if (sleep || f.state === 'idle') {
      drawArm(c, sh.l, [bx + 3, fy - 38], this.look, -1, 8);
      drawArm(c, sh.r, [px + 6, fy - 18], this.look, 1, 7);
      return;
    }
    drawArm(c, sh.l, [bx + 3, Math.min(fy - 30, pitchY)], this.look, -1, 8);
    // pizzicato: the right hand pulls through the string, then returns
    const pull = f.state === 'playing' ? (f.hitAge < 0.1 ? 2 : f.hitAge < 0.25 ? 1 : 0) : 0;
    const swing = f.state === 'tuning' ? Math.round(Math.sin(f.t * 3)) : 0;
    drawArm(c, sh.r, [bx + 4 + pull, fy - 21 + pull + swing], this.look, 1, 7);
    if (pull) c.vline(bx + 1, fy - 30, fy - 16, P.gold[1]);
  }
}

// ======================================================================= timpani

export class Timpanist extends Figure {
  emit: Pt = [0, -22];
  head: Pt = [0, -42];
  constructor(look: Look) {
    super(76, 60, 38, 57, look);
    this.standSide = -1;
  }

  draw(f: Frame) {
    const c = this.c;
    const cx = this.ax + this.shake(f),
      fy = this.ay;
    if (f.seat) drawStand(c, cx - 31, fy, fy - 28, this.flip(f));
    const b = this.bob(f);
    const sleep = f.state === 'sleeping';
    drawStandingLegs(c, cx, fy - 2, fy - 18, this.look);
    const sy = fy - 33 + b + (sleep ? 2 : 0);
    const sh = drawTorsoFront(c, cx, sy, fy - 18, this.look);
    drawHead(c, cx, sy - 7 + (sleep ? 2 : 0), this.look, this.face(f));

    // two copper kettles in front of the player
    const drums: Array<[number, number, number]> = [
      [cx - 14, fy - 13, 10],
      [cx + 14, fy - 13, 9],
    ];
    for (const [dx, dy, r] of drums) {
      for (const lx of [dx - r + 2, dx + r - 2]) c.line(lx, dy, lx + (lx < dx ? -1 : 1), fy - 1, 0x3a3048);
      c.shadedEllipse(dx, dy, r, r * 0.8, P.copper);
      // erase the top half: the bowl only shows below its rim
      for (let y = dy - r; y < dy - 1; y++) for (let x = dx - r - 1; x <= dx + r + 1; x++) c.erase(x, y);
      c.ellipse(dx, dy - 1, r, 2.6, P.drumhead[1]);
      c.hline(dx - r + 2, dx + r - 3, dy - 2, P.drumhead[0]);
      c.hline(dx - r + 1, dx + r - 1, dy + 1, P.copper[3]);
      for (let k = -r + 2; k < r - 1; k += 4) c.set(dx + k, dy + 2, P.silver[2]);
      c.set(dx + Math.round(r * 0.4), dy + 4, P.copper[0]);
    }

    const strikeHand = f.hitCount % 2;
    const hitDown = f.state === 'playing' && f.hitAge < 0.09;
    const lift = (side: number) => {
      if (f.state !== 'playing') return f.state === 'tuning' ? 2 + Math.round(Math.sin(f.t * 2 + side)) : 1;
      if (side === strikeHand) return hitDown ? -1 : f.hitAge < 0.35 ? Math.round(((f.hitAge - 0.09) / 0.26) * 5) : 5;
      return 4;
    };
    const handFor = (side: number): Pt => {
      const [dx, dy] = drums[side];
      return [dx + (side ? -4 : 4), dy - 6 - lift(side)];
    };
    if (f.state === 'waiting') {
      const wave = Math.sin(f.t * 5) > 0 ? 1 : 0;
      drawArm(c, sh.l, [cx - 10, fy - 30], this.look, -1, 7);
      this.mallet(cx - 10, fy - 30, -1, 1);
      drawArm(c, sh.r, [cx + 9 + wave, sy - 14], this.look, 1, 7.5, false, true);
      return;
    }
    if (sleep) {
      drawArm(c, sh.l, [cx - 6, fy - 20], this.look, -1, 7);
      drawArm(c, sh.r, [cx + 6, fy - 20], this.look, 1, 7);
      return;
    }
    const lh = handFor(0),
      rh = handFor(1);
    drawArm(c, sh.l, lh, this.look, -1, 7.5);
    drawArm(c, sh.r, rh, this.look, 1, 7.5);
    this.mallet(lh[0], lh[1], -1, lift(0) <= 0 ? 0 : 1);
    this.mallet(rh[0], rh[1], 1, lift(1) <= 0 ? 0 : 1);
  }

  private mallet(x: number, y: number, dir: number, raised: number) {
    const c = this.c;
    const tx = x - dir * 6,
      ty = y + 3 + raised;
    c.line(x, y, tx, ty, P.wood[2]);
    c.rect(tx - 1, ty - 1, 3, 2, P.white[0]);
    c.set(tx + 1, ty, P.white[2]);
  }
}

// ======================================================================= piano

export class Pianist extends Figure {
  emit: Pt = [40, -38];
  head: Pt = [1, -33];
  constructor(look: Look) {
    super(112, 64, 16, 61, look);
    this.standSide = 1;
  }

  draw(f: Frame) {
    const c = this.c;
    const cx = this.ax + this.shake(f),
      fy = this.ay;
    const k0 = this.ax + 13; // keyboard front (pianist side)
    this.drawPiano(k0, fy, f);

    // bench
    c.rect(cx - 7, fy - 11, 14, 2, P.black[2]);
    c.hline(cx - 7, cx + 6, fy - 12, P.black[1]);
    c.vline(cx - 6, fy - 9, fy - 1, P.black[3]);
    c.vline(cx + 5, fy - 9, fy - 1, P.black[3]);

    const b = this.bob(f);
    const sleep = f.state === 'sleeping';
    const lean = f.state === 'playing' && f.hitAge < 0.3 && f.hitVel > 0.5 ? 1 : 0;
    const look = this.look;
    const t = clothes(look);
    const pants = look.outfit === 'tux' ? P.black : t;
    // legs in profile
    c.rect(cx - 1, fy - 14, 10, 3, pants[1]);
    c.rect(cx + 7, fy - 12, 3, 10, pants[2]);
    c.rect(cx + 7, fy - 2, 5, 2, 0x0e0c12);
    if (look.outfit === 'dress') {
      for (let y = fy - 14; y < fy - 1; y++) {
        const w = Math.min(12, 4 + (y - (fy - 14)));
        c.hline(cx - 2, cx - 2 + w, y, t[y % 3 === 0 ? 0 : 1]);
      }
    }
    // torso in profile
    const top = fy - 27 + b + (sleep ? 2 : 0);
    for (let y = top; y <= fy - 12; y++) {
      const forward = Math.round(((fy - 12 - y) / 15) * (1 + lean));
      for (let x = cx - 4 + forward; x <= cx + 3 + forward; x++) c.set(x, y, t[x < cx - 2 + forward ? 2 : x > cx + 1 + forward ? 0 : 1]);
      if (look.outfit === 'tux' && y < top + 6) c.set(cx + 3 + forward, y, P.white[0]);
    }
    if (look.outfit === 'tux') {
      // tailcoat flap over the bench
      c.rect(cx - 5, fy - 13, 2, 6, t[2]);
    }
    const sx = cx + 1 + 1 + lean,
      sY = top + 3;
    const hx = cx + 2 + lean + (sleep ? 1 : 0),
      hy = top - 6 + (sleep ? 2 : 0);
    c.rect(hx - 1, top - 2, 3, 2, P.skin[look.skin][2]);

    // far arm first (darker), then head, then near arm
    const keyY = fy - 24;
    const pitchX = Math.round(k0 + 2 + ((f.pitch - 50) / 36) * 9);
    const handLift = (side: number) => {
      if (f.state !== 'playing') return 0;
      const strike = f.hitCount % 2 === side || f.hitVel > 0.55;
      if (!strike) return 2;
      return f.hitAge < 0.07 ? 0 : f.hitAge < 0.3 ? Math.round(((f.hitAge - 0.07) / 0.23) * 3) : 3;
    };
    const playingish = f.state === 'playing' || f.state === 'reading' || f.state === 'error' || f.state === 'tuning';
    if (playingish) {
      const far: Pt = [Math.min(k0 + 11, pitchX + 3), keyY - handLift(0)];
      drawArm(c, [sx, sY], far, look, -1, 7, true);
    } else if (f.state === 'waiting') {
      // the far arm goes up behind the head, so the face stays visible
      const wave = Math.sin(f.t * 5) > 0 ? 1 : 0;
      drawArm(c, [sx - 1, sY], [hx - 2 + wave, hy - 14], look, -1, 7.5, true, true);
    } else if (!sleep) {
      drawArm(c, [sx, sY], [cx + 8, fy - 15], look, -1, 7, true);
    }
    drawHead(c, hx, hy, look, this.face(f), true);
    if (playingish) {
      const near: Pt = [f.state === 'tuning' ? cx + 7 : Math.max(k0 - 1, pitchX - 2), f.state === 'tuning' ? fy - 22 : keyY - handLift(1)];
      if (f.state === 'tuning') {
        // hand on chin, thinking
        drawArm(c, [sx, sY], [hx + 3, hy + 4], look, 1, 6);
      } else drawArm(c, [sx, sY], near, look, 1, 7);
    } else if (f.state === 'waiting') {
      drawArm(c, [sx, sY], [cx + 8, fy - 15], look, 1, 7);
    } else {
      drawArm(c, [sx, sY], [cx + 7, fy - 14], look, 1, 7);
    }
  }

  protected drawPiano(k0: number, fy: number, f: Frame) {
    const c = this.c;
    const pc = P.piano;
    const x0 = k0 + 9,
      x1 = k0 + 88;
    const rimTop = fy - 26,
      rimBot = fy - 17;
    // lid, propped open (drawn first so the case sits on top)
    c.poly(
      [
        [x0 + 4, rimTop],
        [x1, rimTop],
        [x1 - 3, rimTop - 22],
        [x0 + 30, rimTop - 11],
      ],
      pc[2],
    );
    c.line(x0 + 4, rimTop, x0 + 30, rimTop - 11, pc[0]);
    c.line(x0 + 30, rimTop - 11, x1 - 3, rimTop - 22, pc[0]);
    c.line(x0 + 31, rimTop - 10, x1 - 4, rimTop - 20, pc[1]);
    // golden frame & strings visible under the lid
    c.hline(x0 + 6, x1 - 2, rimTop - 1, P.gold[2]);
    for (let x = x0 + 8; x < x1 - 2; x += 3) c.set(x, rimTop - 2, P.gold[3]);
    // prop stick
    c.line(x1 - 18, rimTop - 1, x1 - 16, rimTop - 15, pc[1]);
    // case (long side), glossy black with a reflection
    for (let y = rimTop; y <= rimBot; y++) {
      for (let x = x0; x <= x1; x++) {
        const tail = x > x1 - 8 ? (x - (x1 - 8)) / 8 : 0;
        if (tail > 0 && (y - rimTop) / (rimBot - rimTop) < tail * tail * 0.9) continue;
        c.set(x, y, y === rimTop ? pc[1] : y === rimBot ? pc[4] : pc[3]);
      }
    }
    for (let y = rimTop + 2; y < rimBot - 1; y++) {
      c.set(x0 + 22, y, pc[1]);
      c.set(x0 + 23, y, pc[2]);
      c.set(x0 + 50, y, pc[2]);
    }
    c.hline(x0 + 2, x1 - 10, rimTop + 1, pc[2]);
    // keyboard
    c.rect(k0, fy - 23, 10, 2, pc[3]);
    c.hline(k0, k0 + 9, fy - 24, P.pianoKeys[0]);
    for (let k = k0; k < k0 + 10; k += 2) if (k % 7 !== 3) c.set(k, fy - 25, pc[4]);
    c.rect(k0 - 1, fy - 22, 11, 2, pc[2]);
    // music desk + sheet
    c.line(x0, rimTop - 1, x0 + 4, rimTop - 7, pc[2]);
    const flip = this.flip(f);
    c.rect(x0 + 1, rimTop - 10, 7, 6, P.white[1]);
    c.hline(x0 + 1, x0 + 7, rimTop - 10, P.white[0]);
    for (let k = 0; k < 2; k++) for (let i = x0 + 2; i <= x0 + 6; i += 2) c.set(i, rimTop - 8 + k * 2, P.white[3]);
    if (flip >= 0) {
      const w = Math.max(1, Math.round(Math.abs(Math.cos(flip * Math.PI)) * 3));
      const px = Math.round(x0 + 7 - flip * 6);
      c.rect(flip < 0.5 ? px - w : px, rimTop - 11 - Math.round(Math.sin(flip * Math.PI) * 2), w + 1, 6, P.white[0]);
    }
    // legs with gold casters
    for (const lx of [x0 + 3, x1 - 12]) {
      c.rect(lx, rimBot + 1, 3, fy - rimBot - 3, pc[3]);
      c.set(lx, rimBot + 1, pc[1]);
      c.rect(lx, fy - 2, 3, 2, P.gold[3]);
    }
    c.rect(x0 + 40, rimBot + 1, 2, fy - rimBot - 4, pc[4]);
    // pedal lyre
    c.vline(x0 + 13, rimBot + 1, fy - 4, pc[2]);
    c.vline(x0 + 16, rimBot + 1, fy - 4, pc[2]);
    c.hline(x0 + 12, x0 + 17, fy - 3, P.gold[2]);
  }
}

// ======================================================================= conductor

export class Conductor {
  readonly c = new PixelCanvas(64, 72);
  readonly ax = 32;
  readonly ay = 70;
  readonly look: Look = { skin: 1, hair: 'silver', hairStyle: 'swept', outfit: 'tux' };
  /** baton tip in canvas coords, for the trail effect */
  tip: Pt = [0, 0];

  render(o: { beatPhase: number; beat: number; running: boolean; t: number; fermata: number; cue: number; pointAt: number; tapAge: number }) {
    const c = this.c;
    c.clear();
    const cx = this.ax,
      fy = this.ay;
    // podium
    c.rect(cx - 13, fy - 8, 27, 8, P.wood[4]);
    c.hline(cx - 13, cx + 13, fy - 8, P.gold[2]);
    c.hline(cx - 13, cx + 13, fy - 7, P.wood[2]);
    c.rect(cx - 10, fy - 5, 21, 3, P.wood[5]);
    // rail
    c.vline(cx - 12, fy - 18, fy - 9, P.gold[3]);
    c.vline(cx + 12, fy - 18, fy - 9, P.gold[3]);
    c.hline(cx - 12, cx + 12, fy - 18, P.gold[2]);
    const feet = fy - 9;
    // from behind: legs, tailcoat, back of the head
    const t = P.black;
    c.rect(cx - 4, feet - 14, 3, 13, t[2]);
    c.rect(cx + 1, feet - 14, 3, 13, t[3]);
    const sy = feet - 30;
    for (let y = sy; y < feet - 12; y++) {
      const half = y < sy + 2 ? 5 + (y - sy) : 7 - Math.floor((y - sy) / 9);
      for (let x = cx - half; x <= cx + half; x++) c.set(x, y, t[x < cx - half + 2 ? 1 : x > cx + half - 2 ? 3 : 2]);
    }
    // tails
    c.poly([[cx - 5, feet - 13], [cx - 1, feet - 13], [cx - 2, feet - 5], [cx - 5, feet - 6]], t[3]);
    c.poly([[cx + 1, feet - 13], [cx + 5, feet - 13], [cx + 5, feet - 6], [cx + 2, feet - 5]], t[3]);
    c.vline(cx, sy + 3, feet - 13, t[4]);
    // collar & head (back view)
    c.hline(cx - 2, cx + 2, sy - 1, P.white[1]);
    const skin = P.skin[this.look.skin];
    c.rect(cx - 1, sy - 3, 3, 2, skin[2]);
    const hair = P.hair.silver;
    const hy = sy - 8;
    c.shadedEllipse(cx, hy, 4.6, 5, hair);
    c.set(cx - 5, hy + 1, skin[1]);
    c.set(cx + 5, hy + 1, skin[2]);
    c.set(cx - 2, hy - 3, 0xffffff);

    // ---- baton arm (viewer's right): a 4/4 beat pattern
    const shR: Pt = [cx + 6, sy + 2];
    const shL: Pt = [cx - 6, sy + 2];
    let hand: Pt;
    if (o.fermata > 0) {
      // hold: baton high and still, trembling slightly with tension
      const tr = o.fermata > 0.6 && Math.floor(o.t * 20) % 2 ? 1 : 0;
      hand = [cx + 11, sy - 11 - tr];
    } else if (o.cue > 0) {
      // the cut-off / downbeat after a fermata: a big confident stroke
      const k = 1 - o.cue;
      hand = [cx + 11 - k * 3, sy - 11 + k * 18];
    } else if (o.running) {
      const pts: Pt[] = [
        [cx + 8, sy + 9], // 1 (ictus, down)
        [cx + 1, sy + 6], // 2 (left)
        [cx + 15, sy + 6], // 3 (right)
        [cx + 9, sy - 2], // 4 (up)
      ];
      // accelerate into the ictus, rebound a little after it
      const p = o.beatPhase;
      const reb = p < 0.15 ? (0.15 - p) * 10 : 0;
      const k = p * p;
      // re-express as "from previous ictus to this one"
      const last = pts[(o.beat + 3) % 4];
      const next = pts[o.beat];
      hand = [last[0] + (next[0] - last[0]) * k, last[1] + (next[1] - last[1]) * k - reb * 2];
    } else if (o.tapAge < 0.25) {
      hand = [cx + 10, sy + 4 + (o.tapAge < 0.08 ? 2 : 0)];
    } else {
      hand = [cx + 10, sy + 4];
    }
    if (o.pointAt !== 0 && o.fermata === 0 && o.cue === 0) hand = [cx + 6 + o.pointAt * 10, sy - 3];
    drawArm(c, shR, hand, this.look, 1, 7);
    const dir = o.pointAt !== 0 ? [o.pointAt * 0.8, -0.6] : [0.45, -0.9];
    const L = Math.hypot(dir[0], dir[1]);
    this.tip = [hand[0] + (dir[0] / L) * 11, hand[1] + (dir[1] / L) * 11];
    c.line(hand[0], hand[1], this.tip[0], this.tip[1], P.white[0]);

    // ---- left hand: expressive. Rises and holds during a fermata.
    if (o.fermata > 0) {
      const lift = Math.min(1, o.fermata * 3);
      drawArm(c, shL, [cx - 11, sy + 4 - lift * 16], this.look, -1, 7.5, false, true);
    } else if (o.cue > 0) {
      drawArm(c, shL, [cx - 12 - o.cue * 2, sy - 8 + (1 - o.cue) * 12], this.look, -1, 7.5);
    } else {
      drawArm(c, shL, [cx - 8, sy + 11], this.look, -1, 7);
    }
    c.outline(P.outline);
    return c.flush();
  }
}

// ======================================================================= factory

export function makeFigure(instrument: InstrumentId, look: Look): Figure {
  switch (instrument) {
    case 'piano':
      return new Pianist(look);
    case 'violin':
      return new Violinist(look);
    case 'flute':
      return new Flutist(look);
    case 'contrabass':
      return new Bassist(look);
    case 'percussion':
      return new Timpanist(look);
  }
}
