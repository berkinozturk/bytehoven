import * as Tone from 'tone';
import type { Chord } from '../theory';
import { bassNote, chordTones, nearestChordTone, voicing } from '../theory';
import type { HeldNote, NoteInfo, SoundTheme } from '../sound-theme';

/**
 * The Lo-fi room: C major, slow and lazy. A felt-soft upright piano, a jazz
 * guitar, soft-mallet vibes, a finger bass and a dusty kit, all through a worn
 * tape (dull top, slow wobble) with vinyl crackle under it. While the band is
 * busy the kit plays a laid-back boom-bap and the piano holds long ninth chords.
 * The fermata holds G7♭9 and resolves to Cmaj9.
 */

const BPM = 76;
const toNote = (m: number) => Tone.Frequency(m, 'midi').toNote();
const ch = (name: string, tones: number[], bass = tones[0]): Chord => ({ name, tones, bass });

// C=0 D=2 E=4 F=5 G=7 A=9 B=11
const C_MAJOR = [0, 2, 4, 5, 7, 9, 11];
const C = {
  Cmaj9: ch('Cmaj9', [0, 4, 7, 11, 2]),
  Am9: ch('Am9', [9, 0, 4, 7, 11]),
  Dm9: ch('Dm9', [2, 5, 9, 0, 4]),
  G13: ch('G13', [7, 11, 5, 9, 4]),
  Em7: ch('Em7', [4, 7, 11, 2]),
  G7: ch('G7', [7, 11, 2, 5]),
  G7b9: ch('G7♭9', [7, 11, 2, 5, 8]),
};

/** The "and" of a beat, dragged late: lo-fi sits behind the beat. */
const late = (b: number) => b * 0.6;

// kit hits (Virtuosity Drums, mid mic), played soft and dull
const KICK = 'kick_snoff_vl1_rr1';
const KICK_F = 'kick_snoff_vl2_rr1';
const SNARE = 'snare_center_vl6';
const STICK = 'snare_crossstick_vl8';
const RIM = 'snare_rimshot_vl6';
const HH = 'hh_closed_vl2_rr1';
const HH_PEDAL = 'hh_pedal_vl2_rr1';
const HH_OPEN = 'hh_open_vl2_rr1';

/** Cmaj9 and Am9 spread for the upright. */
const CMAJ9 = [36, 48, 52, 55, 59, 62];
const AM9 = [33, 45, 48, 52, 55, 59];

export const lofi: SoundTheme = {
  bpm: BPM,
  swing: 0.6,
  groups: ['upright', 'guitar', 'vibes', 'ebass', 'kit'],
  progression: [C.Cmaj9, C.Am9, C.Dm9, C.G13, C.Em7, C.Am9, C.Dm9, C.G7],
  tonic: C.Cmaj9,
  dominant: C.G7b9,
  deceptive: C.Am9,
  scale: C_MAJOR,
  specs: {
    piano: { range: [48, 84], soft: 'upright', motif: 'upright', chord: 'upright', rhythm: 'upright', long: 'upright', chordSize: 4, gainDb: -3, tuningNote: 60 },
    // the violin chair plays jazz guitar
    violin: { range: [45, 76], soft: 'guitar', motif: 'guitar', chord: 'guitar', rhythm: 'guitar', long: 'guitar', chordSize: 3, gainDb: -4, tuningNote: 52 },
    // the flute chair plays soft-mallet vibes
    flute: { range: [55, 88], soft: 'vibes', motif: 'vibes', chord: 'vibes', rhythm: 'vibes', long: 'vibes', chordSize: 2, gainDb: -7, tuningNote: 72 },
    // the double bass chair plays finger bass
    contrabass: { range: [28, 50], soft: 'ebass', motif: 'ebass', chord: 'ebass', rhythm: 'ebass', long: 'ebass', chordSize: 1, gainDb: -1, tuningNote: 28 },
  },
  env: {
    upright: { attack: 0.006, release: 1.2 },
    guitar: { attack: 0.004, release: 0.6 },
    vibes: { attack: 0.004, release: 1.6 },
    ebass: { attack: 0.006, release: 0.4 },
  },
  reverb: { decay: 2.4, wet: 0.2, preDelay: 0.02 },
  texture: { lowpass: 4200, wobble: 0.06, crackle: true },

  intro(k, now) {
    const ens = k.ensemble;
    const b = 60 / BPM;
    // the room wakes up: a vibes note, the guitar, the bass, a lazy piano roll
    const warm: Array<[string, number, number, number, number]> = [
      ['vibes', 76, 0, 0.35, 2.4],
      ['guitar', 52, 0.9, 0.35, 1.6],
      ['guitar', 59, 1.1, 0.3, 1.4],
      ['ebass', 28, 1.6, 0.5, 1.2],
      ['upright', 60, 2.3, 0.3, 1.2],
      ['upright', 64, 2.42, 0.28, 1.2],
      ['upright', 67, 2.54, 0.28, 1.2],
      ['upright', 71, 2.66, 0.3, 1.8],
      ['vibes', 74, 3.3, 0.3, 1.6],
    ];
    for (const [g, m, at, vel, dur] of warm) {
      ens.sampler(g).triggerAttackRelease(toNote(m), dur, now + at, vel);
      k.draw(now + at, { agentId: '__intro', kind: 'intro', midis: [m], velocity: vel, duration: dur, index: 0 });
    }
    // count-in on the cross-stick: one, two, three, four
    const t0 = now + 4.4;
    [0, 1, 2, 3].forEach((beat, i) => {
      k.hit(ens, 'kit', STICK, t0 + beat * b, 0.3, 0.3);
      k.draw(t0 + beat * b, { agentId: '__baton', kind: 'intro', midis: [], velocity: 1, duration: 0.2, index: i + 1 });
    });
    const downbeat = t0 + 4 * b;
    // the first chord: Cmaj9, with the piano rolled a little late
    CMAJ9.forEach((m, i) => ens.sampler('upright').triggerAttackRelease(toNote(m), 3, downbeat + i * 0.018, 0.6));
    ens.sampler('ebass').triggerAttackRelease(toNote(36), 1.6, downbeat, 0.8);
    ens.sampler('vibes').triggerAttackRelease(toNote(76), 2.4, downbeat, 0.35);
    k.hit(ens, 'kit', KICK_F, downbeat, 0.5, 1);
    k.draw(downbeat, { agentId: '__all', kind: 'resolve', midis: [36, 52, 59, 62], velocity: 0.8, duration: 2, index: 0 });
    return downbeat;
  },

  bed(k, time, _bar, active) {
    const ens = k.ensemble;
    const b = k.spb;
    const lift = Math.min(1, 0.6 + active * 0.08);
    // boom-bap: kick on 1 and the late "and" of 3, snare on 2 and 4, lazy eighths on the hat
    const kit: Array<[string, number, number]> = [
      [KICK, 0, 0.6],
      [SNARE, b, 0.42],
      [KICK, 2 * b + late(b), 0.45],
      [SNARE, 3 * b, 0.42],
    ];
    for (let i = 0; i < 8; i++) kit.push([HH, Math.floor(i / 2) * b + (i % 2 ? late(b) : 0), i % 2 ? 0.18 : 0.26]);
    for (const [n, at, vel] of kit) k.hit(ens, 'kit', n, time + at, vel * lift, 0.5);
    // the bass: root, then the fifth on the late "and" of 2, a lead-in on 4
    const root = bassNote(k.chord, 28, 40);
    const fifth = chordTones(k.chord, root + 5, root + 9)[0] ?? root + 7;
    const next = bassNote(k.nextChord, root - 5, root + 7);
    const line: Array<[number, number, number, number]> = [
      [root, 0, b * 1.4, 0.8],
      [fifth, b + late(b), b * 0.8, 0.6],
      [next + (next > root ? -2 : 2), 3 * b + late(b), b * 0.35, 0.5],
    ];
    for (const [m, at, dur, vel] of line) ens.sampler('ebass').triggerAttackRelease(toNote(m), dur, time + at, vel * lift);
    // the piano holds the chord, rolled, once two or more are playing
    if (active >= 2) {
      voicing(k.chord, 50, 4).forEach((m, i) => ens.sampler('upright').triggerAttackRelease(toNote(m), b * 3, time + 0.02 + i * 0.016, 0.36));
    }
  },

  percussion(k, v, kind, time) {
    const b = k.spb;
    const draw = (vel: number, kd: NoteInfo['kind'], at = time, index = 0) =>
      k.draw(at, { agentId: v.agentId, kind: kd, midis: [60], velocity: vel, duration: 0.2, index });
    switch (kind) {
      case 'file_read':
        k.hit(v, 'kit', HH, time, 0.3, 0.5);
        k.hit(v, 'kit', HH, time + late(b) / 2, 0.2, 0.5);
        draw(0.3, 'file_read');
        return 2;
      case 'tool_start':
        // a soft ghost-note figure on the cross-stick
        [0, b / 4, late(b)].forEach((at, i) => {
          k.hit(v, 'kit', STICK, time + at, 0.22 + i * 0.06, 0.3);
          draw(0.3, 'tool_start', time + at, i);
        });
        return 4;
      case 'file_write':
        k.hit(v, 'kit', KICK_F, time, 0.55, 1);
        k.hit(v, 'kit', SNARE, time + b, 0.45, 0.6);
        draw(0.5, 'file_write');
        return 4;
      case 'bash': {
        const pat: Array<[string, number, number]> = [
          [KICK, 0, 0.5],
          [HH, late(b), 0.25],
          [SNARE, b, 0.4],
          [HH, b + late(b), 0.22],
        ];
        pat.forEach(([n, at, vel], i) => {
          k.hit(v, 'kit', n, time + at, vel, 0.4);
          draw(vel, 'bash', time + at, i);
        });
        return 4;
      }
      case 'thinking':
        k.hit(v, 'kit', HH_PEDAL, time, 0.16, 0.5);
        draw(0.1, 'tuning');
        return 4;
      default:
        return 1;
    }
  },

  percussionRun(k, v, time, step) {
    k.hit(v, 'kit', step % 4 === 0 ? SNARE : HH, time, step % 4 === 0 ? 0.36 : 0.22, 0.3);
    k.draw(time, { agentId: v.agentId, kind: 'run', midis: [60], velocity: 0.3, duration: 0.1, index: step });
  },

  error(k, v, time) {
    const ens = k.ensemble;
    const spec = v.instrument === 'percussion' ? null : lofi.specs[v.instrument];
    const base = spec ? Math.round((spec.range[0] + spec.range[1]) / 2) : 62;
    const cluster = [base, base + 1, base + 6];
    if (!spec) {
      k.hit(v, 'kit', RIM, time, 0.6, 0.5);
      k.hit(v, 'kit', KICK_F, time, 0.55, 1);
    } else {
      v.sampler(spec.chord).triggerAttackRelease(cluster.slice(0, Math.max(2, spec.chordSize)).map(toNote), 1.2, time, 0.6);
    }
    // a sour low cluster on the upright
    ens.sampler('upright').triggerAttackRelease([40, 41, 47, 51, 52].map(toNote), 1.6, time, 0.5);
    k.draw(time, { agentId: v.agentId, kind: 'test_fail', midis: cluster, velocity: 0.8, duration: 1.4, index: 0 });
  },

  cadence(k, v, time) {
    // G7 → Cmaj9, with a soft fill and the vibes on top
    const ens = k.ensemble;
    const b = k.spb;
    [0, b / 2, b * 0.75].forEach((at, i) => k.hit(v, 'kit', SNARE, time + at, 0.3 + i * 0.08, 0.4));
    k.hit(v, 'kit', KICK_F, time + b, 0.55, 1);
    ens.sampler('upright').triggerAttackRelease(voicing(C.G7, 50, 4).map(toNote), b, time, 0.5);
    CMAJ9.forEach((m, i) => ens.sampler('upright').triggerAttackRelease(toNote(m), b * 3, time + b + i * 0.018, 0.62));
    ens.sampler('ebass').triggerAttackRelease(toNote(36), 1.6, time + b, 0.8);
    ens.sampler('vibes').triggerAttackRelease(toNote(79), 2.4, time + b, 0.35);
    k.draw(time, { agentId: v.agentId, kind: 'test_pass', midis: [43], velocity: 0.6, duration: b, index: 0 });
    k.draw(time + b, { agentId: v.agentId, kind: 'test_pass', midis: [36, 52, 59, 62], velocity: 0.9, duration: 2, index: 1 });
  },

  finaleTail(k, time) {
    k.ensemble.sampler('vibes').triggerAttackRelease([72, 76, 79, 83, 86].map(toNote), 2.4, time, 0.3);
  },

  join(k, time) {
    // the vibes float up, and the guitar lands on a chord tone
    k.gliss('vibes', time, 64, 88, k.s16(1) / 2, 0.3);
    k.ensemble.sampler('guitar').triggerAttackRelease(toNote(nearestChordTone(k.chord, 59, 52, 64)), 1.6, time + k.s16(4), 0.35);
  },

  leave(k, time) {
    k.gliss('vibes', time, 64, 88, k.s16(1) / 2, 0.24, -1);
  },

  fermataNotes(tension) {
    // G7♭9 from the bottom: G, F, B ... up to the A♭ and B on the vibes
    const notes: HeldNote[] = [
      ['ebass', 31, 0.55],
      ['upright', 41, 0.4],
      ['guitar', 47, 0.4],
    ];
    if (tension > 0.1) notes.push(['guitar', 53, 0.4]);
    if (tension > 0.28) notes.push(['vibes', 59, 0.34], ['upright', 56, 0.34]);
    if (tension > 0.48) notes.push(['vibes', 65, 0.36]);
    if (tension > 0.66) notes.push(['vibes', 68, 0.38], ['guitar', 62, 0.36]);
    if (tension > 0.82) notes.push(['vibes', 71, 0.4], ['upright', 80, 0.28]);
    return notes;
  },

  fermataRoll(k, _sampler, t, bar, tension) {
    if (tension < 0.3) return;
    // the hi-hat ticks faster as the tension rises
    const strokes = 4 + Math.round(tension * 8);
    for (let i = 0; i < strokes; i++) k.hit(k.ensemble, 'kit', HH, t + (bar / strokes) * i, 0.14 + tension * 0.22 * (i / strokes), 0.4);
  },

  heartbeat(k, t, vel) {
    k.hit(k.ensemble, 'kit', KICK, t, vel, 0.8);
  },

  resolve(k, time, approved) {
    const ens = k.ensemble;
    if (approved) {
      CMAJ9.forEach((m, i) => ens.sampler('upright').triggerAttackRelease(toNote(m), 4, time + i * 0.018, 0.66));
      ens.sampler('ebass').triggerAttackRelease(toNote(36), 2, time, 0.85);
      ens.sampler('guitar').triggerAttackRelease([64, 71].map(toNote), 2.4, time, 0.4);
      ens.sampler('vibes').triggerAttackRelease(toNote(76), 2.8, time, 0.4);
      k.hit(ens, 'kit', KICK_F, time, 0.55, 1);
      k.hit(ens, 'kit', HH_OPEN, time + k.s16(2), 0.3, 1.2);
      k.gliss('vibes', time + 0.05, 67, 91, 0.04, 0.32);
    } else {
      AM9.forEach((m, i) => ens.sampler('upright').triggerAttackRelease(toNote(m), 3, time + i * 0.018, 0.45));
      ens.sampler('ebass').triggerAttackRelease(toNote(33), 1.6, time, 0.6);
      k.hit(ens, 'kit', HH_OPEN, time, 0.25, 1);
      k.gliss('vibes', time + 0.05, 64, 86, 0.05, 0.26, -1);
    }
  },
};
