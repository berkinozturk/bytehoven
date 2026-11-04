import { drawArm, drawChair, drawHead, drawSeatedLegs, drawStand, drawStandingLegs, drawTorsoFront, type Pt } from './figures';
import type { Look } from './figures';
import { Figure, type Frame } from './musicians';
import { P } from './palette';
import type { PixelCanvas } from './pixel';

/** The jazz club's new players: tenor sax, muted trumpet and a drummer at the kit. */

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const playingish = (f: Frame) => f.state === 'playing' || f.state === 'reading' || f.state === 'error' || f.state === 'tuning';
const B = P.gold; // brass

/**
 * A tenor sax in the classic "J": the neck from the mouthpiece (mx,my) to the top of the
 * body (x,y), the body running down the player's right side and widening, a U-turn at the
 * bottom and the bell rising on the left, opening towards the audience.
 */
function drawSax(c: PixelCanvas, mx: number, my: number, x: number, y: number, keysLit: number) {
  c.set(mx, my, 0x1c1418);
  c.line(mx + 1, my, x, y, B[1]);
  c.line(mx + 1, my + 1, x, y + 1, B[3]);
  // body, widening towards the bottom
  for (let i = 0; i < 15; i++) {
    const w = Math.min(4, 2 + (i >> 2));
    const xx = x + (i >> 3);
    c.hline(xx - 1, xx - 2 + w, y + i, B[2]);
    c.set(xx - 1, y + i, B[1]);
    c.set(xx - 2 + w, y + i, B[3]);
  }
  // the bow at the bottom
  c.hline(x - 6, x + 3, y + 15, B[2]);
  c.hline(x - 5, x + 2, y + 16, B[3]);
  // the bell rising on the left and flaring at the top
  for (let j = 0; j < 6; j++) {
    const w = 2 + (j >> 2);
    c.hline(x - 6 - w + 1, x - 6 + 1, y + 14 - j, B[2]);
    c.set(x - 6 - w + 1, y + 14 - j, B[1]);
  }
  c.hline(x - 10, x - 4, y + 8, B[0]);
  c.hline(x - 9, x - 5, y + 9, B[4]);
  // pearl keys down the body
  for (let k = 0; k < 4; k++) c.set(x + (k >> 1), y + 3 + k * 3, k === keysLit ? P.white[0] : P.white[2]);
}

/** A hand drawn over an instrument (fingers on the keys). */
function hand(c: PixelCanvas, look: Look, [x, y]: Pt) {
  const s = P.skin[look.skin];
  c.rect(x - 1, y - 1, 2, 2, s[1]);
  c.set(x, y, s[2]);
}

// ======================================================================= tenor sax

export class Saxophonist extends Figure {
  emit: Pt = [12, -28];
  head: Pt = [0, -34];
  constructor(look: Look) {
    super(60, 58, 28, 55, look);
    this.standSide = -1;
  }

  draw(f: Frame) {
    const c = this.c;
    const cx = this.ax + this.shake(f),
      fy = this.ay;
    if (f.state === 'walking') return this.drawWalking(f);
    if (f.seat) {
      drawStand(c, cx - 19, fy, fy - 26, this.flip(f));
      drawChair(c, cx, fy);
    }
    const b = this.bob(f);
    const sleep = f.state === 'sleeping';
    // sax players lean into a loud note
    const lean = f.state === 'playing' && f.hitAge < 0.35 && f.hitVel > 0.5 ? 1 : 0;
    const sy = fy - 25 + b + (sleep ? 1 : 0) + lean;
    drawSeatedLegs(c, cx, fy, this.look);
    const sh = drawTorsoFront(c, cx, sy, fy - 12, this.look);
    const hx = cx + (sleep ? 1 : 0),
      hy = sy - 7 + (sleep ? 2 : 0);
    const face = this.face(f);
    const up = playingish(f);
    if (up && f.state !== 'tuning') face.mouth = 'o';
    drawHead(c, hx, hy, this.look, face);
    if (up) {
      const keys = f.state === 'playing' && f.hitAge < 0.3 ? f.hitCount % 4 : -1;
      // arms first, then the sax over the sleeves, then the fingers on the keys
      const press = f.hitAge < 0.15 ? 1 : 0;
      const lh: Pt = [cx + 5, sy + 6 + press];
      const rh: Pt = [cx + 7, sy + 12 + press];
      drawArm(c, sh.l, lh, this.look, -1, 7);
      drawArm(c, sh.r, rh, this.look, 1, 7);
      drawSax(c, hx + 1, hy + 4, cx + 5, sy + 3, keys);
      hand(c, this.look, lh);
      hand(c, this.look, rh);
    } else {
      // the sax rests across the lap, bell to the right
      c.line(cx - 6, fy - 13, cx + 7, fy - 16, B[2]);
      c.line(cx - 6, fy - 12, cx + 7, fy - 15, B[3]);
      c.hline(cx + 7, cx + 11, fy - 18, B[0]);
      c.hline(cx + 7, cx + 11, fy - 17, B[2]);
      if (f.state === 'waiting') {
        const wave = Math.sin(f.t * 5) > 0 ? 1 : 0;
        drawArm(c, sh.l, [cx - 9 + wave, sy - 13], this.look, -1, 7.5, false, true);
      } else drawArm(c, sh.l, [cx - 4, fy - 13], this.look, -1);
      drawArm(c, sh.r, [cx + 5, fy - 15], this.look, 1);
    }
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
    // the sax hangs on its strap
    c.line(cx - 2, sy - 1, cx + 3, sy + 3, 0x1c1418);
    drawArm(c, sh.l, [cx - 7, sy + 12 + Math.round(stride)], this.look, -1);
    drawArm(c, sh.r, [cx + 7, sy + 14], this.look, 1);
    drawSax(c, cx + 3, sy + 3, cx + 5, sy + 5, -1);
    hand(c, this.look, [cx + 7, sy + 14]);
  }
}

// ======================================================================= muted trumpet

export class Trumpeter extends Figure {
  emit: Pt = [-18, -30];
  head: Pt = [0, -34];
  constructor(look: Look) {
    super(60, 56, 30, 53, look);
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
    // trumpet players lift the bell on a big note
    const lift = f.state === 'playing' && f.hitAge < 0.3 && f.hitVel > 0.5 ? 1 : 0;
    const hx = cx,
      hy = sy - 7 + (sleep ? 2 : 0) - lift;
    const face = this.face(f);
    const up = playingish(f) && f.state !== 'tuning';
    if (up) face.mouth = 'o';
    drawHead(c, hx, hy, this.look, face);
    if (up) {
      // pointing to the viewer's left, a straight mute in the bell
      const y = hy + 3;
      const x0 = hx - 1,
        x1 = cx - 16;
      c.line(x0, y, x1 + 3, y - lift, B[1]);
      c.line(x0, y + 1, x1 + 3, y + 1 - lift, B[3]);
      // the loop of tubing under the valves
      c.hline(x0 - 9, x0 - 3, y + 4, B[2]);
      c.vline(x0 - 9, y + 1, y + 4, B[3]);
      // three pistons; one goes down with each new note
      for (let k = 0; k < 3; k++) {
        const px = x0 - 5 - k * 2;
        const down = f.state === 'playing' && f.hitAge < 0.2 && (k + f.hitCount) % 3 === 0 ? 1 : 0;
        c.vline(px, y - 3 + down, y, B[0]);
      }
      // bell and the mute (a cone, darker)
      const bx = x1 + 2,
        by = y - lift;
      c.vline(bx, by - 3, by + 4, B[1]);
      c.vline(bx - 1, by - 3, by + 4, B[0]);
      c.rect(bx - 4, by - 1, 3, 3, P.mute[1]);
      c.set(bx - 4, by, P.mute[3]);
      drawArm(c, sh.r, [x0 - 6, y + 2], this.look, 1, 6.5);
      drawArm(c, sh.l, [x0 - 10, y + 3], this.look, -1, 7);
    } else {
      // trumpet resting on the knee, bell down
      c.line(cx - 4, fy - 14, cx + 6, fy - 14, B[1]);
      c.line(cx - 4, fy - 13, cx + 6, fy - 13, B[3]);
      c.vline(cx + 7, fy - 15, fy - 10, B[0]);
      if (f.state === 'tuning') {
        // oiling the valves, thinking
        const pump = Math.sin(f.t * 6) > 0 ? 1 : 0;
        drawArm(c, sh.r, [cx + 1, fy - 16 - pump], this.look, 1);
        drawArm(c, sh.l, [cx - 3, fy - 13], this.look, -1);
      } else if (f.state === 'waiting') {
        const wave = Math.sin(f.t * 5) > 0 ? 1 : 0;
        drawArm(c, sh.r, [cx + 9 - wave, sy - 13], this.look, 1, 7.5, false, true);
        drawArm(c, sh.l, [cx - 4, fy - 13], this.look, -1);
      } else {
        drawArm(c, sh.r, [cx + 4, fy - 14], this.look, 1);
        drawArm(c, sh.l, [cx - 4, fy - 13], this.look, -1);
      }
    }
  }
}

// ======================================================================= drum kit

export class Drummer extends Figure {
  emit: Pt = [10, -34];
  head: Pt = [0, -44];
  constructor(look: Look) {
    super(84, 64, 42, 61, look);
    this.standSide = -1;
  }

  draw(f: Frame) {
    const c = this.c;
    const cx = this.ax + this.shake(f),
      fy = this.ay;
    if (f.seat) drawStand(c, cx - 37, fy, fy - 28, this.flip(f));
    const b = this.bob(f);
    const sleep = f.state === 'sleeping';
    // throne and the drummer behind the kit
    c.rect(cx - 5, fy - 15, 11, 3, P.black[2]);
    c.vline(cx, fy - 12, fy - 1, P.black[3]);
    const sy = fy - 33 + b + (sleep ? 2 : 0);
    const sh = drawTorsoFront(c, cx, sy, fy - 15, this.look);
    drawHead(c, cx + (sleep ? 1 : 0), sy - 7 + (sleep ? 2 : 0), this.look, this.face(f));

    // hi-hat (viewer's left) and ride (viewer's right), behind the hands
    const hhX = cx - 22,
      hhY = fy - 29;
    c.vline(hhX, hhY, fy - 1, 0x2a2734);
    const hhOpen = f.state === 'playing' && f.hitAge < 0.12 && f.hitCount % 4 === 3 ? 1 : 0;
    c.hline(hhX - 6, hhX + 6, hhY - 1 - hhOpen, P.cymbal[2]);
    c.hline(hhX - 6, hhX + 6, hhY, P.cymbal[3]);
    const rideX = cx + 23,
      rideY = fy - 31;
    c.line(rideX, rideY, rideX - 2, fy - 1, 0x2a2734);
    const shimmer = f.state === 'playing' && f.hitAge < 0.25 ? 1 : 0;
    c.hline(rideX - 9, rideX + 9, rideY - shimmer, P.cymbal[1]);
    c.hline(rideX - 8, rideX + 8, rideY + 1 - shimmer, P.cymbal[3]);
    c.rect(rideX - 1, rideY - 1 - shimmer, 3, 1, P.cymbal[0]);

    // bass drum, front head facing the audience, with the fermata on it
    const bdY = fy - 11;
    c.shadedEllipse(cx, bdY, 11, 10, P.shell);
    c.ellipse(cx, bdY, 9, 8.5, P.drumhead[1]);
    c.shadedEllipse(cx, bdY, 8, 7.5, P.drumhead, -0.4, -0.6);
    for (let a = Math.PI * 1.15; a <= Math.PI * 1.85; a += 0.05) c.set(Math.round(cx + Math.cos(a) * 4), Math.round(bdY + 1 + Math.sin(a) * 3), P.gold[3]);
    c.set(cx, bdY, P.gold[3]);
    c.set(cx, bdY + 1, P.gold[4]);
    // rack tom on top, snare on its stand to the left
    c.shadedEllipse(cx + 6, fy - 24, 5, 3, P.shell);
    c.hline(cx + 2, cx + 10, fy - 26, P.drumhead[0]);
    const snX = cx - 12,
      snY = fy - 21;
    c.vline(snX, snY + 2, fy - 1, 0x2a2734);
    c.rect(snX - 6, snY, 13, 3, P.silver[2]);
    c.hline(snX - 6, snX + 6, snY - 1, P.drumhead[0]);
    c.hline(snX - 6, snX + 6, snY + 3, P.silver[4]);

    // sticks: the right hand rides, the left hand plays snare / hi-hat
    if (f.state === 'waiting') {
      const wave = Math.sin(f.t * 5) > 0 ? 1 : 0;
      drawArm(c, sh.l, [snX + 2, snY - 4], this.look, -1, 7);
      this.stick(snX + 2, snY - 4, snX + 8, snY - 2);
      drawArm(c, sh.r, [cx + 9 + wave, sy - 14], this.look, 1, 7.5, false, true);
      this.stick(cx + 9 + wave, sy - 14, cx + 11 + wave, sy - 24);
      return;
    }
    if (sleep) {
      drawArm(c, sh.l, [snX + 3, snY - 2], this.look, -1, 7);
      drawArm(c, sh.r, [cx + 6, snY - 2], this.look, 1, 7);
      this.stick(snX + 3, snY - 2, snX - 3, snY - 1);
      this.stick(cx + 6, snY - 2, snX + 6, snY - 1);
      return;
    }
    const strike = f.hitCount % 2; // 0 = right (ride), 1 = left (snare)
    const lift = (side: number) => {
      if (f.state !== 'playing') return f.state === 'tuning' ? 2 + Math.round(Math.sin(f.t * 3 + side)) : 2;
      if (side !== strike) return 4;
      return f.hitAge < 0.08 ? 0 : f.hitAge < 0.32 ? Math.round(ease((f.hitAge - 0.08) / 0.24) * 5) : 5;
    };
    const lh: Pt = [snX + 3, snY - 3 - lift(1)];
    const rh: Pt = [rideX - 8, rideY - 2 - lift(0)];
    drawArm(c, sh.l, lh, this.look, -1, 7.5);
    drawArm(c, sh.r, rh, this.look, 1, 7.5);
    this.stick(lh[0], lh[1], snX - 3, snY - 1 - (lift(1) > 2 ? 3 : 0));
    this.stick(rh[0], rh[1], rideX - 2, rideY - 1 - (lift(0) > 2 ? 3 : 0));
  }

  private stick(x0: number, y0: number, x1: number, y1: number) {
    this.c.line(x0, y0, x1, y1, P.wood[1]);
    this.c.set(x1, y1, P.wood[0]);
  }
}
