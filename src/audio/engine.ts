import * as Tone from 'tone';
import { Emitter } from '../core/bus';
import type { AgentEvent, InstrumentId } from '../core/events';
import type { Kit, NoteInfo, SoundTheme, VoiceLike } from './sound-theme';
import { orchestra } from './themes/orchestra';
import { chordTones, nearestChordTone, scaleStep, voicing, type Chord } from './theory';

/**
 * The Bytehoven audio engine.
 *
 * - One Tone.Transport clock (4/4, tempo from the theme). Every sound is quantised to it,
 *   and every visual reaction is scheduled with Tone.Draw on the exact same
 *   timestamp, so sound and picture never drift.
 * - Each musician is a Voice with its own stereo position and volume.
 * - Events queue per voice. A scheduler ticks every 16th note: normal
 *   events start on the next 8th; a backlog of 3+ events turns into a
 *   flowing diatonic run instead of a pile of "dings".
 * - Fermata: the theme's held dominant grows layer by layer, opens its filter
 *   and swells, with a heartbeat underneath, until the user approves and it
 *   resolves to the tonic.
 * - What the band actually plays (harmony, instruments, every "moment") comes
 *   from a SoundTheme: see ./themes.
 */

const TICKS_PER_16TH = 48; // Tone default PPQ = 192

export type { NoteInfo } from './sound-theme';

interface Manifest {
  groups: Record<string, { pitched: boolean; samples: Record<string, string> }>;
}

type Queued = { ev: AgentEvent };

class Voice implements VoiceLike {
  readonly channel: Tone.Channel;
  readonly samplers = new Map<string, Tone.Sampler>();
  queue: Queued[] = [];
  busyUntil = 0;
  inRun = false;
  runDir: 1 | -1 = 1;
  lastMidi: number;
  lastEventAt = 0;
  lastTuningAt = -1e9;
  muted = false;

  constructor(
    readonly agentId: string,
    readonly instrument: InstrumentId,
    pan: number,
    out: Tone.InputNode,
    private engine: AudioEngine,
  ) {
    const spec = instrument === 'percussion' ? null : engine.theme.specs[instrument];
    this.channel = new Tone.Channel({ pan, volume: spec?.gainDb ?? -2 }).connect(out);
    this.lastMidi = spec ? Math.round((spec.range[0] + spec.range[1]) / 2) : 38;
  }

  /**
   * `slot` gives a second, independent sampler for the same group. Tone.Sampler
   * releases every voice of a pitch when one of them is released, so held
   * notes that overlap their own re-trigger must alternate between slots.
   */
  sampler(group: string, slot = 0): Tone.Sampler {
    const key = `${group}#${slot}`;
    let s = this.samplers.get(key);
    if (!s) {
      s = this.engine.makeSampler(group);
      s.connect(this.channel);
      this.samplers.set(key, s);
    }
    return s;
  }

  dispose() {
    for (const s of this.samplers.values()) s.dispose();
    this.channel.dispose();
  }
}

export class AudioEngine extends Emitter<{ note: NoteInfo; progress: number; bar: { chord: Chord; bar: number } }> implements Kit {
  readonly theme: SoundTheme;
  private buffers = new Map<string, Map<number, Tone.ToneAudioBuffer>>();
  /** Unpitched groups: sample name -> pseudo midi key. */
  private hitKeys = new Map<string, Map<string, number>>();
  private voices = new Map<string, Voice>();
  ensemble!: Voice;
  private fermataBus!: Tone.Channel;
  private fermataFilter!: Tone.Filter;
  private fermataVol!: Tone.Volume;
  private master!: Tone.Volume;
  padVol!: Tone.Volume;

  private bar = 0;
  chord: Chord;
  private lockedChord: Chord | null = null;
  private resumeAt: number | null = null;

  private fermata: { agentId: string; start: number; repeatIds: number[]; lastTension: number } | null = null;
  private tensionAfter = 0;
  private tensionAfterAt = 0;

  ready = false;
  started = false;

  constructor(theme: SoundTheme = orchestra) {
    super();
    this.theme = theme;
    this.chord = theme.progression[0];
  }

  // ------------------------------------------------------------------ loading

  async load(baseUrl = './samples/'): Promise<void> {
    const jobs: Array<() => Promise<void>> = [];
    const wanted = new Set(this.theme.groups);
    // groups the theme makes in code (the chiptune channels)
    const rate = Tone.getContext().sampleRate;
    for (const [group, make] of Object.entries(this.theme.synth ?? {})) {
      wanted.delete(group);
      const made = make(rate);
      const map = new Map<number, Tone.ToneAudioBuffer>();
      this.buffers.set(group, map);
      if (made instanceof Map) for (const [midi, x] of made) map.set(midi, Tone.ToneAudioBuffer.fromArray(x));
      else {
        const names = new Map<string, number>();
        this.hitKeys.set(group, names);
        Object.entries(made).forEach(([name, x], i) => {
          names.set(name, 60 + i);
          map.set(60 + i, Tone.ToneAudioBuffer.fromArray(x));
        });
      }
    }
    const manifest: Manifest = wanted.size ? await (await fetch(baseUrl + 'manifest.json')).json() : { groups: {} };
    for (const [group, g] of Object.entries(manifest.groups)) {
      if (!wanted.has(group)) continue;
      const map = new Map<number, Tone.ToneAudioBuffer>();
      this.buffers.set(group, map);
      let pseudo = 60;
      const names = new Map<string, number>();
      if (!g.pitched) this.hitKeys.set(group, names);
      for (const [key, file] of Object.entries(g.samples)) {
        let midi: number;
        if (g.pitched) {
          midi = Tone.Frequency(key.replace('_', '')).toMidi();
          if (!Number.isFinite(midi)) continue;
        } else {
          midi = pseudo++;
          names.set(key, midi);
        }
        jobs.push(async () => {
          map.set(midi, await Tone.ToneAudioBuffer.fromUrl(baseUrl + file));
        });
      }
    }
    let done = 0;
    const total = jobs.length;
    const worker = async () => {
      while (jobs.length) {
        const job = jobs.shift()!;
        await job();
        this.emit('progress', ++done / total);
      }
    };
    await Promise.all(Array.from({ length: 10 }, worker));
    this.buildGraph();
    this.ready = true;
  }

  makeSampler(group: string): Tone.Sampler {
    const map = this.buffers.get(group);
    if (!map) throw new Error(`unknown sample group ${group}`);
    const urls: Record<number, Tone.ToneAudioBuffer> = {};
    for (const [m, b] of map) urls[m] = b;
    const env = this.theme.env[group] ?? { attack: 0.005, release: 0.8 };
    return new Tone.Sampler({ urls, attack: env.attack, release: env.release, curve: 'exponential' });
  }

  private buildGraph() {
    const limiter = new Tone.Limiter(-1).toDestination();
    this.master = new Tone.Volume(7).connect(limiter);
    const comp = new Tone.Compressor({ threshold: -20, ratio: 2.5, attack: 0.02, release: 0.25 });
    const tex = this.theme.texture;
    if (tex) {
      const wobble = new Tone.Vibrato({ frequency: 0.55, depth: tex.wobble }).connect(this.master);
      const dull = new Tone.Filter({ type: 'lowpass', frequency: tex.lowpass, Q: 0.5 }).connect(wobble);
      comp.connect(dull);
      if (tex.crackle) this.crackle = crackle().connect(this.master);
    } else comp.connect(this.master);
    const reverb = new Tone.Reverb(this.theme.reverb).connect(comp);
    // a hint of early reflections for "hall" depth
    const early = new Tone.FeedbackDelay({ delayTime: 0.031, feedback: 0.12, wet: 0.08 }).connect(reverb);
    this.busIn = early;

    this.padVol = new Tone.Volume(-20).connect(early);
    this.ensemble = new Voice('__ensemble', 'piano', 0, this.padVol, this);

    this.fermataVol = new Tone.Volume(-40).connect(early);
    this.fermataFilter = new Tone.Filter({ type: 'lowpass', frequency: 500, Q: 0.7 }).connect(this.fermataVol);
    this.fermataBus = new Tone.Channel({ pan: 0 }).connect(this.fermataFilter);

    const t = Tone.getTransport();
    t.bpm.value = this.theme.bpm;
    t.timeSignature = 4;
    t.swing = this.theme.swing;
    t.swingSubdivision = '8n';
    t.scheduleRepeat((time) => this.tick(time), '16n', 0);
    for (const [id, inst, pan] of this.pendingVoices) this.addVoice(id, inst, pan);
    this.pendingVoices = [];
  }

  private busIn!: Tone.InputNode;
  private crackle?: Tone.Player;

  // ------------------------------------------------------------------ voices

  private pendingVoices: Array<[string, InstrumentId, number]> = [];

  addVoice(agentId: string, instrument: InstrumentId, pan: number): void {
    if (this.voices.has(agentId)) return;
    if (!this.busIn) {
      this.pendingVoices.push([agentId, instrument, pan]);
      return;
    }
    this.voices.set(agentId, new Voice(agentId, instrument, pan, this.busIn, this));
  }

  removeVoice(agentId: string, afterSec = 3): void {
    const v = this.voices.get(agentId);
    if (!v) return;
    this.voices.delete(agentId);
    setTimeout(() => v.dispose(), afterSec * 1000);
  }

  setVoiceVolume(agentId: string, db: number): void {
    const v = this.voices.get(agentId);
    if (!v) return;
    const spec = v.instrument === 'percussion' ? null : this.theme.specs[v.instrument];
    v.channel.volume.rampTo((spec?.gainDb ?? -2) + db, 0.1);
  }

  setVoiceMuted(agentId: string, muted: boolean): void {
    const v = this.voices.get(agentId);
    if (v) v.channel.mute = muted;
  }

  setMasterVolume(linear: number): void {
    this.master?.volume.rampTo(linear <= 0.001 ? -Infinity : 20 * Math.log10(linear) + 7, 0.08);
  }

  setMuted(m: boolean): void {
    Tone.getDestination().mute = m;
  }

  get context() {
    return Tone.getContext();
  }

  // ------------------------------------------------------------------ start / intro

  /**
   * Orchestra tuning, then two baton taps, then the first downbeat.
   * Returns seconds until the downbeat.
   */
  async startConcert(): Promise<number> {
    await Tone.start();
    const now = Tone.now() + 0.1;
    this.padVol.volume.value = -8;
    this.crackle?.start(now);
    const downbeat = this.theme.intro(this, now);
    setTimeout(() => (this.padVol.volume.value = -20), (downbeat - Tone.now()) * 1000);
    const transport = Tone.getTransport();
    transport.position = 0;
    transport.start(downbeat);
    this.started = true;
    return downbeat - Tone.now();
  }

  // ------------------------------------------------------------------ events

  handle(ev: AgentEvent): void {
    if (!this.ready || !this.started) return;
    const v = this.voices.get(ev.agentId);
    if (!v) return;
    v.lastEventAt = performance.now();
    const t = Tone.getTransport();
    switch (ev.kind) {
      case 'permission_request':
        return this.startFermata(v, t.nextSubdivision('4n'));
      case 'permission_resolved':
        return this.resolveFermata(v, t.nextSubdivision('8n'), ev.approved !== false);
      case 'test_fail':
      case 'error':
        v.queue = [];
        return this.playError(v, t.nextSubdivision('8n'));
      case 'test_pass':
        v.queue = [];
        return this.playCadence(v, t.nextSubdivision('4n'));
      case 'task_done':
        v.queue = [];
        return this.playFinale(v, t.nextSubdivision('8n'));
      case 'subagent_join':
        return this.playJoin(ev, t.nextSubdivision('8n'));
      case 'subagent_leave':
        return this.playLeave(t.nextSubdivision('8n'));
      case 'idle':
        v.queue = [];
        return;
      default:
        if (v.queue.length < 24) v.queue.push({ ev });
    }
  }

  // ------------------------------------------------------------------ scheduler

  private tick(time: number) {
    const step = Math.round(Tone.getTransport().getTicksAtTime(time) / TICKS_PER_16TH);
    if (step % 16 === 0) this.onBar(time, step / 16);
    for (const v of this.voices.values()) {
      if (step < v.busyUntil || !v.queue.length) continue;
      if (v.queue.length >= 3 || (v.inRun && v.queue.length)) {
        v.inRun = true;
        const { ev } = v.queue.shift()!;
        this.playRun(v, ev, time, step);
        v.busyUntil = step + 1;
        if (!v.queue.length) v.inRun = false;
        continue;
      }
      if (step % 2 !== 0) continue; // normal phrases start on 8ths
      const { ev } = v.queue.shift()!;
      v.busyUntil = step + this.playPhrase(v, ev, time);
    }
    if (this.fermata) this.updateFermata(time);
  }

  private onBar(time: number, bar: number) {
    if (this.resumeAt !== null && time >= this.resumeAt - 0.01) {
      this.resumeAt = null;
      this.lockedChord = null;
      this.bar = 0; // the resolved tonic counts as bar 0 — continue from V6
    } else if (!this.lockedChord) {
      this.bar++;
    }
    const prog = this.theme.progression;
    this.chord = this.lockedChord ?? prog[this.bar % prog.length];
    this.emit('bar', { chord: this.chord, bar });
    if (this.fermata || this.lockedChord) return;
    // the bed follows how busy the band is
    const now = performance.now();
    let active = 0;
    for (const v of this.voices.values()) if (now - v.lastEventAt < 7000) active++;
    if (active) this.theme.bed(this, time, bar, active);
  }

  get nextChord(): Chord {
    const prog = this.theme.progression;
    return this.lockedChord ?? prog[(this.bar + 1) % prog.length];
  }

  get spb() {
    return 60 / Tone.getTransport().bpm.value;
  }

  s16(n: number) {
    return (this.spb / 4) * n;
  }

  /** Plays the phrase for one event. Returns its length in 16ths. */
  private playPhrase(v: Voice, ev: AgentEvent, time: number): number {
    if (v.instrument === 'percussion') return this.theme.percussion(this, v, ev.kind, time);
    const spec = this.theme.specs[v.instrument];
    const [lo, hi] = spec.range;
    const chord = this.chord;
    const play = (group: string, midis: number[], at: number, dur: number, vel: number, kind: NoteInfo['kind'], index = 0) => {
      v.sampler(group).triggerAttackRelease(midis.map(toNote), dur, at, vel);
      this.drawAt(at, { agentId: v.agentId, kind, midis, velocity: vel, duration: dur, index });
    };
    switch (ev.kind) {
      case 'file_read': {
        const m = nearestChordTone(chord, v.lastMidi, lo, hi);
        v.lastMidi = m;
        play(spec.soft, [m], time, v.instrument === 'flute' ? 0.7 : 1.2, 0.32, 'file_read');
        return 2;
      }
      case 'tool_start': {
        const tones = chordTones(chord, lo, hi);
        let i = Math.max(0, tones.findIndex((m) => m >= v.lastMidi) - 1);
        if (i + 2 >= tones.length) i = Math.max(0, tones.length - 3);
        const notes = [tones[i], tones[i + 1] ?? tones[i], tones[i + 2] ?? tones[i]];
        notes.forEach((m, k) => play(spec.motif, [m], time + this.s16(k), 0.5, 0.5 + k * 0.06, 'tool_start', k));
        v.lastMidi = notes[2];
        return 4;
      }
      case 'file_write': {
        if (spec.chordSize > 1) {
          const base = Math.max(lo, Math.min(hi - 12, v.lastMidi - 5));
          const notes = voicing(chord, base, spec.chordSize);
          play(spec.chord, notes, time, 1.4, 0.58, 'file_write');
          v.lastMidi = notes[notes.length - 1];
        } else {
          const m = nearestChordTone(chord, v.lastMidi, lo, hi);
          play(spec.long, [m], time, 1.5, 0.55, 'file_write');
          v.lastMidi = m;
        }
        return 4;
      }
      case 'bash': {
        const root = nearestChordTone({ ...chord, tones: [chord.tones[0]] }, v.lastMidi, lo, hi);
        const fifth = chordTones(chord, root + 1, root + 8)[1] ?? root;
        const pat = [root, root, fifth, root];
        const vels = [0.62, 0.32, 0.45, 0.34];
        pat.forEach((m, k) => play(spec.rhythm, [m], time + this.s16(k), 0.18, vels[k], 'bash', k));
        return 4;
      }
      case 'thinking': {
        const nowMs = performance.now();
        if (nowMs - v.lastTuningAt < 9000) {
          this.drawAt(time, { agentId: v.agentId, kind: 'tuning', midis: [], velocity: 0, duration: 1, index: 0 });
          return 2;
        }
        v.lastTuningAt = nowMs;
        play(spec.long, [spec.tuningNote], time, 1.6, 0.16, 'tuning');
        return 4;
      }
      default:
        return 1;
    }
  }

  private playRun(v: Voice, ev: AgentEvent, time: number, step: number) {
    if (v.instrument === 'percussion') return this.theme.percussionRun(this, v, time, step);
    const spec = this.theme.specs[v.instrument];
    const r = scaleStep(v.lastMidi, v.runDir, spec.range[0] + 2, spec.range[1] - 4, this.theme.scale);
    v.runDir = r.dir;
    v.lastMidi = r.midi;
    const accent = step % 4 === 0;
    const group = ev.kind === 'file_read' && v.instrument === 'violin' ? 'violin_pizz' : spec.motif;
    v.sampler(group).triggerAttackRelease(toNote(r.midi), 0.3, time, accent ? 0.48 : 0.34);
    this.drawAt(time, { agentId: v.agentId, kind: 'run', midis: [r.midi], velocity: accent ? 0.5 : 0.35, duration: 0.12, index: step });
  }

  hit(v: VoiceLike, group: string, name: string, time: number, vel: number, dur: number) {
    const key = this.hitKeys.get(group)?.get(name);
    if (key === undefined) return;
    v.sampler(group).triggerAttackRelease(toNote(key), dur, time, vel);
  }

  gliss(group: string, time: number, from: number, to: number, step: number, vel: number, dir: 1 | -1 = 1) {
    const tones = chordTones(this.lockedChord ?? this.chord, from, to);
    if (dir < 0) tones.reverse();
    const s = this.ensemble.sampler(group);
    tones.forEach((m, k) => s.triggerAttackRelease(toNote(m), 2.2, time + k * step, vel * (0.7 + 0.3 * (k / tones.length))));
  }

  // ------------------------------------------------------------------ dramatic moments

  private playError(v: Voice, time: number) {
    this.theme.error(this, v, time);
    v.busyUntil = this.stepAt(time) + 8;
  }

  private playCadence(v: Voice, time: number) {
    this.theme.cadence(this, v, time);
    v.busyUntil = this.stepAt(time) + 12;
  }

  private playFinale(v: Voice, time: number) {
    const s16 = this.s16(1);
    if (v.instrument === 'percussion') return this.playCadence(v, time);
    const spec = this.theme.specs[v.instrument];
    const tones = chordTones(this.theme.tonic, spec.range[0] + 3, spec.range[1]);
    const up = tones.slice(0, 5);
    up.forEach((m, k) => {
      v.sampler(spec.motif).triggerAttackRelease(toNote(m), 0.5, time + k * s16 * 2, 0.45 + k * 0.05);
      this.drawAt(time + k * s16 * 2, { agentId: v.agentId, kind: 'task_done', midis: [m], velocity: 0.5, duration: 0.3, index: k });
    });
    const end = time + up.length * s16 * 2;
    const top = up[up.length - 1];
    v.sampler(spec.long).triggerAttackRelease(toNote(top), 2.5, end, 0.6);
    this.theme.finaleTail(this, end, top);
    this.drawAt(end, { agentId: v.agentId, kind: 'task_done', midis: [top], velocity: 0.8, duration: 2.5, index: 9 });
    v.busyUntil = this.stepAt(time) + 16;
  }

  private playJoin(ev: AgentEvent, time: number) {
    this.theme.join(this, time);
    this.drawAt(time, { agentId: ev.child?.id ?? ev.agentId, kind: 'subagent_join', midis: [], velocity: 0.6, duration: 1, index: 0 });
  }

  private playLeave(time: number) {
    this.theme.leave(this, time);
  }

  // ------------------------------------------------------------------ fermata

  private startFermata(v: Voice, time: number) {
    if (this.fermata) return;
    const dominant = this.theme.dominant;
    this.lockedChord = dominant;
    this.chord = dominant;
    v.queue = [];
    const pan = v.channel.pan.value * 0.6;
    this.fermataBus.pan.rampTo(pan, 0.5);
    this.fermataVol.volume.cancelScheduledValues(time);
    this.fermataVol.volume.setValueAtTime(-30, time);
    this.fermataVol.volume.linearRampToValueAtTime(-4, time + 24);
    this.fermataFilter.frequency.cancelScheduledValues(time);
    this.fermataFilter.frequency.setValueAtTime(420, time);
    this.fermataFilter.frequency.exponentialRampToValueAtTime(7500, time + 26);

    const transport = Tone.getTransport();
    const ids: number[] = [];
    let parity = 0;
    const sampler = (g: string) => {
      const key = `${g}#${parity}`;
      let s = this.fermataSamplers.get(key);
      if (!s) {
        s = this.makeSampler(g);
        s.connect(this.fermataBus);
        this.fermataSamplers.set(key, s);
      }
      return s;
    };
    const holdNotes = (t: number, tension: number) => {
      parity = 1 - parity;
      const bar = this.spb * 4;
      for (const [g, m, vel] of this.theme.fermataNotes(tension)) sampler(g).triggerAttackRelease(toNote(m), bar * 1.6, t, vel);
      this.theme.fermataRoll?.(this, sampler, t, bar, tension);
    };
    holdNotes(time, 0);
    // first, the waiting musician's own instrument rings out
    if (v.instrument !== 'percussion') {
      const spec = this.theme.specs[v.instrument];
      const m = nearestChordTone(dominant, v.lastMidi, spec.range[0], spec.range[1]);
      v.sampler(spec.long).triggerAttackRelease(toNote(m), 3, time, 0.55);
      if (v.instrument === 'piano') v.sampler(spec.chord).triggerAttackRelease(voicing(dominant, 45, 4).map(toNote), 4, time, 0.5);
    }
    this.drawAt(time, { agentId: v.agentId, kind: 'permission_request', midis: [57, 61, 64, 67], velocity: 0.6, duration: 2, index: 0 });

    ids.push(
      transport.scheduleRepeat(
        (t) => {
          const tension = this.tensionAt(t);
          holdNotes(t, tension);
        },
        '1m',
        // scheduleRepeat wants transport time, not AudioContext time
        transport.getSecondsAtTime(time) + this.spb * 4,
      ),
    );
    // heartbeat: soft bass drum on every beat, doubling up as the tension rises
    ids.push(
      transport.scheduleRepeat(
        (t) => {
          const tension = this.tensionAt(t);
          if (tension < 0.15) return;
          const step = this.stepAt(t);
          const onBeat = step % 4 === 0;
          const onEighth = step % 2 === 0;
          if (onBeat || (tension > 0.6 && onEighth) || (tension > 0.88 && step % 1 === 0 && step % 4 === 3)) {
            const vel = (onBeat ? 0.3 : 0.18) + tension * 0.35;
            this.theme.heartbeat(this, t, vel);
            this.drawAt(t, { agentId: '__heartbeat', kind: 'permission_request', midis: [], velocity: vel, duration: 0.2, index: step });
          }
        },
        '16n',
        transport.getSecondsAtTime(time),
      ),
    );
    this.fermata = { agentId: v.agentId, start: time, repeatIds: ids, lastTension: 0 };
  }

  private fermataSamplers = new Map<string, Tone.Sampler>();

  private tensionAt(t: number): number {
    if (!this.fermata) return 0;
    const e = Math.max(0, t - this.fermata.start);
    return 1 - Math.exp(-e / 9);
  }

  private updateFermata(time: number) {
    if (this.fermata) this.fermata.lastTension = this.tensionAt(time);
  }

  /** 0..1 for the UI tension meter. */
  get tension(): number {
    if (this.fermata) return this.tensionAt(Tone.now());
    const since = (performance.now() - this.tensionAfterAt) / 1000;
    return Math.max(0, this.tensionAfter * Math.exp(-since / 0.8));
  }

  get fermataAgent(): string | null {
    return this.fermata?.agentId ?? null;
  }

  private resolveFermata(v: Voice, time: number, approved: boolean) {
    if (!this.fermata) return;
    const transport = Tone.getTransport();
    for (const id of this.fermata.repeatIds) transport.clear(id);
    this.tensionAfter = this.tensionAt(time);
    this.tensionAfterAt = performance.now() + Math.max(0, (time - Tone.now()) * 1000);
    this.fermata = null;
    for (const s of this.fermataSamplers.values()) s.releaseAll(time);
    this.fermataVol.volume.cancelScheduledValues(time);
    this.fermataVol.volume.setValueAtTime(this.fermataVol.volume.getValueAtTime(time), time);
    this.fermataVol.volume.linearRampToValueAtTime(-40, time + 1.2);

    const target = approved ? this.theme.tonic : this.theme.deceptive;
    this.lockedChord = target;
    this.chord = target;
    this.resumeAt = transport.nextSubdivision('1m') > time + 0.4 ? transport.nextSubdivision('1m') : time + this.spb * 4;
    if (!approved) this.bar = 1; // after vi continue at iii — a deceptive cadence feels like "not yet"
    const prevPad = this.padVol.volume.value;
    this.padVol.volume.setValueAtTime(-9, time);
    this.padVol.volume.linearRampToValueAtTime(prevPad, time + 4);

    this.theme.resolve(this, time, approved);
    this.drawAt(time, {
      agentId: v.agentId,
      kind: 'resolve',
      midis: approved ? [38, 62, 66, 69] : [35, 59, 62, 66],
      velocity: approved ? 1 : 0.5,
      duration: 3,
      index: approved ? 1 : 0,
    });
    v.busyUntil = this.stepAt(time) + 6;
  }

  // ------------------------------------------------------------------ helpers

  stepAt(time: number) {
    return Math.round(Tone.getTransport().getTicksAtTime(time) / TICKS_PER_16TH);
  }

  private drawAt(time: number, info: NoteInfo) {
    Tone.getDraw().schedule(() => this.emit('note', info), time);
  }

  draw(time: number, info: NoteInfo) {
    this.drawAt(time, info);
  }

  /** Beat phase 0..1 within the current beat, and beat index within the bar. */
  beatPhase(): { phase: number; beat: number; bar: number; running: boolean } {
    const t = Tone.getTransport();
    if (t.state !== 'started') return { phase: 0, beat: 0, bar: 0, running: false };
    const ticks = t.ticks;
    const ppq = t.PPQ;
    const beats = ticks / ppq;
    return { phase: beats % 1, beat: Math.floor(beats) % 4, bar: Math.floor(beats / 4), running: true };
  }

  get currentChord(): Chord {
    return this.chord;
  }

  /** For recording later: the node that carries the final mix. */
  get output(): Tone.ToneAudioNode {
    return this.master;
  }
}

const toNote = (m: number) => Tone.Frequency(m, 'midi').toNote();

/**
 * Vinyl crackle, made rather than sampled: six looping seconds of faint hiss
 * with sparse dust clicks, a few louder pops among them.
 */
function crackle(): Tone.Player {
  const rate = Tone.getContext().sampleRate;
  const x = new Float32Array(rate * 6);
  let lp = 0;
  for (let i = 0; i < x.length; i++) {
    lp += 0.08 * (Math.random() * 2 - 1 - lp); // dull hiss
    x[i] = lp * 0.05;
  }
  const clicks = 90;
  for (let c = 0; c < clicks; c++) {
    const at = Math.floor(Math.random() * (x.length - 200));
    const amp = (Math.random() < 0.12 ? 0.5 : 0.12) * (Math.random() < 0.5 ? -1 : 1);
    const len = 8 + Math.floor(Math.random() * 40);
    for (let i = 0; i < len; i++) x[at + i] += amp * Math.exp(-i / (len / 4)) * (Math.random() * 0.6 + 0.4);
  }
  const player = new Tone.Player(Tone.ToneAudioBuffer.fromArray(x));
  player.loop = true;
  player.volume.value = -24;
  return player;
}
