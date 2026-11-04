import * as Tone from 'tone';
import { ROOTS, drums, pulse, triangle } from '../chip';
import type { Chord } from '../theory';
import { bassNote, chordTones, nearestChordTone, voicing } from '../theory';
import type { HeldNote, NoteInfo, SoundTheme } from '../sound-theme';

/**
 * The Chiptune arcade: A minor at 140 BPM on a little sound chip made in code
 * (see ../chip): three pulse channels, a triangle bass and a noise drum kit.
 * While the band is busy the bass jumps octaves, the drums keep a straight dance
 * beat and the lead pulse arpeggiates the chord in sixteenths.
 * The fermata holds E7♭9 and resolves to A minor with a "level up" run.
 *
 * Unlike the other themes nothing here is sampled: chip music is synthesised
 * by nature (README and CREDITS say so).
 */

const BPM = 140;
const toNote = (m: number) => Tone.Frequency(m, 'midi').toNote();
const ch = (name: string, tones: number[], bass = tones[0]): Chord => ({ name, tones, bass });

// A=9 B=11 C=0 D=2 E=4 F=5 G=7
const A_MINOR = [9, 11, 0, 2, 4, 5, 7];
const C = {
  Am: ch('Am', [9, 0, 4]),
  F: ch('F', [5, 9, 0]),
  C: ch('C', [0, 4, 7]),
  G: ch('G', [7, 11, 2]),
  Dm: ch('Dm', [2, 5, 9]),
  E: ch('E', [4, 8, 11]),
  E7b9: ch('E7♭9', [4, 8, 11, 2, 5]),
};

const notes = (make: (midi: number, rate: number) => Float32Array) => (rate: number) => new Map(ROOTS.map((m) => [m, make(m, rate)] as const));

// the noise kit
const KICK = 'kick';
const SNARE = 'snare';
const HAT = 'hat';
const HAT_OPEN = 'hat_open';
const CRASH = 'crash';

/** A minor, spread across the channels. */
const AM_CHORD: Array<[string, number]> = [
  ['tri', 33],
  ['sq50', 57],
  ['sq50', 60],
  ['sq50', 64],
  ['sq25', 69],
  ['sq12', 76],
];

export const chiptune: SoundTheme = {
  bpm: BPM,
  swing: 0,
  groups: ['sq50', 'sq25', 'sq12', 'tri', 'chipkit'],
  synth: {
    sq50: notes((m, rate) => pulse(m, 0.5, rate)),
    sq25: notes((m, rate) => pulse(m, 0.25, rate)),
    sq12: notes((m, rate) => pulse(m, 0.125, rate)),
    tri: notes((m, rate) => triangle(m, rate)),
    chipkit: drums,
  },
  progression: [C.Am, C.F, C.C, C.G, C.Am, C.F, C.Dm, C.E],
  tonic: C.Am,
  dominant: C.E7b9,
  deceptive: C.F,
  scale: A_MINOR,
  specs: {
    piano: { range: [55, 84], soft: 'sq50', motif: 'sq50', chord: 'sq50', rhythm: 'sq50', long: 'sq50', chordSize: 3, gainDb: -14, tuningNote: 69 },
    // the violin chair plays the lead pulse
    violin: { range: [60, 88], soft: 'sq25', motif: 'sq25', chord: 'sq25', rhythm: 'sq25', long: 'sq25', chordSize: 1, gainDb: -13, tuningNote: 76 },
    // the flute chair plays the thin, bright pulse
    flute: { range: [64, 96], soft: 'sq12', motif: 'sq12', chord: 'sq12', rhythm: 'sq12', long: 'sq12', chordSize: 1, gainDb: -15, tuningNote: 81 },
    // the double bass chair plays the triangle
    contrabass: { range: [28, 52], soft: 'tri', motif: 'tri', chord: 'tri', rhythm: 'tri', long: 'tri', chordSize: 1, gainDb: -3, tuningNote: 33 },
  },
  env: {
    sq50: { attack: 0.002, release: 0.06 },
    sq25: { attack: 0.002, release: 0.06 },
    sq12: { attack: 0.002, release: 0.06 },
    tri: { attack: 0.002, release: 0.04 },
    chipkit: { attack: 0.001, release: 0.05 },
  },
  reverb: { decay: 0.8, wet: 0.08, preDelay: 0.01 },

  intro(k, now) {
    const ens = k.ensemble;
    const b = 60 / BPM;
    // power on: the triangle climbs, then the pulses answer with an A minor run
    const boot: Array<[string, number, number, number, number]> = [
      ['tri', 33, 0, 0.6, 0.12],
      ['tri', 45, 0.12, 0.6, 0.12],
      ['tri', 57, 0.24, 0.6, 0.3],
      ['sq12', 88, 0.9, 0.3, 0.08],
      ['sq12', 93, 1.0, 0.3, 0.3],
      ['sq25', 69, 1.6, 0.35, 0.1],
      ['sq25', 72, 1.72, 0.35, 0.1],
      ['sq25', 76, 1.84, 0.35, 0.1],
      ['sq25', 81, 1.96, 0.35, 0.4],
      ['sq50', 64, 2.6, 0.3, 0.6],
      ['sq50', 62, 3.0, 0.3, 0.6],
    ];
    for (const [g, m, at, vel, dur] of boot) {
      ens.sampler(g).triggerAttackRelease(toNote(m), dur, now + at, vel);
      k.draw(now + at, { agentId: '__intro', kind: 'intro', midis: [m], velocity: vel, duration: dur, index: 0 });
    }
    // count-in on the hat: one, two, three, four
    const t0 = now + 4;
    [0, 1, 2, 3].forEach((beat, i) => {
      k.hit(ens, 'chipkit', i === 3 ? SNARE : HAT, t0 + beat * b, 0.5, 0.1);
      k.draw(t0 + beat * b, { agentId: '__baton', kind: 'intro', midis: [], velocity: 1, duration: 0.2, index: i + 1 });
    });
    const downbeat = t0 + 4 * b;
    for (const [g, m] of AM_CHORD) ens.sampler(g).triggerAttackRelease(toNote(m), 1.4, downbeat, 0.45);
    k.hit(ens, 'chipkit', CRASH, downbeat, 0.45, 1.4);
    k.hit(ens, 'chipkit', KICK, downbeat, 0.7, 0.3);
    k.draw(downbeat, { agentId: '__all', kind: 'resolve', midis: [33, 57, 64, 69], velocity: 0.8, duration: 2, index: 0 });
    return downbeat;
  },

  bed(k, time, _bar, active) {
    const ens = k.ensemble;
    const b = k.spb;
    const lift = Math.min(1, 0.6 + active * 0.08);
    // the triangle jumps octaves in eighths
    const root = bassNote(k.chord, 28, 40);
    for (let i = 0; i < 8; i++) ens.sampler('tri').triggerAttackRelease(toNote(root + (i % 2 ? 12 : 0)), b * 0.42, time + (i * b) / 2, 0.75 * lift);
    // a straight dance beat: kick on every beat, snare on 2 and 4, hats on the offbeats
    for (let i = 0; i < 4; i++) {
      k.hit(ens, 'chipkit', KICK, time + i * b, 0.55 * lift, 0.25);
      if (i % 2) k.hit(ens, 'chipkit', SNARE, time + i * b, 0.42 * lift, 0.25);
      k.hit(ens, 'chipkit', HAT, time + i * b + b / 2, 0.3 * lift, 0.08);
    }
    // the classic chip arpeggio: the chord in sixteenths, once two or more are playing
    if (active >= 2) {
      const tones = voicing(k.chord, 57, 3);
      for (let i = 0; i < 16; i++) ens.sampler('sq50').triggerAttackRelease(toNote(tones[i % tones.length]), k.s16(1) * 0.8, time + k.s16(i), 0.22);
    }
  },

  percussion(k, v, kind, time) {
    const b = k.spb;
    const draw = (vel: number, kd: NoteInfo['kind'], at = time, index = 0) =>
      k.draw(at, { agentId: v.agentId, kind: kd, midis: [60], velocity: vel, duration: 0.2, index });
    switch (kind) {
      case 'file_read':
        k.hit(v, 'chipkit', HAT, time, 0.4, 0.08);
        k.hit(v, 'chipkit', HAT, time + b / 4, 0.3, 0.08);
        draw(0.3, 'file_read');
        return 2;
      case 'tool_start':
        [0, b / 4, b / 2].forEach((at, i) => {
          k.hit(v, 'chipkit', HAT, time + at, 0.3 + i * 0.1, 0.08);
          draw(0.3, 'tool_start', time + at, i);
        });
        return 4;
      case 'file_write':
        k.hit(v, 'chipkit', KICK, time, 0.7, 0.3);
        k.hit(v, 'chipkit', SNARE, time + b / 2, 0.5, 0.25);
        draw(0.5, 'file_write');
        return 4;
      case 'bash': {
        const pat: Array<[string, number, number]> = [
          [KICK, 0, 0.6],
          [HAT, b / 4, 0.3],
          [SNARE, b / 2, 0.45],
          [HAT, (3 * b) / 4, 0.3],
        ];
        pat.forEach(([n, at, vel], i) => {
          k.hit(v, 'chipkit', n, time + at, vel, 0.2);
          draw(vel, 'bash', time + at, i);
        });
        return 4;
      }
      case 'thinking':
        k.hit(v, 'chipkit', HAT, time, 0.18, 0.08);
        draw(0.1, 'tuning');
        return 4;
      default:
        return 1;
    }
  },

  percussionRun(k, v, time, step) {
    k.hit(v, 'chipkit', step % 4 === 0 ? SNARE : HAT, time, step % 4 === 0 ? 0.45 : 0.3, 0.1);
    k.draw(time, { agentId: v.agentId, kind: 'run', midis: [60], velocity: 0.35, duration: 0.1, index: step });
  },

  error(k, v, time) {
    const ens = k.ensemble;
    const spec = v.instrument === 'percussion' ? null : chiptune.specs[v.instrument];
    const base = spec ? Math.round((spec.range[0] + spec.range[1]) / 2) : 64;
    if (!spec) {
      k.hit(v, 'chipkit', CRASH, time, 0.5, 0.8);
      k.hit(v, 'chipkit', KICK, time, 0.7, 0.3);
    }
    // a falling, sour run: "you lost a life"
    const run = [base + 6, base + 5, base, base - 1, base - 6];
    run.forEach((m, i) => (spec ? v.sampler(spec.chord) : ens.sampler('sq25')).triggerAttackRelease(toNote(m), 0.1, time + i * 0.09, 0.5));
    ens.sampler('tri').triggerAttackRelease(toNote(29), 0.6, time + 0.45, 0.6);
    k.draw(time, { agentId: v.agentId, kind: 'test_fail', midis: [base, base + 1, base + 6], velocity: 0.8, duration: 1.4, index: 0 });
  },

  cadence(k, v, time) {
    // a snare fill, E → A minor, and a run up on top: level up
    const ens = k.ensemble;
    const b = k.spb;
    [0, b / 4, b / 2, (3 * b) / 4].forEach((at, i) => k.hit(v, 'chipkit', SNARE, time + at, 0.35 + i * 0.08, 0.2));
    ens.sampler('sq50').triggerAttackRelease(voicing(C.E, 56, 3).map(toNote), b * 0.9, time, 0.4);
    ens.sampler('tri').triggerAttackRelease(toNote(40), b * 0.9, time, 0.7);
    for (const [g, m] of AM_CHORD) ens.sampler(g).triggerAttackRelease(toNote(m), b * 2, time + b, 0.45);
    [69, 72, 76, 81, 84, 88].forEach((m, i) => ens.sampler('sq12').triggerAttackRelease(toNote(m), 0.08, time + b + i * 0.06, 0.35));
    k.hit(v, 'chipkit', CRASH, time + b, 0.45, 1.2);
    k.hit(v, 'chipkit', KICK, time + b, 0.7, 0.3);
    k.draw(time, { agentId: v.agentId, kind: 'test_pass', midis: [40], velocity: 0.6, duration: b, index: 0 });
    k.draw(time + b, { agentId: v.agentId, kind: 'test_pass', midis: [33, 57, 64, 69], velocity: 0.9, duration: 2, index: 1 });
  },

  finaleTail(k, time) {
    [81, 84, 88, 93].forEach((m, i) => k.ensemble.sampler('sq12').triggerAttackRelease(toNote(m), 0.1, time + i * 0.07, 0.3));
  },

  join(k, time) {
    // a quick run up, landing on a chord tone
    k.gliss('sq12', time, 69, 93, k.s16(1) / 2, 0.3);
    k.ensemble.sampler('sq25').triggerAttackRelease(toNote(nearestChordTone(k.chord, 76, 69, 81)), 0.4, time + k.s16(4), 0.35);
  },

  leave(k, time) {
    k.gliss('sq12', time, 69, 93, k.s16(1) / 2, 0.24, -1);
  },

  fermataNotes(tension) {
    // E7♭9 from the bottom: E, D, G♯ ... up to the F on the thinnest pulse
    const notes: HeldNote[] = [
      ['tri', 28, 0.7],
      ['sq50', 50, 0.3],
      ['sq50', 56, 0.3],
    ];
    if (tension > 0.1) notes.push(['tri', 40, 0.5]);
    if (tension > 0.28) notes.push(['sq25', 59, 0.3], ['sq50', 62, 0.28]);
    if (tension > 0.48) notes.push(['sq25', 65, 0.3]);
    if (tension > 0.66) notes.push(['sq12', 68, 0.3], ['sq25', 74, 0.3]);
    if (tension > 0.82) notes.push(['sq12', 77, 0.32], ['sq12', 83, 0.28]);
    return notes;
  },

  fermataRoll(k, _sampler, t, bar, tension) {
    if (tension < 0.3) return;
    // the snare rolls faster as the tension rises
    const strokes = 4 + Math.round(tension * 12);
    for (let i = 0; i < strokes; i++) k.hit(k.ensemble, 'chipkit', i % 2 ? HAT : SNARE, t + (bar / strokes) * i, 0.15 + tension * 0.3 * (i / strokes), 0.1);
  },

  heartbeat(k, t, vel) {
    k.hit(k.ensemble, 'chipkit', KICK, t, vel, 0.3);
  },

  resolve(k, time, approved) {
    const ens = k.ensemble;
    if (approved) {
      for (const [g, m] of AM_CHORD) ens.sampler(g).triggerAttackRelease(toNote(m), 2, time, 0.5);
      // level up
      [69, 72, 76, 81, 84, 88, 93].forEach((m, i) => ens.sampler('sq12').triggerAttackRelease(toNote(m), 0.08, time + 0.05 + i * 0.055, 0.35));
      k.hit(ens, 'chipkit', CRASH, time, 0.5, 1.6);
      k.hit(ens, 'chipkit', KICK, time, 0.75, 0.3);
    } else {
      ens.sampler('sq50').triggerAttackRelease(chordTones(C.F, 53, 66).map(toNote), 1.4, time, 0.35);
      ens.sampler('tri').triggerAttackRelease(toNote(29), 1.2, time, 0.6);
      k.hit(ens, 'chipkit', HAT_OPEN, time, 0.35, 0.4);
      k.gliss('sq12', time + 0.05, 65, 89, 0.05, 0.25, -1);
    }
  },
};
