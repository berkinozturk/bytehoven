import type * as Tone from 'tone';
import type { AgentEventKind, InstrumentId } from '../core/events';
import type { Chord } from './theory';

/**
 * A sound theme: what the band plays. The engine owns the clock, the queues
 * and the scheduling; a theme decides the harmony, the instruments behind the
 * five chairs and every "moment" (intro, bed, cadence, error, fermata ...).
 *
 * The five chairs keep their ids everywhere else (piano, violin, flute,
 * contrabass, percussion); a theme only decides what each one sounds like,
 * e.g. in the jazz club the violin chair plays tenor sax.
 */

export type Melodic = Exclude<InstrumentId, 'percussion'>;

export interface InstrumentSpec {
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

export interface NoteInfo {
  agentId: string;
  kind: AgentEventKind | 'run' | 'tuning' | 'resolve' | 'intro';
  midis: number[];
  velocity: number;
  duration: number;
  /** Index within a phrase, for visuals that want to animate per hit. */
  index: number;
}

/** A musician's voice, as a theme sees it. */
export interface VoiceLike {
  readonly agentId: string;
  readonly instrument: InstrumentId;
  lastMidi: number;
  busyUntil: number;
  sampler(group: string, slot?: number): Tone.Sampler;
}

/** What the engine lends a theme. */
export interface Kit {
  readonly ensemble: VoiceLike;
  readonly chord: Chord;
  /** The chord of the next bar (a walking bass leads into it). */
  readonly nextChord: Chord;
  readonly spb: number;
  readonly padVol: Tone.Volume;
  s16(n: number): number;
  stepAt(time: number): number;
  hit(v: VoiceLike, group: string, name: string, time: number, vel: number, dur: number): void;
  /** Arpeggiate the sounding chord on `group` (a harp or piano sweep). */
  gliss(group: string, time: number, from: number, to: number, step: number, vel: number, dir?: 1 | -1): void;
  draw(time: number, info: NoteInfo): void;
}

/** One note of the held fermata chord: [group, midi, velocity]. */
export type HeldNote = [string, number, number];

export interface SoundTheme {
  bpm: number;
  /** 0 = straight eighths, ~0.6 = a jazz swing feel. */
  swing: number;
  /** Sample groups this theme needs (only these are loaded). */
  groups: string[];
  /**
   * Groups made in code instead of loaded: notes by MIDI number (pitched) or hits by name.
   * Called once with the audio context's sample rate.
   */
  synth?: Record<string, (rate: number) => Map<number, Float32Array> | Record<string, Float32Array>>;
  progression: Chord[];
  tonic: Chord;
  dominant: Chord;
  /** Where "Deny" lands: a deceptive cadence. */
  deceptive: Chord;
  /** Pitch classes of the scale runs walk on. */
  scale: number[];
  specs: Record<Melodic, InstrumentSpec>;
  env: Record<string, { attack: number; release: number }>;
  reverb: { decay: number; wet: number; preDelay: number };
  /** A worn-tape colour on the whole band: a dull top end, a slow wobble, vinyl crackle. */
  texture?: { lowpass: number; wobble: number; crackle: boolean };

  /** Warm-up and count-in. Returns the context time of the first downbeat. */
  intro(k: Kit, now: number): number;
  /** The bed under the band, once per bar while anyone is busy. */
  bed(k: Kit, time: number, bar: number, active: number): void;
  percussion(k: Kit, v: VoiceLike, kind: AgentEventKind, time: number): number;
  percussionRun(k: Kit, v: VoiceLike, time: number, step: number): void;
  error(k: Kit, v: VoiceLike, time: number): void;
  cadence(k: Kit, v: VoiceLike, time: number): void;
  /** Called at the end of a melodic musician's finale run (the sparkle on top). */
  finaleTail(k: Kit, time: number, top: number): void;
  join(k: Kit, time: number): void;
  leave(k: Kit, time: number): void;
  /** The held chord, growing with tension (0..1). Played once per bar. */
  fermataNotes(tension: number): HeldNote[];
  /** Extra layer under the held chord once per bar (a roll), optional. */
  fermataRoll?(k: Kit, sampler: (g: string) => Tone.Sampler, t: number, bar: number, tension: number): void;
  heartbeat(k: Kit, t: number, vel: number): void;
  resolve(k: Kit, time: number, approved: boolean): void;
}
