/**
 * A tiny pixel-art toolkit. Everything on Bytehoven's stage is drawn with it,
 * pixel by pixel, into small canvases that PixiJS then shows with nearest
 * neighbour scaling. No external sprite sheets: the art is code, so it is
 * ours to license (MIT) and easy to theme.
 */

const pack = (c: number, a = 255) => ((a << 24) | ((c & 0xff) << 16) | (c & 0xff00) | ((c >> 16) & 0xff)) >>> 0;

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
export const bayer = (x: number, y: number) => BAYER4[(y & 3) * 4 + (x & 3)];

export class PixelCanvas {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private img: ImageData;
  readonly buf: Uint32Array;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: false })!;
    this.img = this.ctx.createImageData(w, h);
    this.buf = new Uint32Array(this.img.data.buffer);
  }

  clear() {
    this.buf.fill(0);
  }

  set(x: number, y: number, c: number) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.buf[y * this.w + x] = pack(c);
  }

  /** Translucent pixel blended over what is there. */
  blend(x: number, y: number, c: number, a: number) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    const d = this.buf[i];
    const da = d >>> 24;
    if (!da) {
      this.buf[i] = pack(c, Math.round(a * 255));
      return;
    }
    const dr = d & 0xff,
      dg = (d >> 8) & 0xff,
      db = (d >> 16) & 0xff;
    const r = (c >> 16) & 0xff,
      g = (c >> 8) & 0xff,
      b = c & 0xff;
    const nr = Math.round(dr + (r - dr) * a),
      ng = Math.round(dg + (g - dg) * a),
      nb = Math.round(db + (b - db) * a);
    this.buf[i] = ((da << 24) | (nb << 16) | (ng << 8) | nr) >>> 0;
  }

  erase(x: number, y: number) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.buf[y * this.w + x] = 0;
  }

  opaque(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    return this.buf[y * this.w + x] >>> 24 > 0;
  }

  rect(x: number, y: number, w: number, h: number, c: number) {
    x = Math.round(x);
    y = Math.round(y);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }

  hline(x0: number, x1: number, y: number, c: number) {
    if (x1 < x0) [x0, x1] = [x1, x0];
    for (let x = Math.round(x0); x <= Math.round(x1); x++) this.set(x, y, c);
  }

  vline(x: number, y0: number, y1: number, c: number) {
    if (y1 < y0) [y0, y1] = [y1, y0];
    for (let y = Math.round(y0); y <= Math.round(y1); y++) this.set(x, y, c);
  }

  line(x0: number, y0: number, x1: number, y1: number, c: number, t = 1) {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0),
      dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1,
      sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      if (t === 1) this.set(x0, y0, c);
      else this.rect(x0 - ((t - 1) >> 1), y0 - ((t - 1) >> 1), t, t, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, c: number) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x + 0.5 - cx) / (rx + 0.25),
          ny = (y + 0.5 - cy) / (ry + 0.25);
        if (nx * nx + ny * ny <= 1) this.set(x, y, c);
      }
    }
  }

  /**
   * Ellipse lit from the top-left with a tone ramp (light → dark).
   * `tones` from brightest to darkest.
   */
  shadedEllipse(cx: number, cy: number, rx: number, ry: number, tones: number[], lx = -0.55, ly = -0.75, dither = true) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x + 0.5 - cx) / (rx + 0.25),
          ny = (y + 0.5 - cy) / (ry + 0.25);
        const d = nx * nx + ny * ny;
        if (d > 1) continue;
        const nz = Math.sqrt(1 - d);
        const lit = Math.max(0, -(nx * lx + ny * ly) * 0.8 + nz * 0.45); // 0..~1
        let v = (1 - lit) * (tones.length - 1);
        if (dither) v += bayer(x, y) - 0.5;
        const k = Math.max(0, Math.min(tones.length - 1, Math.round(v)));
        this.set(x, y, tones[k]);
      }
    }
  }

  poly(pts: Array<[number, number]>, c: number) {
    let minY = Infinity,
      maxY = -Infinity;
    for (const [, y] of pts) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[(i + 1) % pts.length];
        const yy = y + 0.5;
        if ((y0 <= yy && y1 > yy) || (y1 <= yy && y0 > yy)) xs.push(x0 + ((yy - y0) / (y1 - y0)) * (x1 - x0));
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        for (let x = Math.round(xs[i]); x < Math.round(xs[i + 1]); x++) this.set(x, y, c);
      }
    }
  }

  /** Vertical dithered gradient between palette tones. */
  vgrad(x: number, y: number, w: number, h: number, tones: number[]) {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const v = (j / Math.max(1, h - 1)) * (tones.length - 1) + bayer(x + i, y + j) - 0.5;
        this.set(x + i, y + j, tones[Math.max(0, Math.min(tones.length - 1, Math.round(v)))]);
      }
    }
  }

  /** 1px exterior outline around every opaque shape. */
  outline(c: number) {
    const { w, h } = this;
    const src = this.buf.slice();
    const oc = pack(c);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (src[i] >>> 24) continue;
        const n =
          (x > 0 && src[i - 1] >>> 24) ||
          (x < w - 1 && src[i + 1] >>> 24) ||
          (y > 0 && src[i - w] >>> 24) ||
          (y < h - 1 && src[i + w] >>> 24);
        if (n) this.buf[i] = oc;
      }
    }
  }

  /** Draw another canvas' pixels on top (opaque pixels only). */
  stamp(src: PixelCanvas, ox: number, oy: number, flipX = false) {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const v = src.buf[y * src.w + (flipX ? src.w - 1 - x : x)];
        if (!(v >>> 24)) continue;
        const tx = ox + x,
          ty = oy + y;
        if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) continue;
        this.buf[ty * this.w + tx] = v;
      }
    }
  }

  flush(): HTMLCanvasElement {
    this.ctx.putImageData(this.img, 0, 0);
    return this.canvas;
  }
}

/** Mix two 0xRRGGBB colours. */
export function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255,
    ag = (a >> 8) & 255,
    ab = a & 255;
  const br = (b >> 16) & 255,
    bg = (b >> 8) & 255,
    bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}

/** Small deterministic PRNG so the hall is identical on every load. */
export function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
