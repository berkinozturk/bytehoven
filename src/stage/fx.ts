import { Container, Sprite, Texture } from 'pixi.js';
import { PixelCanvas } from './pixel';

/** Smooth (non-pixel) light textures, generated once with canvas gradients. */
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): Texture {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d')!);
  return Texture.from(cv);
}

let cache: ReturnType<typeof build> | null = null;
export const textures = () => (cache ??= build());

function pixelTex(p: PixelCanvas): Texture {
  const t = Texture.from(p.flush());
  t.source.scaleMode = 'nearest';
  return t;
}

function glyph(rows: string[]): Texture {
  const p = new PixelCanvas(rows[0].length, rows.length);
  rows.forEach((r, y) => [...r].forEach((ch, x) => ch !== '.' && p.set(x, y, ch === '#' ? 0xffffff : 0xb8b8b8)));
  return pixelTex(p);
}

function build() {
  const cone = canvasTex(128, 256, (g) => {
    for (let y = 0; y < 256; y++) {
      const t = y / 255;
      const half = 6 + t * 58;
      const a = 0.55 * (1 - t * 0.55) * Math.min(1, t * 6);
      const grad = g.createLinearGradient(64 - half, 0, 64 + half, 0);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.25, `rgba(255,255,255,${a * 0.6})`);
      grad.addColorStop(0.5, `rgba(255,255,255,${a})`);
      grad.addColorStop(0.75, `rgba(255,255,255,${a * 0.6})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(64 - half, y, half * 2, 1);
    }
  });
  const pool = canvasTex(256, 96, (g) => {
    g.save();
    g.scale(1, 96 / 256);
    const r = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    r.addColorStop(0, 'rgba(255,255,255,0.9)');
    r.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 256, 256);
    g.restore();
  });
  const glow = canvasTex(64, 64, (g) => {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.2, 'rgba(255,255,255,0.55)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
  });
  const vignette = canvasTex(512, 512, (g) => {
    const r = g.createRadialGradient(256, 230, 120, 256, 256, 380);
    r.addColorStop(0, 'rgba(0,0,0,0)');
    r.addColorStop(1, 'rgba(0,0,0,0.85)');
    g.fillStyle = r;
    g.fillRect(0, 0, 512, 512);
  });
  return {
    cone,
    pool,
    glow,
    vignette,
    note1: glyph(['..##', '..#.#', '..#..', '..#..', '###..', '###..', '.#...'].map((r) => r.padEnd(5, '.'))),
    note2: glyph(['..#####', '..#...#', '..#...#', '..#...#', '###.###', '###.###', '.#...#.']),
    note3: glyph(['...#', '...#', '...#', '...#', '.###', '####', '.##.']),
    sparkle: glyph(['..#..', '..#..', '##+##', '..#..', '..#..'].map((r) => r.replace('+', '#'))),
    dot: glyph(['#']),
    dot2: glyph(['##', '##']),
    z: glyph(['####', '..#.', '.#..', '####']),
    shard: glyph(['#.', '##', '.#']),
    question: glyph(['.##.', '#..#', '...#', '..#.', '..#.', '....', '..#.']),
    fermata: glyph([
      '...#######...',
      '.##.......##.',
      '#...........#',
      '#.....#.....#',
      '.....###.....',
      '......#......',
    ]),
  };
}

// ------------------------------------------------------------------ particles

export type PKind = 'note' | 'dust' | 'spark' | 'z' | 'shard' | 'think' | 'ember';

interface Particle {
  s: Sprite;
  kind: PKind;
  vx: number;
  vy: number;
  ax: number;
  ay: number;
  life: number;
  age: number;
  sway: number;
  phase: number;
  spin: number;
  a0: number;
  scale0: number;
  scale1: number;
}

export class Particles {
  readonly layer = new Container();
  private live: Particle[] = [];
  private pool: Sprite[] = [];

  spawn(kind: PKind, tex: Texture, x: number, y: number, o: Partial<Omit<Particle, 's' | 'kind'>> & { tint?: number } = {}) {
    const s = this.pool.pop() ?? new Sprite();
    s.texture = tex;
    s.anchor.set(0.5);
    s.position.set(x, y);
    s.tint = o.tint ?? 0xffffff;
    s.blendMode = 'add';
    s.rotation = 0;
    s.visible = true;
    this.layer.addChild(s);
    const p: Particle = {
      s,
      kind,
      vx: o.vx ?? 0,
      vy: o.vy ?? -10,
      ax: o.ax ?? 0,
      ay: o.ay ?? 0,
      life: o.life ?? 1.5,
      age: 0,
      sway: o.sway ?? 0,
      phase: o.phase ?? Math.random() * 6.28,
      spin: o.spin ?? 0,
      a0: o.a0 ?? 1,
      scale0: o.scale0 ?? 1,
      scale1: o.scale1 ?? 1,
    };
    s.alpha = p.a0;
    s.scale.set(p.scale0);
    this.live.push(p);
  }

  update(dt: number) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.age += dt;
      if (p.age >= p.life) {
        p.s.visible = false;
        this.layer.removeChild(p.s);
        this.pool.push(p.s);
        this.live.splice(i, 1);
        continue;
      }
      p.vx += p.ax * dt;
      p.vy += p.ay * dt;
      const k = p.age / p.life;
      p.s.x += (p.vx + Math.cos(p.phase + p.age * 3) * p.sway) * dt;
      p.s.y += p.vy * dt;
      p.s.rotation += p.spin * dt;
      const fadeIn = Math.min(1, p.age / 0.12);
      const fadeOut = p.kind === 'dust' ? Math.sin(k * Math.PI) : 1 - k * k;
      p.s.alpha = p.a0 * fadeIn * fadeOut;
      p.s.scale.set(p.scale0 + (p.scale1 - p.scale0) * k);
    }
  }

  get count() {
    return this.live.length;
  }
}
