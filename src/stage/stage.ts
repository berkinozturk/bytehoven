import { AdvancedBloomFilter } from 'pixi-filters';
import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { NoteInfo } from '../audio/engine';
import type { AgentEvent, AgentInfo } from '../core/events';
import { Particles, textures } from './fx';
import type { Look } from './figures';
import { H, W, drawAudience, drawClosedCurtain, drawFrontDrapes, drawHall } from './hall';
import { Conductor, makeFigure, type Figure, type Frame, type MState } from './musicians';
import type { PixelCanvas } from './pixel';

export interface Seat {
  x: number;
  y: number;
  color: number;
  look: Look;
}

interface View {
  info: AgentInfo;
  seat: Seat;
  fig: Figure;
  tex: Texture;
  sprite: Sprite;
  seatGhost?: Sprite;
  cone: Sprite;
  pool: Sprite;
  state: MState;
  stateSince: number;
  lastActivity: number;
  hitAt: number;
  hitCount: number;
  hitVel: number;
  pitch: number;
  readAt: number;
  resolveAt: number;
  errorAt: number;
  light: number; // current spot intensity (smoothed)
  pulse: number; // short flash on notes
  /** walking on/off stage */
  walk: { from: number; to: number; start: number; dur: number; leaving: boolean } | null;
  alpha: number;
  removeAt?: number;
  lastDraw: number;
}

const now = () => performance.now() / 1000;

function pixelTexture(p: PixelCanvas): Texture {
  const t = Texture.from(p.flush());
  t.source.scaleMode = 'nearest';
  return t;
}

export interface BeatInfo {
  phase: number;
  beat: number;
  running: boolean;
}

export class Stage {
  readonly app = new Application();
  private world = new Container();
  private musicians = new Container();
  private fx = new Container();
  private lights = new Container();
  private particles = new Particles();
  private darkness = new Graphics();
  /** The musician in the spotlight during a fermata is lifted above the darkness. */
  private spotLayer = new Container();
  private lifted: View | null = null;
  private flash = new Graphics();
  private views = new Map<string, View>();
  private curtainL!: Sprite;
  private curtainR!: Sprite;
  private conductor = new Conductor();
  private conductorTex!: Texture;
  private conductorSprite!: Sprite;
  private fermataSign!: Sprite;
  private fermataGlow!: Sprite;
  private vignette!: Sprite;
  private bloom!: AdvancedBloomFilter;

  private scale = 1;
  private cam = { x: W / 2, y: H / 2, z: 1 };
  private curtainOpen = 0;
  private curtainAnim: { start: number; dur: number } | null = null;
  private dim = 0.3;
  private shakeUntil = 0;
  private flashA = 0;
  private flashColor = 0xffffff;
  private tapAt = -10;
  private cueAt = -10;
  private selected: string | null = null;
  private focusId: string | null = null;
  private lastT = now();

  /** Provided by the app each frame. */
  beat: () => BeatInfo = () => ({ phase: 0, beat: 0, running: false });
  tension: () => { value: number; agent: string | null } = () => ({ value: 0, agent: null });
  onSelect: (id: string | null) => void = () => {};

  async init(host: HTMLElement) {
    await this.app.init({
      resizeTo: host,
      background: 0x07040a,
      antialias: false,
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      powerPreference: 'high-performance',
    });
    host.appendChild(this.app.canvas);
    const T = textures();

    // ---- static layers
    const hall = new Sprite(pixelTexture(drawHall()));
    this.world.addChild(hall);
    // warm sconce glows and a faint organ halo
    for (const [x, y, s, tint, a] of [
      [64, 58, 0.9, 0xffb86a, 0.75],
      [W - 64, 58, 0.9, 0xffb86a, 0.75],
      [192, 60, 3.2, 0xffd59a, 0.12],
    ] as const) {
      const g = new Sprite(T.glow);
      g.anchor.set(0.5);
      g.position.set(x, y);
      g.scale.set(s);
      g.tint = tint;
      g.alpha = a;
      g.blendMode = 'add';
      this.world.addChild(g);
    }
    this.musicians.sortableChildren = true;
    this.world.addChild(this.musicians);

    this.conductorTex = pixelTexture(this.conductor.c);
    this.conductorSprite = new Sprite(this.conductorTex);
    this.conductorSprite.anchor.set(this.conductor.ax / this.conductor.c.w, this.conductor.ay / this.conductor.c.h);
    this.conductorSprite.position.set(W / 2, H + 1);

    const drapes = new Sprite(pixelTexture(drawFrontDrapes()));
    this.world.addChild(drapes);
    this.world.addChild(this.darkness);
    this.world.addChild(this.spotLayer);

    this.lights.blendMode = 'add';
    this.fx.addChild(this.lights);
    this.fx.addChild(this.particles.layer);
    this.bloom = new AdvancedBloomFilter({ threshold: 0.3, bloomScale: 0.9, brightness: 1, blur: 4, quality: 5 });
    this.fx.filters = [this.bloom];
    this.world.addChild(this.fx);

    // fermata sign (the brand mark) hovering above a waiting musician
    this.fermataGlow = new Sprite(T.glow);
    this.fermataGlow.anchor.set(0.5);
    this.fermataGlow.blendMode = 'add';
    this.fermataGlow.tint = 0xffd27a;
    this.fermataSign = new Sprite(T.fermata);
    this.fermataSign.anchor.set(0.5);
    this.fermataSign.tint = 0xe8b45a;
    this.fermataSign.blendMode = 'add';
    this.fermataSign.visible = this.fermataGlow.visible = false;
    this.fx.addChild(this.fermataGlow, this.fermataSign);

    this.world.addChild(this.conductorSprite);
    const audience = new Sprite(pixelTexture(drawAudience()));
    this.world.addChild(audience);

    this.curtainL = new Sprite(pixelTexture(drawClosedCurtain('left')));
    this.curtainR = new Sprite(pixelTexture(drawClosedCurtain('right')));
    this.curtainR.x = W / 2 - 6;
    this.world.addChild(this.curtainL, this.curtainR);
    this.world.addChild(this.flash);

    this.app.stage.addChild(this.world);
    this.vignette = new Sprite(T.vignette);
    this.app.stage.addChild(this.vignette);

    // dust in the air, always
    for (let i = 0; i < 40; i++) this.spawnDust(true);

    // Only musicians (and the hall behind them, for deselecting) take clicks.
    // The root stays passive: a 'static' root makes Pixi treat every full-screen
    // overlay (vignette, darkness) as a hit and swallow the clicks.
    this.app.stage.eventMode = 'passive';
    this.vignette.eventMode = 'none';
    hall.eventMode = 'static';
    hall.on('pointertap', () => this.select(null));
    this.app.ticker.add(() => this.update());
  }

  // ------------------------------------------------------------------ musicians

  addMusician(info: AgentInfo, seat: Seat, opts: { walkIn?: boolean } = {}) {
    const fig = makeFigure(info.instrument, seat.look);
    const tex = pixelTexture(fig.c);
    const sprite = new Sprite(tex);
    sprite.anchor.set(fig.ax / fig.c.w, fig.ay / fig.c.h);
    sprite.position.set(seat.x, seat.y);
    sprite.zIndex = seat.y;
    sprite.eventMode = 'static';
    sprite.cursor = 'pointer';
    sprite.on('pointertap', (e) => {
      e.stopPropagation();
      this.select(info.id);
    });
    this.musicians.addChild(sprite);
    const T = textures();
    const cone = new Sprite(T.cone);
    cone.anchor.set(0.5, 0);
    cone.tint = 0xffd9a0;
    const pool = new Sprite(T.pool);
    pool.anchor.set(0.5);
    pool.tint = 0xffd9a0;
    this.lights.addChild(cone, pool);
    const t = now();
    const v: View = {
      info,
      seat,
      fig,
      tex,
      sprite,
      cone,
      pool,
      state: 'tuning',
      stateSince: t,
      lastActivity: t,
      hitAt: -10,
      hitCount: 0,
      hitVel: 0,
      pitch: 64,
      readAt: -10,
      resolveAt: -10,
      errorAt: -10,
      light: 0,
      pulse: 0,
      walk: null,
      alpha: 1,
      lastDraw: 0,
    };
    if (opts.walkIn) {
      // the chair and stand appear first, then the musician walks on from the wings
      const ghost = makeFigure(info.instrument, seat.look);
      ghost.render(this.frameFor(v, t, { seat: true, ghostOnly: true }));
      v.seatGhost = new Sprite(pixelTexture(ghost.c));
      v.seatGhost.anchor.copyFrom(sprite.anchor);
      v.seatGhost.position.set(seat.x, seat.y);
      v.seatGhost.zIndex = seat.y - 0.5;
      v.seatGhost.alpha = 0;
      this.musicians.addChild(v.seatGhost);
      for (let i = 0; i < 18; i++) {
        this.particles.spawn('spark', T.sparkle, seat.x + (Math.random() - 0.5) * 26, seat.y - Math.random() * 30, {
          vy: -6 - Math.random() * 10,
          life: 1 + Math.random(),
          tint: seat.color,
          scale0: 0.6,
          scale1: 0.1,
          spin: 2,
        });
      }
      v.walk = { from: 26, to: seat.x, start: t + 0.6, dur: Math.abs(seat.x - 26) / 32, leaving: false };
      v.state = 'walking';
      sprite.x = 26;
    }
    this.views.set(info.id, v);
  }

  removeMusician(id: string) {
    const v = this.views.get(id);
    if (!v) return;
    const t = now();
    v.walk = { from: v.seat.x, to: 20, start: t + 0.3, dur: Math.abs(v.seat.x - 20) / 34, leaving: true };
    this.setState(v, 'walking');
  }

  // ------------------------------------------------------------------ events

  onAgentEvent(ev: AgentEvent) {
    const v = this.views.get(ev.agentId);
    if (!v) return;
    const t = now();
    v.lastActivity = t;
    switch (ev.kind) {
      case 'file_read':
        v.readAt = t;
        if (v.state !== 'waiting' && v.state !== 'walking') this.setState(v, 'reading');
        break;
      case 'tool_start':
      case 'file_write':
      case 'bash':
        if (v.state !== 'waiting' && v.state !== 'walking' && v.state !== 'error') this.setState(v, 'playing');
        break;
      case 'thinking':
        if (v.state !== 'waiting' && v.state !== 'walking' && v.state !== 'error') this.setState(v, 'tuning');
        this.thinkPuff(v);
        break;
      case 'idle':
        this.setState(v, 'idle');
        break;
      case 'permission_request':
        this.setState(v, 'waiting');
        break;
      case 'permission_resolved':
        this.setState(v, 'playing');
        v.resolveAt = t + 0.3;
        break;
      case 'test_fail':
      case 'error':
        v.errorAt = t;
        break;
      case 'test_pass':
      case 'task_done':
        v.resolveAt = t + 0.4;
        this.setState(v, 'playing');
        break;
    }
  }

  /** Called exactly when a note sounds (scheduled through Tone.Draw). */
  onNote(n: NoteInfo) {
    const T = textures();
    const t = now();
    if (n.agentId === '__baton') {
      this.tapAt = t;
      return;
    }
    if (n.agentId === '__heartbeat') {
      this.flashA = Math.max(this.flashA, 0.03 + n.velocity * 0.05);
      this.flashColor = 0xff5a3a;
      return;
    }
    if (n.agentId === '__intro') {
      const vs = [...this.views.values()];
      const v = vs[Math.floor(Math.random() * vs.length)];
      if (v && this.curtainOpen > 0.3) this.emitNotes(v, 1, 0.4);
      return;
    }
    if (n.agentId === '__all') {
      this.cueAt = t;
      for (const v of this.views.values()) {
        v.hitAt = t;
        v.hitVel = 0.8;
        v.hitCount++;
        v.pulse = 1;
        this.emitNotes(v, 3, 0.9);
      }
      this.burst(W / 2, 150, 0xffe2a0, 30);
      return;
    }
    const v = this.views.get(n.agentId);
    if (!v) return;
    if (n.kind === 'tuning') {
      this.thinkPuff(v);
      return;
    }
    v.hitAt = t;
    v.hitCount++;
    v.hitVel = n.velocity;
    if (n.midis.length) v.pitch = n.midis[n.midis.length - 1];
    v.pulse = Math.min(1, v.pulse + 0.35 + n.velocity * 0.6);
    switch (n.kind) {
      case 'test_fail':
      case 'error':
        this.setState(v, 'error');
        v.errorAt = t;
        this.shakeUntil = t + 0.45;
        this.flashA = 0.22;
        this.flashColor = 0xff2a2a;
        for (let i = 0; i < 16; i++) {
          const [ex, ey] = this.emitPoint(v);
          this.particles.spawn('shard', T.shard, ex, ey, {
            vx: (Math.random() - 0.5) * 70,
            vy: -20 - Math.random() * 40,
            ay: 80,
            life: 0.9 + Math.random() * 0.5,
            tint: 0xff4a4a,
            spin: (Math.random() - 0.5) * 12,
          });
        }
        break;
      case 'resolve':
        this.cueAt = t;
        this.flashA = n.velocity > 0.7 ? 0.42 : 0.15;
        this.flashColor = n.velocity > 0.7 ? 0xfff0c8 : 0x9ab0ff;
        v.resolveAt = t;
        this.burst(v.seat.x, v.seat.y - 30, n.velocity > 0.7 ? 0xffe08a : 0xa8b8ff, n.velocity > 0.7 ? 60 : 20);
        for (const o of this.views.values()) this.emitNotes(o, 2, 0.8);
        break;
      case 'test_pass':
      case 'task_done':
        if (n.index > 0) {
          this.burst(v.seat.x, v.seat.y - 30, v.seat.color, 26);
          v.resolveAt = t;
        }
        this.emitNotes(v, 2, 0.9);
        break;
      case 'subagent_join':
        break;
      case 'permission_request':
        this.emitNotes(v, 2, 0.6);
        break;
      default:
        this.emitNotes(v, n.kind === 'file_write' || n.midis.length > 1 ? 2 : 1, n.velocity);
    }
  }

  // ------------------------------------------------------------------ public helpers

  openCurtains(dur = 3.4) {
    this.curtainAnim = { start: now(), dur };
  }

  select(id: string | null) {
    this.selected = id;
    this.onSelect(id);
  }

  /** Screen position (CSS px, relative to the canvas) of a musician's head. */
  screenPos(id: string): { x: number; y: number } | null {
    const v = this.views.get(id);
    if (!v) return null;
    const p = this.world.toGlobal({ x: v.sprite.x + v.fig.head[0], y: v.sprite.y + v.fig.head[1] });
    return { x: p.x, y: p.y };
  }

  /** Put one musician in the spotlight (used by the first-run tour). */
  focus(id: string | null) {
    this.focusId = id;
  }

  /** Bounds of a musician, or of the conductor ('__conductor'), in canvas CSS pixels. */
  screenRect(id: string): { x: number; y: number; w: number; h: number } | null {
    const sprite = id === '__conductor' ? this.conductorSprite : this.views.get(id)?.sprite;
    if (!sprite) return null;
    const b = sprite.getBounds();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }

  stateOf(id: string): MState | undefined {
    return this.views.get(id)?.state;
  }

  get worldScale() {
    return this.scale * this.cam.z;
  }

  // ------------------------------------------------------------------ internals

  private setState(v: View, s: MState) {
    if (v.state === s) return;
    v.state = s;
    v.stateSince = now();
  }

  private emitPoint(v: View): [number, number] {
    return [v.sprite.x + v.fig.emit[0], v.sprite.y + v.fig.emit[1]];
  }

  private emitNotes(v: View, count: number, vel: number) {
    const T = textures();
    const [x, y] = this.emitPoint(v);
    for (let i = 0; i < count; i++) {
      const tex = [T.note1, T.note2, T.note3][Math.floor(Math.random() * 3)];
      this.particles.spawn('note', tex, x + (Math.random() - 0.5) * 6, y, {
        vx: (Math.random() - 0.5) * 8,
        vy: -14 - vel * 16 - Math.random() * 6,
        sway: 6 + Math.random() * 6,
        life: 1.6 + vel,
        tint: v.seat.color,
        a0: 0.55 + vel * 0.45,
        scale0: 0.75 + vel * 0.35,
        scale1: 0.5,
      });
    }
  }

  private thinkPuff(v: View) {
    const T = textures();
    const x = v.sprite.x + v.fig.head[0] + 6,
      y = v.sprite.y + v.fig.head[1] - 6;
    for (let i = 0; i < 3; i++) {
      this.particles.spawn('think', T.dot2, x + i * 3, y - i * 2, {
        vy: -4,
        life: 1.6,
        a0: 0.35,
        tint: 0xd8d0ff,
        scale0: 0.5 + i * 0.15,
        scale1: 0.6 + i * 0.2,
        phase: i,
      });
    }
  }

  private burst(x: number, y: number, tint: number, n: number) {
    const T = textures();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 20 + Math.random() * 70;
      this.particles.spawn('spark', Math.random() < 0.3 ? T.sparkle : T.dot2, x, y, {
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 20,
        ay: 30,
        life: 1 + Math.random() * 1.2,
        tint,
        scale0: 0.8,
        scale1: 0.1,
        spin: (Math.random() - 0.5) * 6,
      });
    }
  }

  private spawnDust(anywhere = false) {
    const T = textures();
    const views = [...this.views.values()];
    let x = 40 + Math.random() * (W - 80);
    let y = 20 + Math.random() * 160;
    if (!anywhere && views.length && Math.random() < 0.7) {
      const v = views[Math.floor(Math.random() * views.length)];
      x = v.seat.x + (Math.random() - 0.5) * 30;
      y = v.seat.y - 20 - Math.random() * 90;
    }
    this.particles.spawn('dust', T.dot, x, y, {
      vx: (Math.random() - 0.5) * 2,
      vy: -1 - Math.random() * 2,
      sway: 2,
      life: 4 + Math.random() * 5,
      a0: 0.25 + Math.random() * 0.4,
      tint: 0xffe3b8,
    });
  }

  private frameFor(v: View, t: number, o: { seat?: boolean; ghostOnly?: boolean } = {}): Frame {
    const b = this.beat();
    return {
      t,
      beatPhase: b.phase,
      running: b.running,
      state: o.ghostOnly ? 'idle' : v.state,
      stateAge: t - v.stateSince,
      hitAge: t - v.hitAt,
      hitCount: v.hitCount,
      hitVel: v.hitVel,
      pitch: v.pitch,
      readAge: t - v.readAt,
      resolveAge: t - v.resolveAt,
      walk: v.walk ? ((t - v.walk.start) * 1.6) % 1 : 0,
      seat: o.seat ?? !v.seatGhost,
    };
  }

  private autoState(v: View, t: number) {
    const quiet = t - v.lastActivity;
    if (v.state === 'error' && t - v.stateSince > 3.2) this.setState(v, 'tuning');
    if (v.state === 'reading' && t - v.readAt > 1.3) this.setState(v, 'playing');
    if (v.state === 'playing' && t - v.hitAt > 3.5 && quiet > 3.5) this.setState(v, 'tuning');
    if (v.state === 'tuning' && quiet > 14) this.setState(v, 'idle');
    if (v.state === 'idle' && t - v.stateSince > 5) this.setState(v, 'sleeping');
  }

  private layout() {
    const sw = this.app.screen.width,
      sh = this.app.screen.height;
    this.scale = Math.min(sw / W, sh / H);
    const z = this.scale * this.cam.z;
    this.world.scale.set(z);
    let x = sw / 2 - this.cam.x * z;
    let y = sh / 2 - this.cam.y * z;
    const t = now();
    if (t < this.shakeUntil) {
      x += (Math.random() - 0.5) * 3 * this.scale;
      y += (Math.random() - 0.5) * 2 * this.scale;
    }
    this.world.position.set(x, y);
    this.vignette.width = sw;
    this.vignette.height = sh;
  }

  private update() {
    const t = now();
    const dt = Math.min(0.05, t - this.lastT);
    this.lastT = t;
    const T = textures();
    const { value: tension, agent: fermataAgent } = this.tension();
    const beat = this.beat();

    // ---- curtains
    if (this.curtainAnim) {
      const k = Math.min(1, (t - this.curtainAnim.start) / this.curtainAnim.dur);
      this.curtainOpen = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      if (k >= 1) this.curtainAnim = null;
    }
    this.curtainL.x = -this.curtainOpen * (W / 2 + 10);
    this.curtainR.x = W / 2 - 6 + this.curtainOpen * (W / 2 + 10);
    this.curtainL.visible = this.curtainR.visible = this.curtainOpen < 1;

    // ---- camera: lean in on a fermata, or on the musician the tour introduces
    const target = fermataAgent ? (this.views.get(fermataAgent) ?? null) : null;
    const focusView = !target && this.focusId ? (this.views.get(this.focusId) ?? null) : null;
    const spot = target ?? focusView;
    const focus = target ? Math.min(1, tension * 1.6) : focusView ? 0.8 : 0;
    const tx = spot ? W / 2 + (spot.seat.x - W / 2) * 0.35 * focus : W / 2;
    const ty = spot ? H / 2 + (spot.seat.y - 40 - H / 2) * 0.3 * focus : H / 2;
    const tz = 1 + (target ? 0.09 : 0.14) * focus;
    const kc = 1 - Math.exp(-dt * (target ? 1.2 : 2.5));
    this.cam.x += (tx - this.cam.x) * kc;
    this.cam.y += (ty - this.cam.y) * kc;
    this.cam.z += (tz - this.cam.z) * kc;
    this.layout();

    // ---- ambient darkness
    const targetDim =
      this.curtainOpen < 1 ? 0.15 : 0.22 + (target ? 0.5 * Math.min(1, tension * 2.2) : focusView ? 0.38 : 0);
    this.dim += (targetDim - this.dim) * (1 - Math.exp(-dt * 3));
    this.darkness.clear().rect(-20, -20, W + 40, H + 40).fill({ color: 0x05020a, alpha: this.dim });

    // ---- musicians
    for (const v of this.views.values()) {
      if (v.walk) {
        const k = Math.max(0, Math.min(1, (t - v.walk.start) / v.walk.dur));
        v.sprite.x = v.walk.from + (v.walk.to - v.walk.from) * k;
        v.sprite.scale.x = v.walk.to < v.walk.from ? -1 : 1;
        if (v.seatGhost) v.seatGhost.alpha = Math.min(1, v.seatGhost.alpha + dt * (v.walk.leaving ? -0.8 : 1.5));
        if (k >= 1) {
          if (v.walk.leaving) {
            v.removeAt = t;
          } else {
            v.walk = null;
            v.sprite.scale.x = 1;
            if (v.seatGhost) {
              this.musicians.removeChild(v.seatGhost);
              v.seatGhost = undefined;
            }
            this.setState(v, 'tuning');
            v.lastActivity = t;
          }
        }
      } else this.autoState(v, t);

      if (v.state === 'walking' && v.walk?.leaving && !v.seatGhost) {
        // leave the chair behind, fading
        const ghost = makeFigure(v.info.instrument, v.seat.look);
        ghost.render(this.frameFor(v, t, { seat: true, ghostOnly: true }));
        v.seatGhost = new Sprite(pixelTexture(ghost.c));
        v.seatGhost.anchor.copyFrom(v.sprite.anchor);
        v.seatGhost.position.set(v.seat.x, v.seat.y);
        v.seatGhost.zIndex = v.seat.y - 0.5;
        this.musicians.addChild(v.seatGhost);
      }

      if (t - v.lastDraw > 1 / 30) {
        v.fig.render(this.frameFor(v, t));
        v.tex.source.update();
        v.lastDraw = t;
      }

      // spotlight
      const sel = this.selected === v.info.id;
      const base =
        v.state === 'sleeping' ? 0.12 : v.state === 'idle' ? 0.22 : v.state === 'walking' ? 0.3 : v.state === 'error' ? 0.55 : 0.42;
      let goal = base + (sel ? 0.15 : 0);
      let width = 1;
      let tint = v.state === 'sleeping' ? 0x8aa0ff : v.state === 'error' && t - v.errorAt < 3 ? 0xff6a5a : 0xffd9a0;
      if (spot) {
        const k = target ? Math.min(1, tension * 1.4) : 0.6;
        if (spot === v) {
          goal = 0.5 + 0.35 * k;
          width = 1 - 0.5 * (target ? Math.min(1, tension * 1.5) : 0.3);
          tint = 0xfff1d0;
        } else goal *= 1 - 0.85 * (target ? Math.min(1, tension * 3) : 0.85);
      }
      if (this.curtainOpen < 0.6) goal *= this.curtainOpen;
      v.light += (goal - v.light) * (1 - Math.exp(-dt * 4));
      v.pulse *= Math.exp(-dt * 5);
      const hx = v.sprite.x + v.fig.head[0];
      v.cone.position.set(hx, -40);
      v.cone.scale.set(0.42 * width, (v.sprite.y + 6 + 40) / 256);
      v.cone.alpha = Math.min(0.5, v.light * 0.5 + v.pulse * 0.1);
      v.cone.tint = tint;
      v.pool.position.set(hx, v.sprite.y);
      v.pool.scale.set(0.2 * (0.55 + width * 0.45), 0.2);
      v.pool.alpha = Math.min(0.5, v.light * 0.55 + v.pulse * 0.15);
      v.pool.tint = tint;
      v.sprite.tint = sel ? 0xfff6e8 : 0xffffff;

      // sleeping musicians snore
      if (v.state === 'sleeping' && Math.random() < dt * 0.7) {
        this.particles.spawn('z', T.z, hx + 6, v.sprite.y + v.fig.head[1] - 4, {
          vx: 5,
          vy: -7,
          sway: 3,
          life: 2.4,
          a0: 0.65,
          tint: 0xb8c8ff,
          scale0: 0.5,
          scale1: 1,
        });
      }
    }
    for (const v of [...this.views.values()]) {
      if (v.removeAt !== undefined) {
        this.musicians.removeChild(v.sprite);
        if (v.seatGhost) this.musicians.removeChild(v.seatGhost);
        this.lights.removeChild(v.cone, v.pool);
        this.views.delete(v.info.id);
      }
    }

    // ---- lift the waiting musician out of the dark
    if (spot !== this.lifted) {
      if (this.lifted && this.views.has(this.lifted.info.id)) this.musicians.addChild(this.lifted.sprite);
      if (spot) this.spotLayer.addChild(spot.sprite);
      this.lifted = spot;
    }

    // ---- fermata sign
    if (target) {
      const hx = target.sprite.x + target.fig.head[0],
        hy = target.sprite.y + target.fig.head[1] - 26;
      const pulse = 1 + Math.sin(t * (3 + tension * 6)) * 0.08 * (0.5 + tension);
      this.fermataSign.visible = this.fermataGlow.visible = true;
      this.fermataSign.position.set(hx, hy - Math.sin(t * 2) * 1.5);
      this.fermataSign.scale.set(pulse * (1 + tension * 0.3));
      this.fermataSign.alpha = Math.min(0.85, (t - target.stateSince) * 2);
      this.fermataGlow.position.copyFrom(this.fermataSign.position);
      this.fermataGlow.scale.set(0.3 + tension * 0.25);
      this.fermataGlow.alpha = 0.12 + tension * 0.18;
      // embers spiralling in towards the waiting musician
      if (Math.random() < dt * (4 + tension * 30)) {
        const a = Math.random() * Math.PI * 2;
        const r = 30 + Math.random() * 30;
        const ex = hx + Math.cos(a) * r,
          ey = target.sprite.y - 24 + Math.sin(a) * r * 0.6;
        this.particles.spawn('ember', T.dot2, ex, ey, {
          vx: (hx - ex) * 0.9,
          vy: (target.sprite.y - 24 - ey) * 0.9,
          life: 1.1,
          a0: 0.5 + tension * 0.5,
          tint: tension > 0.7 ? 0xffb070 : 0xffe2a0,
          scale0: 0.6,
          scale1: 0.1,
        });
      }
    } else {
      this.fermataSign.visible = this.fermataGlow.visible = false;
    }

    // ---- conductor
    const cue = Math.max(0, 1 - (t - this.cueAt) / 0.6);
    let pointAt = 0;
    if (this.selected) {
      const s = this.views.get(this.selected);
      if (s) pointAt = Math.max(-1, Math.min(1, (s.seat.x - W / 2) / 120));
    }
    this.conductor.render({
      beatPhase: beat.phase,
      beat: beat.beat,
      running: beat.running,
      t,
      fermata: target ? Math.max(0.01, tension) : 0,
      cue,
      pointAt,
      tapAge: t - this.tapAt,
    });
    this.conductorTex.source.update();
    if (beat.running && Math.random() < dt * 20 && !target) {
      const [bx, by] = this.conductor.tip;
      this.particles.spawn('spark', T.dot, this.conductorSprite.x - this.conductor.ax + bx, this.conductorSprite.y - this.conductor.ay + by, {
        vy: 0,
        life: 0.35,
        a0: 0.6,
        tint: 0xfff2d0,
      });
    }

    // ---- dust & flashes
    if (Math.random() < dt * 6) this.spawnDust();
    this.particles.update(dt);
    this.flashA *= Math.exp(-dt * 3.2);
    this.flash.clear();
    if (this.flashA > 0.004) this.flash.rect(-20, -20, W + 40, H + 40).fill({ color: this.flashColor, alpha: this.flashA });
    this.flash.blendMode = 'add';
    this.bloom.bloomScale = 0.9 + (target ? tension * 0.35 : 0) + this.flashA;
  }
}
