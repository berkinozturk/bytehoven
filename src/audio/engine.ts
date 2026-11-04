import * as Tone from 'tone';
import { Emitter } from '../core/bus';
import type { AgentEvent, AgentEventKind, InstrumentId } from '../core/events';
import {
  CHORDS,
  PROGRESSION,
  bassNote,
  chordTones,
  nearestChordTone,
  scaleStep,
  voicing,
  type Chord,
} from './theory';

/**
 * The Bytehoven audio engine.
 *
 * - One Tone.Transport clock (92 BPM, 4/4). Every sound is quantised to it,
 *   and every visual reaction is scheduled with Tone.Draw on the exact same
 *   timestamp, so sound and picture never drift.
 * - Each musician is a Voice with its own stereo position and volume.
 * - Events queue per voice. A scheduler ticks every 16th note: normal
 *   events start on the next 8th; a backlog of 3+ events turns into a
 *   flowing diatonic run instead of a pile of "dings".
 * - Fermata: a held dominant (A7) built from real string tremolo samples that
 *   grows layer by layer, opens its filter and swells, with a heartbeat
 *   underneath — until the user approves and it resolves to D major.
 */

const BPM = 92;
const TICKS_PER_16TH = 48; // Tone default PPQ = 192

export interface NoteInfo {
  agentId: string;
  kind: AgentEventKind | 'run' | 'tuning' | 'resolve' | 'intro';
  midis: number[];
  velocity: number;
  duration: number;
  /** Index within a phrase, for visuals that want to animate per hit. */
  index: number;
}

interface Manifest {
  groups: Record<string, { pitched: boolean; samples: Record<string, string> }>;
}

interface InstrumentSpec {
  range: [number, number];
  soft: string;
  motif: string;
  chord: string;
  rhythm: string;
  long: string;
  chordSize: number;
  gainDb: number;
  tuningNote: number;
}

const SPECS: Record<Exclude<InstrumentId, 'percussion'>, InstrumentSpec> = {
  piano: { range: [50, 86], soft: 'piano', motif: 'piano', chord: 'piano', rhythm: 'piano', long: 'piano', chordSize: 3, gainDb: -3, tuningNote: 69 },
  violin: { range: [62, 88], soft: 'violin_pizz', motif: 'violin_spic', chord: 'violin', rhythm: 'violin_spic', long: 'violin', chordSize: 2, gainDb: -4, tuningNote: 69 },
  flute: { range: [69, 93], soft: 'flute_sus', motif: 'flute_stac', chord: 'flute_sus', rhythm: 'flute_stac', long: 'flute_sus', chordSize: 1, gainDb: -6, tuningNote: 81 },
  contrabass: { range: [28, 50], soft: 'bass_pizz', motif: 'bass_pizz', chord: 'bass_sus', rhythm: 'bass_pizz', long: 'bass_sus', chordSize: 1, gainDb: -1, tuningNote: 33 },
};


const SAMPLER_ENV: Record<string, { attack: number; release: number }> = {
  strings_sus: { attack: 0.25, release: 1.6 },
  strings_trem: { attack: 0.5, release: 1.4 },
  cello_trem: { attack: 0.5, release: 1.4 },
  bass_sus: { attack: 0.08, release: 0.9 },
  flute_sus: { attack: 0.06, release: 0.6 },
  violin: { attack: 0.05, release: 0.7 },
  timp_roll: { attack: 0.3, release: 1.2 },
};

type Queued = { ev: AgentEvent };

class Voice {
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
    const spec = instrument === 'percussion' ? null : SPECS[instrument];
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

export class AudioEngine extends Emitter<{ note: NoteInfo; progress: number; bar: { chord: Chord; bar: number } }> {
  private buffers = new Map<string, Map<number, Tone.ToneAudioBuffer>>();
  /** Unpitched groups: sample name -> pseudo midi key. */
  private hitKeys = new Map<string, Map<string, number>>();
  private voices = new Map<string, Voice>();
  private ensemble!: Voice;
  private fermataBus!: Tone.Channel;
  private fermataFilter!: Tone.Filter;
  private fermataVol!: Tone.Volume;
  private master!: Tone.Volume;
  private padVol!: Tone.Volume;

  private bar = 0;
  private chord: Chord = PROGRESSION[0];
  private lockedChord: Chord | null = null;
  private resumeAt: number | null = null;

  private fermata: { agentId: string; start: number; repeatIds: number[]; lastTension: number } | null = null;
  private tensionAfter = 0;
  private tensionAfterAt = 0;

  ready = false;
  started = false;

  // ------------------------------------------------------------------ loading

  async load(baseUrl = './samples/'): Promise<void> {
    const manifest: Manifest = await (await fetch(baseUrl + 'manifest.json')).json();
    const jobs: Array<() => Promise<void>> = [];
    for (const [group, g] of Object.entries(manifest.groups)) {
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
    const env = SAMPLER_ENV[group] ?? { attack: 0.005, release: 0.8 };
    return new Tone.Sampler({ urls, attack: env.attack, release: env.release, curve: 'exponential' });
  }

  private buildGraph() {
    const limiter = new Tone.Limiter(-1).toDestination();
    this.master = new Tone.Volume(7).connect(limiter);
    const comp = new Tone.Compressor({ threshold: -20, ratio: 2.5, attack: 0.02, release: 0.25 }).connect(this.master);
    const reverb = new Tone.Reverb({ decay: 3.4, preDelay: 0.025, wet: 0.3 }).connect(comp);
    // a hint of early reflections for "hall" depth
    const early = new Tone.FeedbackDelay({ delayTime: 0.031, feedback: 0.12, wet: 0.08 }).connect(reverb);
    this.busIn = early;

    this.padVol = new Tone.Volume(-20).connect(early);
    this.ensemble = new Voice('__ensemble', 'piano', 0, this.padVol, this);

    this.fermataVol = new Tone.Volume(-40).connect(early);
    this.fermataFilter = new Tone.Filter({ type: 'lowpass', frequency: 500, Q: 0.7 }).connect(this.fermataVol);
    this.fermataBus = new Tone.Channel({ pan: 0 }).connect(this.fermataFilter);

    const t = Tone.getTransport();
    t.bpm.value = BPM;
    t.timeSignature = 4;
    t.scheduleRepeat((time) => this.tick(time), '16n', 0);
    for (const [id, inst, pan] of this.pendingVoices) this.addVoice(id, inst, pan);
    this.pendingVoices = [];
  }

  private busIn!: Tone.InputNode;

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
    const spec = v.instrument === 'percussion' ? null : SPECS[v.instrument];
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
    const ens = this.ensemble;
    // oboe-style A from the flute first, then everyone joins with their A
    const tuners: Array<{ group: string; midi: number; at: number; vel: number; dur: number }> = [
      { group: 'flute_sus', midi: 81, at: 0, vel: 0.5, dur: 3.2 },
      { group: 'violin', midi: 69, at: 0.9, vel: 0.35, dur: 2.6 },
      { group: 'violin', midi: 76, at: 1.5, vel: 0.25, dur: 1.8 },
      { group: 'strings_sus', midi: 69, at: 1.2, vel: 0.5, dur: 3 },
      { group: 'cello_trem', midi: 57, at: 1.7, vel: 0.35, dur: 2.2 },
      { group: 'bass_sus', midi: 33, at: 1.9, vel: 0.55, dur: 2.2 },
      { group: 'violin_pizz', midi: 64, at: 2.4, vel: 0.3, dur: 0.6 },
      { group: 'violin_pizz', midi: 69, at: 2.6, vel: 0.3, dur: 0.6 },
      { group: 'piano', midi: 69, at: 2.2, vel: 0.3, dur: 1.5 },
      { group: 'violin', midi: 62, at: 2.9, vel: 0.25, dur: 1.2 },
      { group: 'timp', midi: 33, at: 3.0, vel: 0.25, dur: 2 },
    ];
    this.padVol.volume.value = -8;
    for (const n of tuners) {
      ens.sampler(n.group).triggerAttackRelease(Tone.Frequency(n.midi, 'midi').toNote(), n.dur, now + n.at, n.vel);
      this.drawAt(now + n.at, { agentId: '__intro', kind: 'intro', midis: [n.midi], velocity: n.vel, duration: n.dur, index: 0 });
    }
    // silence... then the conductor taps the stand twice
    const tap1 = now + 4.6;
    const tap2 = tap1 + 0.5;
    this.hit(ens, 'snare', 'snare1_rimshot_f', tap1, 0.12, 0.3);
    this.hit(ens, 'snare', 'snare1_rimshot_f', tap2, 0.12, 0.3);
    this.drawAt(tap1, { agentId: '__baton', kind: 'intro', midis: [], velocity: 1, duration: 0.2, index: 1 });
    this.drawAt(tap2, { agentId: '__baton', kind: 'intro', midis: [], velocity: 1, duration: 0.2, index: 2 });
    const downbeat = tap2 + (60 / BPM) * 1.0;
    setTimeout(() => (this.padVol.volume.value = -20), (downbeat - Tone.now()) * 1000);
    const transport = Tone.getTransport();
    transport.position = 0;
    transport.start(downbeat);
    this.started = true;
    // the first chord: a soft tutti D major
    ens.sampler('strings_sus').triggerAttackRelease(voicing(CHORDS.I, 62, 4).map(toNote), 4.5, downbeat, 0.7);
    ens.sampler('bass_sus').triggerAttackRelease(toNote(38), 4, downbeat, 0.75);
    ens.sampler('harp').triggerAttackRelease(toNote(50), 3, downbeat, 0.6);
    this.hit(ens, 'cymbal', 'suscymb1_hit_mp_rr1', downbeat, 0.25, 4);
    this.harpGliss(downbeat + 0.05, 50, 86, 0.024, 0.45);
    this.drawAt(downbeat, { agentId: '__all', kind: 'resolve', midis: [38, 62, 66, 69], velocity: 0.8, duration: 2, index: 0 });
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
    this.chord = this.lockedChord ?? PROGRESSION[this.bar % PROGRESSION.length];
    this.emit('bar', { chord: this.chord, bar });
    if (this.fermata || this.lockedChord) return;
    // the bed: a soft string pad that follows how busy the orchestra is
    const now = performance.now();
    let active = 0;
    for (const v of this.voices.values()) if (now - v.lastEventAt < 7000) active++;
    if (!active) return;
    const vel = Math.min(0.75, 0.3 + active * 0.09);
    const ens = this.ensemble;
    const slot = bar % 2;
    ens.sampler('strings_sus', slot).triggerAttackRelease(voicing(this.chord, 57, 3).map(toNote), (60 / BPM) * 4.3, time, vel);
    if (active >= 3) ens.sampler('cello_trem', slot).triggerAttackRelease(toNote(bassNote(this.chord, 40, 52)), (60 / BPM) * 4.2, time, 0.22);
  }

  private get spb() {
    return 60 / Tone.getTransport().bpm.value;
  }

  private s16(n: number) {
    return (this.spb / 4) * n;
  }

  /** Plays the phrase for one event. Returns its length in 16ths. */
  private playPhrase(v: Voice, ev: AgentEvent, time: number): number {
    if (v.instrument === 'percussion') return this.playPercussion(v, ev.kind, time);
    const spec = SPECS[v.instrument];
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
    if (v.instrument === 'percussion') {
      this.hit(v, 'snare', step % 4 === 0 ? 'snare1_mp_1' : 'snare1_pp_1', time, 0.35, 0.3);
      this.drawAt(time, { agentId: v.agentId, kind: 'run', midis: [60], velocity: 0.35, duration: 0.1, index: step });
      return;
    }
    const spec = SPECS[v.instrument];
    const r = scaleStep(v.lastMidi, v.runDir, spec.range[0] + 2, spec.range[1] - 4);
    v.runDir = r.dir;
    v.lastMidi = r.midi;
    const accent = step % 4 === 0;
    const group = ev.kind === 'file_read' && v.instrument === 'violin' ? 'violin_pizz' : spec.motif;
    v.sampler(group).triggerAttackRelease(toNote(r.midi), 0.3, time, accent ? 0.48 : 0.34);
    this.drawAt(time, { agentId: v.agentId, kind: 'run', midis: [r.midi], velocity: accent ? 0.5 : 0.35, duration: 0.12, index: step });
  }

  private playPercussion(v: Voice, kind: AgentEventKind, time: number): number {
    const draw = (midis: number[], vel: number, k: NoteInfo['kind'], at = time, index = 0) =>
      this.drawAt(at, { agentId: v.agentId, kind: k, midis, velocity: vel, duration: 0.2, index });
    const root = bassNote(this.chord, 33, 44);
    switch (kind) {
      case 'file_read':
        v.sampler('timp').triggerAttackRelease(toNote(root), 1.2, time, 0.22);
        draw([root], 0.25, 'file_read');
        return 2;
      case 'tool_start':
        ['snare1_pp_1', 'snare1_pp_1', 'snare1_mp_1'].forEach((n, k) => {
          this.hit(v, 'snare', n, time + this.s16(k) * 0.5, 0.3 + k * 0.12, 0.4);
          draw([60], 0.3, 'tool_start', time + this.s16(k) * 0.5, k);
        });
        return 3;
      case 'file_write':
        v.sampler('timp').triggerAttackRelease(toNote(root), 1.5, time, 0.5);
        this.hit(v, 'bdrum', 'bdrum_pp_1', time, 0.4, 1);
        draw([root], 0.5, 'file_write');
        return 4;
      case 'bash': {
        const pat: Array<[string, string, number]> = [
          ['bdrum', 'bdrum_mp_1', 0.5],
          ['snare', 'snare1_pp_1', 0.28],
          ['snare', 'snare1_mp_1', 0.42],
          ['snare', 'snare1_pp_1', 0.3],
        ];
        pat.forEach(([g, n, vel], k) => {
          this.hit(v, g, n, time + this.s16(k), vel, 0.5);
          draw([60], vel, 'bash', time + this.s16(k), k);
        });
        return 4;
      }
      case 'thinking':
        this.hit(v, 'triangle', 'triangle3_hit_v1_rr1', time, 0.12, 1.5);
        draw([], 0.1, 'tuning');
        return 4;
      default:
        return 1;
    }
  }

  private hit(v: Voice, group: string, name: string, time: number, vel: number, dur: number) {
    const key = this.hitKeys.get(group)?.get(name);
    if (key === undefined) return;
    v.sampler(group).triggerAttackRelease(toNote(key), dur, time, vel);
  }

  private harpGliss(time: number, from: number, to: number, step: number, vel: number, dir: 1 | -1 = 1) {
    const tones = chordTones(this.lockedChord ?? this.chord, from, to);
    if (dir < 0) tones.reverse();
    const s = this.ensemble.sampler('harp');
    tones.forEach((m, k) => s.triggerAttackRelease(toNote(m), 2.2, time + k * step, vel * (0.7 + 0.3 * (k / tones.length))));
  }

  // ------------------------------------------------------------------ dramatic moments

  private playError(v: Voice, time: number) {
    const ens = this.ensemble;
    const base = v.instrument === 'percussion' ? 62 : Math.round((SPECS[v.instrument].range[0] + SPECS[v.instrument].range[1]) / 2);
    // minor second + tritone: unmistakably "something is off", but brief
    const cluster = [base, base + 1, base + 6];
    if (v.instrument === 'percussion') {
      this.hit(v, 'snare', 'snare1_rimshot_f', time, 0.7, 0.5);
      v.sampler('timp').triggerAttackRelease([toNote(38), toNote(39)], 1.8, time, 0.7);
      this.hit(v, 'cymbal', 'cymbal_crash1_mf_rr1', time, 0.32, 2.5);
    } else {
      const spec = SPECS[v.instrument];
      v.sampler(spec.chord).triggerAttackRelease(cluster.slice(0, Math.max(2, spec.chordSize)).map(toNote), 1.4, time, 0.7);
    }
    ens.sampler('piano').triggerAttackRelease([toNote(51), toNote(52), toNote(58), toNote(63)], 1.6, time, 0.55);
    ens.sampler('cello_trem').triggerAttackRelease([toNote(45), toNote(46)], 1.6, time, 0.45);
    this.drawAt(time, { agentId: v.agentId, kind: 'test_fail', midis: cluster, velocity: 0.8, duration: 1.4, index: 0 });
    v.busyUntil = this.stepAt(time) + 8;
  }

  private playCadence(v: Voice, time: number) {
    // V → I in the timpani, cymbal swell, the strings answer
    const ens = this.ensemble;
    const b = this.spb;
    v.sampler('timp').triggerAttackRelease(toNote(33), 1, time, 0.6);
    v.sampler('timp').triggerAttackRelease(toNote(33), 1, time + b * 0.5, 0.45);
    v.sampler('timp').triggerAttackRelease(toNote(38), 2.5, time + b, 0.85);
    this.hit(v, 'cymbal', 'suscymb1_hit_mp_rr1', time + b, 0.5, 4);
    this.hit(v, 'triangle', 'triangle3_hit_v1_rr2', time + b, 0.3, 2);
    ens.sampler('strings_sus').triggerAttackRelease(voicing(CHORDS.V7, 57, 4).map(toNote), b, time, 0.6);
    ens.sampler('strings_sus').triggerAttackRelease(voicing(CHORDS.I, 62, 4).map(toNote), b * 3, time + b, 0.75);
    ens.sampler('glock').triggerAttackRelease([toNote(86), toNote(90)], 2, time + b, 0.35);
    this.drawAt(time, { agentId: v.agentId, kind: 'test_pass', midis: [33], velocity: 0.6, duration: b, index: 0 });
    this.drawAt(time + b, { agentId: v.agentId, kind: 'test_pass', midis: [38, 62, 66, 69], velocity: 0.9, duration: 2, index: 1 });
    v.busyUntil = this.stepAt(time) + 12;
  }

  private playFinale(v: Voice, time: number) {
    const s16 = this.s16(1);
    if (v.instrument === 'percussion') return this.playCadence(v, time);
    const spec = SPECS[v.instrument];
    const tones = chordTones(CHORDS.I, spec.range[0] + 3, spec.range[1]);
    const up = tones.slice(0, 5);
    up.forEach((m, k) => {
      v.sampler(spec.motif).triggerAttackRelease(toNote(m), 0.5, time + k * s16 * 2, 0.45 + k * 0.05);
      this.drawAt(time + k * s16 * 2, { agentId: v.agentId, kind: 'task_done', midis: [m], velocity: 0.5, duration: 0.3, index: k });
    });
    const end = time + up.length * s16 * 2;
    const top = up[up.length - 1];
    v.sampler(spec.long).triggerAttackRelease(toNote(top), 2.5, end, 0.6);
    this.ensemble.sampler('glock').triggerAttackRelease(toNote(top + 12 > 96 ? top : top + 12), 2, end, 0.3);
    this.ensemble.sampler('harp').triggerAttackRelease(voicing(CHORDS.I, 50, 3).map(toNote), 2, end, 0.5);
    this.drawAt(end, { agentId: v.agentId, kind: 'task_done', midis: [top], velocity: 0.8, duration: 2.5, index: 9 });
    v.busyUntil = this.stepAt(time) + 16;
  }

  private playJoin(ev: AgentEvent, time: number) {
    // a new voice enters: rising harp arpeggio + a held note that will become the new layer
    this.harpGliss(time, 55, 84, this.s16(1) / 2, 0.5);
    this.ensemble.sampler('violin').triggerAttackRelease(toNote(nearestChordTone(this.chord, 74, 69, 81)), 2.2, time + this.s16(4), 0.3);
    this.drawAt(time, { agentId: ev.child?.id ?? ev.agentId, kind: 'subagent_join', midis: [], velocity: 0.6, duration: 1, index: 0 });
  }

  private playLeave(time: number) {
    this.harpGliss(time, 55, 84, this.s16(1) / 2, 0.35, -1);
  }

  // ------------------------------------------------------------------ fermata

  private startFermata(v: Voice, time: number) {
    if (this.fermata) return;
    this.lockedChord = CHORDS.V7;
    this.chord = CHORDS.V7;
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
    const layer = new Set<string>();
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
      const notes: Array<[string, number, number]> = [
        ['cello_trem', 45, 0.5],
        ['cello_trem', 52, 0.42],
      ];
      if (tension > 0.1) notes.push(['strings_trem', 57, 0.45], ['strings_trem', 61, 0.42]);
      if (tension > 0.28) notes.push(['strings_trem', 64, 0.42], ['strings_trem', 67, 0.48]);
      if (tension > 0.48) notes.push(['strings_trem', 73, 0.45]);
      if (tension > 0.66) notes.push(['strings_trem', 74, 0.38], ['strings_trem', 81, 0.4]);
      if (tension > 0.82) notes.push(['strings_trem', 79, 0.42], ['strings_trem', 85, 0.32]);
      for (const [g, m, vel] of notes) {
        sampler(g).triggerAttackRelease(toNote(m), bar * 1.6, t, vel);
        layer.add(`${g}:${m}`);
      }
      if (tension > 0.4) sampler('timp_roll').triggerAttackRelease(toNote(33), bar * 1.5, t, 0.25 + tension * 0.5);
    };
    holdNotes(time, 0);
    // first, the waiting musician's own instrument rings out
    if (v.instrument !== 'percussion') {
      const spec = SPECS[v.instrument];
      const m = nearestChordTone(CHORDS.V7, v.lastMidi, spec.range[0], spec.range[1]);
      v.sampler(spec.long).triggerAttackRelease(toNote(m), 3, time, 0.55);
      if (v.instrument === 'piano') v.sampler('piano').triggerAttackRelease(voicing(CHORDS.V7, 45, 4).map(toNote), 4, time, 0.5);
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
            this.hit(this.ensemble, 'bdrum', 'bdrum_pp_1', t, vel, 0.8);
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

    const ens = this.ensemble;
    const target = approved ? CHORDS.I : CHORDS.vi;
    this.lockedChord = target;
    this.chord = target;
    this.resumeAt = transport.nextSubdivision('1m') > time + 0.4 ? transport.nextSubdivision('1m') : time + this.spb * 4;
    if (!approved) this.bar = 1; // after vi continue at iii — a deceptive cadence feels like "not yet"
    const prevPad = this.padVol.volume.value;
    this.padVol.volume.setValueAtTime(-9, time);
    this.padVol.volume.linearRampToValueAtTime(prevPad, time + 4);

    if (approved) {
      ens.sampler('strings_sus').triggerAttackRelease([62, 66, 69, 74, 78].map(toNote), 5, time, 0.85);
      ens.sampler('cello_trem').triggerAttackRelease([toNote(38), toNote(50)], 3, time, 0.5);
      ens.sampler('bass_sus').triggerAttackRelease(toNote(38), 4.5, time, 0.85);
      ens.sampler('piano').triggerAttackRelease([38, 50, 57, 62, 66].map(toNote), 4, time, 0.6);
      ens.sampler('timp').triggerAttackRelease(toNote(38), 3, time, 0.8);
      this.hit(ens, 'cymbal', 'suscymb1_hit_mp_rr1', time, 0.55, 5);
      this.hit(ens, 'triangle', 'triangle3_hit_v1_rr1', time + 0.02, 0.4, 3);
      ens.sampler('glock').triggerAttackRelease([toNote(86), toNote(93)], 2.5, time + this.s16(2), 0.4);
      this.harpGliss(time + 0.03, 50, 90, 0.028, 0.55);
    } else {
      ens.sampler('strings_sus').triggerAttackRelease([59, 62, 66, 71].map(toNote), 4, time, 0.6);
      ens.sampler('bass_sus').triggerAttackRelease(toNote(35), 4, time, 0.6);
      ens.sampler('piano').triggerAttackRelease([47, 59, 62, 66].map(toNote), 3, time, 0.4);
      this.harpGliss(time + 0.03, 59, 86, 0.04, 0.35, -1);
    }
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

  private stepAt(time: number) {
    return Math.round(Tone.getTransport().getTicksAtTime(time) / TICKS_PER_16TH);
  }

  private drawAt(time: number, info: NoteInfo) {
    Tone.getDraw().schedule(() => this.emit('note', info), time);
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
