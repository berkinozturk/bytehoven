import { drawArm, drawChair, drawHead, drawSeatedLegs, drawStand, drawStandingLegs, drawTorsoFront, type Look, type Pt } from './figures';
import { Figure, Pianist, type Frame } from './musicians';
import { P } from './palette';
import type { PixelCanvas } from './pixel';

/** The lo-fi room's players: jazz guitar, vibraphone, bass guitar and an upright piano. */

/** A hand drawn over an instrument. */
function hand(c: PixelCanvas, look: Look, [x, y]: Pt) {
  const s = P.skin[look.skin];
  c.rect(x - 1, y - 1, 2, 2, s[1]);
  c.set(x, y, s[2]);
}

/** A string pluck/strum: how far the picking hand moves on a fresh note. */
const pluck = (f: Frame) => (f.state !== 'playing' ? 0 : f.hitAge < 0.08 ? 2 : f.hitAge < 0.22 ? 1 : 0);

// ======================================================================= jazz guitar

export class Guitarist extends Figure {
  emit: Pt = [-16, -24];
  head: Pt = [0, -34];
  constructor(look: Look) {
    super(60, 56, 32, 53, look);
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
    // guitarists look down at the neck
    const face = this.face(f);
    if (f.state === 'playing' && face.eyes === 'down') face.lookX = -1;
    drawHead(c, cx + (sleep ? 1 : 0), sy - 7 + (sleep ? 2 : 0), this.look, face);

    // a hollow-body guitar on the lap, the neck to the viewer's left
    const gx = cx + 3,
      gy = fy - 15;
    const tilt = sleep ? 2 : 0;
    c.line(gx - 4, gy - 1, cx - 19, gy - 7 + tilt, 0x2a1810);
    c.line(gx - 4, gy, cx - 19, gy - 6 + tilt, P.sunburst[3]);
    c.rect(cx - 23, gy - 9 + tilt, 4, 3, P.sunburst[4]);
    c.set(cx - 22, gy - 9 + tilt, P.silver[2]);
    c.set(cx - 20, gy - 9 + tilt, P.silver[2]);
    c.shadedEllipse(gx, gy, 7, 5.5, P.sunburst, -0.2, -0.5);
    c.ellipse(gx + 1, gy, 3.5, 2.6, P.sunburst[1]);
    // f-holes, bridge and tailpiece
    c.vline(gx - 4, gy - 2, gy, 0x2a1810);
    c.vline(gx + 5, gy - 2, gy, 0x2a1810);
    c.hline(gx, gx + 2, gy + 1, P.gold[2]);
    c.line(gx + 1, gy + 2, gx + 1, gy + 5, P.gold[3]);

    if (f.state === 'waiting') {
      const wave = Math.sin(f.t * 5) > 0 ? 1 : 0;
      drawArm(c, sh.l, [cx - 12, gy - 4], this.look, -1, 7);
      drawArm(c, sh.r, [cx + 9 - wave, sy - 13], this.look, 1, 7.5, false, true);
      hand(c, this.look, [cx - 12, gy - 4]);
      return;
    }
    if (sleep || f.state === 'idle') {
      drawArm(c, sh.l, [cx - 9, gy - 3 + tilt], this.look, -1, 7);
      drawArm(c, sh.r, [gx + 2, gy - 2], this.look, 1, 7);
      return;
    }
    // the fretting hand slides along the neck with the pitch, the picking hand strums
    const fret = Math.round(cx - 17 + ((f.pitch - 45) / 31) * 8);
    const p = pluck(f);
    const think = f.state === 'tuning' ? Math.round(Math.sin(f.t * 3)) : 0;
    const lh: Pt = [Math.min(cx - 9, fret), gy - 5 + Math.round((fret - (cx - 19)) / -4)];
    const rh: Pt = [gx + 1, gy - 3 + p + think];
    drawArm(c, sh.l, lh, this.look, -1, 7);
    drawArm(c, sh.r, rh, this.look, 1, 6.5);
    hand(c, this.look, lh);
    hand(c, this.look, rh);
    if (p) c.hline(gx - 3, gx + 3, gy - 1, P.gold[0]);
  }
}

// ======================================================================= vibraphone

export class Vibraphonist extends Figure {
  emit: Pt = [0, -30];
  head: Pt = [0, -44];
  constructor(look: Look) {
    super(72, 62, 36, 59, look);
    this.standSide = 1;
  }

  draw(f: Frame) {
    const c = this.c;
    const cx = this.ax + this.shake(f),
      fy = this.ay;
    const b = this.bob(f);
    const sleep = f.state === 'sleeping';
    // the player stands behind the instrument
    drawStandingLegs(c, cx, fy, fy - 17, this.look);
    const sy = fy - 31 + b + (sleep ? 2 : 0);
    const sh = drawTorsoFront(c, cx, sy, fy - 17, this.look);
    const face = this.face(f);
    if (f.state === 'playing' && face.eyes === 'down') face.lookX = 0;
    drawHead(c, cx + (sleep ? 1 : 0), sy - 7 + (sleep ? 2 : 0), this.look, face);

    // the frame: a long row of bars on a stand, resonator tubes below
    const top = fy - 22;
    const x0 = cx - 26,
      x1 = cx + 26;
    for (let x = x0 + 1; x < x1; x += 3) {
      const len = 9 - Math.round(((x - x0) / (x1 - x0)) * 5);
      c.vline(x, top + 3, top + 3 + len, P.silver[3]);
      c.vline(x + 1, top + 3, top + 3 + len, P.silver[4]);
    }
    c.rect(x0, top + 2, x1 - x0 + 1, 2, P.black[2]);
    c.vline(x0 + 1, top + 3, fy - 1, P.black[3]);
    c.vline(x1 - 1, top + 3, fy - 1, P.black[3]);
    c.hline(x0 + 1, x1 - 1, fy - 5, P.black[3]);
    c.rect(x0 - 1, fy - 2, 4, 2, P.black[1]);
    c.rect(x1 - 2, fy - 2, 4, 2, P.black[1]);
    // the bars, the one just struck lights up
    const struck = f.state === 'playing' && f.hitAge < 0.3 ? Math.round(((f.pitch - 55) / 33) * 16) : -1;
    for (let i = 0; i < 17; i++) {
      const bx = x0 + 1 + i * 3;
      const lit = i === struck;
      c.rect(bx, top, 2, 2, lit ? P.silver[0] : P.silver[2]);
      c.set(bx, top, lit ? P.white[0] : P.silver[1]);
    }

    if (f.state === 'waiting') {
      const wave = Math.sin(f.t * 5) > 0 ? 1 : 0;
      this.mallet(sh.l, [cx - 8, top - 2], -1);
      drawArm(c, sh.r, [cx + 10 + wave, sy - 14], this.look, 1, 7.5, false, true);
      return;
    }
    if (sleep || f.state === 'idle') {
      this.mallet(sh.l, [cx - 6, top - 1], -1, true);
      this.mallet(sh.r, [cx + 6, top - 1], 1, true);
      return;
    }
    // two mallets: the one nearer the struck bar comes down, the other hovers
    const at = struck >= 0 ? x0 + 2 + struck * 3 : cx;
    const down = f.state === 'playing' ? (f.hitAge < 0.08 ? 0 : f.hitAge < 0.3 ? Math.round(((f.hitAge - 0.08) / 0.22) * 3) : 3) : 3;
    const sway = f.state === 'tuning' ? Math.round(Math.sin(f.t * 2) * 2) : 0;
    const left = at < cx;
    this.mallet(sh.l, [left ? Math.max(x0 + 3, at) : cx - 9 + sway, top - 2 - (left ? down : 3)], -1);
    this.mallet(sh.r, [left ? cx + 9 + sway : Math.min(x1 - 3, at), top - 2 - (left ? 3 : down)], 1);
  }

  /** An arm with a mallet: a thin stick and a soft yarn head at its tip. */
  private mallet(s: Pt, [x, y]: Pt, side: 1 | -1, rest = false) {
    const c = this.c;
    const hx = x - side * 3,
      hy = y - 6;
    drawArm(c, s, [hx, hy], this.look, side, 7.5);
    c.line(hx, hy, x, y, P.wood[0]);
    c.rect(x - 1, y, 3, 2, rest ? P.shell[2] : P.shell[1]);
    c.set(x - 1, y, P.shell[0]);
    hand(c, this.look, [hx, hy]);
  }
}

// ======================================================================= bass guitar

export class BassGuitarist extends Figure {
  emit: Pt = [-12, -26];
  head: Pt = [0, -42];
  constructor(
    look: Look,
    /** The body's colour ramp (light → dark). */
    private body: number[] = P.sunburst,
  ) {
    super(64, 64, 36, 61, look);
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
    drawHead(c, cx + (sleep ? -1 : 0), sy - 7 + (sleep ? 1 : 0), this.look, this.face(f));

    // arms behind the bass, hands on top
    const by = fy - 21 + b;
    const bx = cx + 3;
    const p = pluck(f);
    const neckY = (x: number) => Math.round(by - 3 - ((bx - x) / 26) * 9);
    let lh: Pt, rh: Pt;
    if (f.state === 'waiting') {
      const wave = Math.sin(f.t * 5) > 0 ? 1 : 0;
      lh = [cx - 12, neckY(cx - 12)];
      rh = [cx + 10 + wave, sy - 14];
      drawArm(c, sh.r, rh, this.look, 1, 7.5, false, true);
    } else {
      const fret = sleep || f.state === 'idle' ? cx - 12 : Math.round(cx - 20 + ((f.pitch - 28) / 22) * 10);
      lh = [fret, neckY(fret)];
      rh = [bx + 1, by - 1 + p];
      drawArm(c, sh.r, rh, this.look, 1, 7);
    }
    drawArm(c, sh.l, lh, this.look, -1, 8);
    // the strap, the body slung low, the long neck rising to the viewer's left
    c.line(sh.r[0], sh.r[1], bx + 6, by - 2, 0x1c1418);
    c.line(bx - 3, by - 2, cx - 23, neckY(cx - 23), 0x2a1810);
    c.line(bx - 3, by - 1, cx - 23, neckY(cx - 23) + 1, P.wood[2]);
    c.rect(cx - 27, neckY(cx - 23) - 2, 4, 3, P.black[2]);
    c.shadedEllipse(bx + 1, by, 6, 5, this.body, -0.3, -0.6);
    c.shadedEllipse(bx + 4, by + 2, 4.5, 4, this.body, -0.3, -0.6);
    c.ellipse(bx + 2, by + 1, 2.5, 2, P.white[1]); // pickguard
    c.rect(bx - 2, by - 2, 3, 2, P.black[2]); // pickup
    c.hline(bx + 2, bx + 4, by + 2, P.silver[2]); // bridge
    if (p) c.line(bx - 3, by - 1, bx + 3, by + 1, P.gold[0]);
    hand(c, this.look, lh);
    if (f.state !== 'waiting') hand(c, this.look, rh);
  }
}

// ======================================================================= upright piano

/** The pianist in profile at an old upright piano with a little plant on top. */
export class UprightPianist extends Pianist {
  emit: Pt = [22, -44];

  protected drawPiano(k0: number, fy: number, f: Frame) {
    const c = this.c;
    const pc = P.upright;
    const front = k0 + 9,
      back = k0 + 22;
    const top = fy - 46;
    // the cabinet in profile: front panel, side, a lid with a lip
    for (let y = top; y < fy; y++) {
      for (let x = front; x <= back; x++) c.set(x, y, x === front ? pc[1] : x === back ? pc[4] : (x + y) % 9 === 0 ? pc[3] : pc[2]);
    }
    c.rect(front - 1, top - 2, back - front + 3, 2, pc[1]);
    c.hline(front - 1, back + 1, top - 2, pc[0]);
    // a panel line and the toe block
    c.vline(front + 3, top + 4, fy - 30, pc[3]);
    c.vline(front + 3, fy - 18, fy - 4, pc[3]);
    c.rect(k0 + 4, fy - 4, 6, 4, pc[3]);
    c.hline(k0 + 4, k0 + 9, fy - 4, pc[1]);
    // the keyboard shelf
    c.rect(k0 - 1, fy - 22, front - k0 + 1, 3, pc[2]);
    c.hline(k0 - 1, front, fy - 22, pc[1]);
    c.hline(k0, front - 1, fy - 24, P.pianoKeys[1]);
    c.hline(k0, front - 1, fy - 23, P.pianoKeys[0]);
    for (let k = k0 + 1; k < front; k += 2) if (k % 7 !== 3) c.set(k, fy - 24, P.piano[3]);
    // the music on its desk
    const flip = this.flip(f);
    c.rect(front - 6, fy - 35, 6, 8, P.white[1]);
    c.hline(front - 6, front - 1, fy - 35, P.white[0]);
    for (let k = 0; k < 3; k++) for (let i = front - 5; i < front - 1; i += 2) c.set(i, fy - 33 + k * 2, P.white[3]);
    if (flip >= 0) {
      const w = Math.max(1, Math.round(Math.abs(Math.cos(flip * Math.PI)) * 3));
      c.rect(Math.round(front - 1 - flip * 5) - (flip < 0.5 ? w : 0), fy - 36 - Math.round(Math.sin(flip * Math.PI) * 2), w + 1, 7, P.white[0]);
    }
    // a little plant in a pot on top
    c.rect(back - 7, top - 6, 5, 4, 0xb8643a);
    c.hline(back - 8, back - 2, top - 6, 0xd88050);
    for (const [dx, dy] of [[-6, -9], [-5, -11], [-4, -8], [-3, -10], [-2, -9], [-5, -8], [-4, -12]] as Pt[]) c.set(back + dx, top + dy, (dx + dy) % 2 ? 0x5a9a4a : 0x3a7a3a);
  }
}
