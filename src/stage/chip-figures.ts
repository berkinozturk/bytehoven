import { drawArm, drawChair, drawHead, drawSeatedLegs, drawStand, drawStandingLegs, drawTorsoFront, type Look, type Pt } from './figures';
import { Figure, Pianist, type Frame } from './musicians';
import { P } from './palette';
import type { PixelCanvas } from './pixel';

/** The arcade's players: a synth, a handheld console, a keytar and a drum machine. */

export const NEON_PINK = 0xff4fb8;
export const NEON_CYAN = 0x4fe8ff;
const SCREEN = [0x9ff8ff, 0x4fc8e8, 0x2a7aa8, 0x163a5c];
const CASE = [0x6a5a9a, 0x4a3e78, 0x2e2850, 0x1c1834];

function hand(c: PixelCanvas, look: Look, [x, y]: Pt) {
  const s = P.skin[look.skin];
  c.rect(x - 1, y - 1, 2, 2, s[1]);
  c.set(x, y, s[2]);
}

/** How far a finger or hand is down on a fresh note (0..2). */
const press = (f: Frame) => (f.state !== 'playing' ? 0 : f.hitAge < 0.08 ? 2 : f.hitAge < 0.2 ? 1 : 0);

// ======================================================================= synth keyboard

/** The pianist in profile at a synth on an X stand, its little screen glowing. */
export class SynthPlayer extends Pianist {
  emit: Pt = [24, -30];

  protected drawPiano(k0: number, fy: number, f: Frame) {
    const c = this.c;
    const y = fy - 24;
    // the X stand
    c.line(k0 + 1, y + 3, k0 + 15, fy - 1, P.black[2]);
    c.line(k0 + 15, y + 3, k0 + 1, fy - 1, P.black[3]);
    c.hline(k0 - 1, k0 + 3, fy - 1, P.black[1]);
    c.hline(k0 + 13, k0 + 17, fy - 1, P.black[1]);
    // the synth: a slim case, keys at the player's end, a screen and knobs on top
    c.rect(k0 - 1, y, 20, 3, CASE[2]);
    c.hline(k0 - 1, k0 + 18, y + 2, CASE[3]);
    c.hline(k0, k0 + 9, y - 1, P.pianoKeys[0]);
    for (let k = k0 + 1; k < k0 + 10; k += 2) if (k % 7 !== 3) c.set(k, y - 1, P.piano[3]);
    const lit = f.state === 'playing' && f.hitAge < 0.3;
    c.rect(k0 + 11, y - 2, 5, 2, lit ? SCREEN[0] : SCREEN[2]);
    c.set(k0 + 17, y - 1, NEON_PINK);
    // the music on a clip-on desk
    const flip = this.flip(f);
    c.rect(k0 + 11, y - 10, 6, 7, P.white[1]);
    c.hline(k0 + 11, k0 + 16, y - 10, P.white[0]);
    for (let k = 0; k < 3; k++) for (let i = k0 + 12; i < k0 + 16; i += 2) c.set(i, y - 8 + k * 2, P.white[3]);
    if (flip >= 0) c.rect(Math.round(k0 + 16 - flip * 5), y - 11 - Math.round(Math.sin(flip * Math.PI) * 2), 2, 7, P.white[0]);
  }
}

// ======================================================================= handheld console

export class HandheldPlayer extends Figure {
  emit: Pt = [0, -30];
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
    const face = this.face(f);
    if (f.state === 'playing') face.eyes = 'down';
    drawHead(c, cx + (sleep ? 1 : 0), sy - 7 + (sleep ? 2 : 0), this.look, face);
    if (f.state === 'waiting') {
      const wave = Math.sin(f.t * 5) > 0 ? 1 : 0;
      this.console(cx, fy - 15, false);
      drawArm(c, sh.l, [cx - 6, fy - 14], this.look, -1, 7);
      drawArm(c, sh.r, [cx + 9 - wave, sy - 13], this.look, 1, 7.5, false, true);
      return;
    }
    // held up in both hands while playing, resting on the lap otherwise
    const up = f.state === 'playing' || f.state === 'reading' || f.state === 'error' || f.state === 'tuning';
    const gy = up ? sy + 8 : fy - 15;
    this.console(cx, gy, up && f.state === 'playing' && f.hitAge < 0.3);
    const p = press(f);
    const lh: Pt = [cx - 6, gy + 1 + (f.hitCount % 2 ? p : 0)];
    const rh: Pt = [cx + 6, gy + 1 + (f.hitCount % 2 ? 0 : p)];
    drawArm(c, sh.l, lh, this.look, -1, 7);
    drawArm(c, sh.r, rh, this.look, 1, 7);
    hand(c, this.look, lh);
    hand(c, this.look, rh);
  }

  /** A landscape handheld: a d-pad on the left, two buttons on the right, the screen between. */
  private console(cx: number, y: number, lit: boolean) {
    const c = this.c;
    c.rect(cx - 8, y - 3, 17, 7, CASE[1]);
    c.hline(cx - 8, cx + 8, y - 3, CASE[0]);
    c.hline(cx - 8, cx + 8, y + 3, CASE[3]);
    c.rect(cx - 3, y - 2, 7, 5, SCREEN[lit ? 1 : 3]);
    if (lit) c.rect(cx - 2, y - 1, 2, 2, SCREEN[0]);
    c.hline(cx - 7, cx - 5, y, P.black[3]);
    c.vline(cx - 6, y - 1, y + 1, P.black[3]);
    c.set(cx + 6, y - 1, NEON_PINK);
    c.set(cx + 7, y + 1, NEON_PINK);
  }
}

// ======================================================================= keytar

export class Keytarist extends Figure {
  emit: Pt = [-10, -28];
  head: Pt = [0, -42];
  constructor(look: Look) {
    super(64, 64, 34, 61, look);
    this.standSide = 1;
  }

  draw(f: Frame) {
    const c = this.c;
    const cx = this.ax + this.shake(f),
      fy = this.ay;
    if (f.seat) drawStand(c, cx + 19, fy, fy - 30, this.flip(f));
    const b = this.bob(f);
    const sleep = f.state === 'sleeping';
    drawStandingLegs(c, cx, fy, fy - 17, this.look);
    const sy = fy - 31 + b + (sleep ? 2 : 0);
    const sh = drawTorsoFront(c, cx, sy, fy - 17, this.look);
    drawHead(c, cx + (sleep ? 1 : 0), sy - 7 + (sleep ? 1 : 0), this.look, this.face(f));

    // slung across the body: the keys low on the right, the neck rising to the left
    const ky = fy - 20 + b;
    const along = (t: number): Pt => [Math.round(cx + 9 - t * 26), Math.round(ky - t * 8)];
    const p = press(f);
    let lh: Pt, rh: Pt;
    if (f.state === 'waiting') {
      const wave = Math.sin(f.t * 5) > 0 ? 1 : 0;
      lh = along(0.85);
      rh = [cx + 10 + wave, sy - 14];
      drawArm(c, sh.r, rh, this.look, 1, 7.5, false, true);
    } else {
      const key = sleep || f.state === 'idle' ? 0.2 : 0.1 + ((f.pitch - 64) / 32) * 0.3;
      lh = along(0.85);
      const [kx, kyy] = along(Math.max(0, Math.min(0.45, key)));
      rh = [kx, kyy - 1 + p];
      drawArm(c, sh.r, rh, this.look, 1, 7);
    }
    drawArm(c, sh.l, lh, this.look, -1, 8);
    c.line(sh.r[0], sh.r[1], cx + 9, ky - 1, 0x1c1418); // strap
    // the body and its keys
    for (let t = 0; t <= 0.5; t += 0.02) {
      const [x, y] = along(t);
      c.vline(x, y - 1, y + 2, NEON_PINK);
      c.set(x, y + 2, 0xa02a78);
      c.set(x, y - 1, t % 0.08 < 0.04 ? P.pianoKeys[0] : P.piano[3]);
    }
    // the neck with its handle
    for (let t = 0.5; t <= 1; t += 0.02) {
      const [x, y] = along(t);
      c.vline(x, y, y + 1, CASE[2]);
    }
    const [nx, ny] = along(1);
    c.rect(nx - 2, ny - 1, 3, 3, NEON_CYAN);
    hand(c, this.look, lh);
    if (f.state !== 'waiting') hand(c, this.look, rh);
  }
}

// ======================================================================= drum machine

export class PadDrummer extends Figure {
  emit: Pt = [0, -30];
  head: Pt = [0, -40];
  constructor(look: Look) {
    super(64, 60, 32, 57, look);
    this.standSide = -1;
  }

  draw(f: Frame) {
    const c = this.c;
    const cx = this.ax + this.shake(f),
      fy = this.ay;
    if (f.seat) drawStand(c, cx - 22, fy, fy - 26, this.flip(f));
    const b = this.bob(f);
    const sleep = f.state === 'sleeping';
    // stool, player, then the table with the machine in front
    c.rect(cx - 4, fy - 13, 9, 2, P.black[2]);
    c.vline(cx, fy - 11, fy - 1, P.black[3]);
    const sy = fy - 29 + b + (sleep ? 2 : 0);
    const sh = drawTorsoFront(c, cx, sy, fy - 13, this.look);
    drawHead(c, cx + (sleep ? 1 : 0), sy - 7 + (sleep ? 2 : 0), this.look, this.face(f));
    const ty = fy - 17;
    c.rect(cx - 15, ty, 31, 2, CASE[2]);
    c.hline(cx - 15, cx + 15, ty, CASE[1]);
    c.vline(cx - 13, ty + 2, fy - 1, CASE[3]);
    c.vline(cx + 13, ty + 2, fy - 1, CASE[3]);
    // the machine: two rows of four pads, the one just hit lights up
    c.rect(cx - 10, ty - 5, 21, 5, P.black[2]);
    c.hline(cx - 10, cx + 10, ty - 5, P.black[1]);
    const hitPad = f.state === 'playing' && f.hitAge < 0.25 ? f.hitCount % 8 : -1;
    for (let i = 0; i < 8; i++) {
      const px = cx - 9 + (i % 4) * 5,
        py = ty - 4 + (i >> 2) * 2;
      c.rect(px, py, 4, 1, i === hitPad ? (i % 2 ? NEON_CYAN : NEON_PINK) : CASE[1]);
    }
    if (f.state === 'waiting') {
      const wave = Math.sin(f.t * 5) > 0 ? 1 : 0;
      drawArm(c, sh.l, [cx - 6, ty - 6], this.look, -1, 7);
      drawArm(c, sh.r, [cx + 9 + wave, sy - 14], this.look, 1, 7.5, false, true);
      return;
    }
    if (sleep) {
      drawArm(c, sh.l, [cx - 4, ty - 5], this.look, -1, 7);
      drawArm(c, sh.r, [cx + 4, ty - 5], this.look, 1, 7);
      return;
    }
    // the hand over the lit pad taps it, the other hovers
    const p = press(f);
    const right = hitPad >= 0 ? hitPad % 4 >= 2 : f.hitCount % 2 === 0;
    const padX = hitPad >= 0 ? cx - 7 + (hitPad % 4) * 5 : right ? cx + 5 : cx - 5;
    const think = f.state === 'tuning' ? Math.round(Math.sin(f.t * 3)) : 0;
    const lh: Pt = right ? [cx - 6, ty - 8 + think] : [padX, ty - 7 + p];
    const rh: Pt = right ? [padX, ty - 7 + p] : [cx + 6, ty - 8 - think];
    drawArm(c, sh.l, lh, this.look, -1, 7);
    drawArm(c, sh.r, rh, this.look, 1, 7);
    hand(c, this.look, lh);
    hand(c, this.look, rh);
  }
}
