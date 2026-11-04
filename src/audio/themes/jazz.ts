import * as Tone from 'tone';
import type { Chord } from '../theory';
import { bassNote, chordTones, nearestChordTone, voicing } from '../theory';
import type { HeldNote, NoteInfo, SoundTheme } from '../sound-theme';

/**
 * The Jazz club: F major at a medium swing, piano, walking bass, tenor sax,
 * muted trumpet and a drum kit. While the band is busy, the bass walks, the
 * ride plays "ding, ding-a ding" and the piano comps on the Charleston rhythm.
 * The fermata holds C7♭9 and resolves to Fmaj9.
 */

const BPM = 116;
const toNote = (m: number) => Tone.Frequency(m, 'midi').toNote();
const ch = (name: string, tones: number[], bass = tones[0]): Chord => ({ name, tones, bass });

// F=5 G=7 A=9 B♭=10 C=0 D=2 E=4
const F_MAJOR = [5, 7, 9, 10, 0, 2, 4];
const C = {
  Fmaj7: ch('Fmaj7', [5, 9, 0, 4]),
  D7: ch('D7', [2, 6, 9, 0]),
  Gm7: ch('Gm7', [7, 10, 2, 5]),
  C7: ch('C7', [0, 4, 7, 10]),
  Am7: ch('Am7', [9, 0, 4, 7]),
  C7b9: ch('C7♭9', [0, 4, 7, 10, 1]),
  Dm7: ch('Dm7', [2, 5, 9, 0]),
};

/** Where an eighth note's "and" lands in a swing feel: two thirds into the beat. */
const swung = (b: number) => (b * 2) / 3;

// kit hits (Virtuosity Drums, mid mic)
const RIDE = ['ride_ride_vl1_rr1', 'ride_ride_vl2_rr1', 'ride_ride_vl3_rr1'];
const BELL = 'ride_bell_vl2_rr1';
const HH_PEDAL = 'hh_pedal_vl2_rr1';
const HH = 'hh_closed_vl2_rr1';
const HH_OPEN = 'hh_open_vl2_rr1';
const KICK = 'kick_snoff_vl1_rr1';
const KICK_F = 'kick_snoff_vl2_rr1';
const SNARE = 'snare_center_vl6';
const SNARE_F = 'snare_center_vl14';
const STICK = 'snare_crossstick_vl8';
const RIM = 'snare_rimshot_vl6';
const CRASH = 'crash_crash_vl2_rr1';

/** A bar of walking bass: root, two chord/scale steps, then a half-step into the next root. */
function walk(chord: Chord, next: Chord): number[] {
  const root = bassNote(chord, 31, 42);
  const tones = chordTones(chord, root, root + 12);
  const third = tones[1] ?? root + 4;
  const fifth = tones[2] ?? root + 7;
  const target = bassNote(next, root - 5, root + 7);
  const approach = target + (Math.random() < 0.5 ? -1 : 1);
  return Math.random() < 0.5 ? [root, third, fifth, approach] : [root, fifth, third, approach];
}

export const jazz: SoundTheme = {
  bpm: BPM,
  swing: 0.5,
  groups: ['piano', 'bass_pizz', 'sax_sus', 'sax_stac', 'trumpet_mute', 'kit'],
  progression: [C.Fmaj7, C.D7, C.Gm7, C.C7, C.Am7, C.D7, C.Gm7, C.C7],
  tonic: C.Fmaj7,
  dominant: C.C7b9,
  deceptive: C.Dm7,
  scale: F_MAJOR,
  specs: {
    piano: { range: [48, 84], soft: 'piano', motif: 'piano', chord: 'piano', rhythm: 'piano', long: 'piano', chordSize: 4, gainDb: -3, tuningNote: 69 },
    // the violin chair plays tenor sax
    violin: { range: [46, 75], soft: 'sax_sus', motif: 'sax_stac', chord: 'sax_sus', rhythm: 'sax_stac', long: 'sax_sus', chordSize: 1, gainDb: -5, tuningNote: 58 },
    // the flute chair plays muted trumpet
    flute: { range: [58, 81], soft: 'trumpet_mute', motif: 'trumpet_mute', chord: 'trumpet_mute', rhythm: 'trumpet_mute', long: 'trumpet_mute', chordSize: 1, gainDb: -8, tuningNote: 70 },
    contrabass: { range: [28, 50], soft: 'bass_pizz', motif: 'bass_pizz', chord: 'bass_pizz', rhythm: 'bass_pizz', long: 'bass_pizz', chordSize: 1, gainDb: -1, tuningNote: 29 },
  },
  env: {
    sax_sus: { attack: 0.04, release: 0.5 },
    trumpet_mute: { attack: 0.05, release: 0.4 },
  },
  reverb: { decay: 1.6, wet: 0.2, preDelay: 0.012 },

  intro(k, now) {
    const ens = k.ensemble;
    const b = 60 / BPM;
    // the band warms up: a sax low note, a muted trumpet, the bass, a piano run, the ride
    const warm: Array<[string, number, number, number, number]> = [
      ['sax_sus', 58, 0, 0.4, 2],
      ['trumpet_mute', 70, 0.7, 0.3, 1.6],
      ['bass_pizz', 29, 1.2, 0.5, 1],
      ['bass_pizz', 36, 1.55, 0.45, 1],
      ['piano', 65, 1.9, 0.3, 0.6],
      ['piano', 69, 2.02, 0.3, 0.6],
      ['piano', 72, 2.14, 0.3, 0.6],
      ['piano', 76, 2.26, 0.32, 1.2],
      ['sax_stac', 65, 2.9, 0.35, 0.3],
      ['sax_stac', 67, 3.05, 0.35, 0.3],
      ['sax_sus', 69, 3.2, 0.35, 1],
    ];
    for (const [g, m, at, vel, dur] of warm) {
      ens.sampler(g).triggerAttackRelease(toNote(m), dur, now + at, vel);
      k.draw(now + at, { agentId: '__intro', kind: 'intro', midis: [m], velocity: vel, duration: dur, index: 0 });
    }
    k.hit(ens, 'kit', RIDE[0], now + 2.5, 0.25, 2);
    k.hit(ens, 'kit', HH_PEDAL, now + 2.9, 0.3, 0.3);
    // count-off on the cross-stick: "one ... two ... one two three four"
    const t0 = now + 4.4;
    const clicks = [0, 2, 4, 5, 6, 7];
    clicks.forEach((beat, i) => {
      k.hit(ens, 'kit', STICK, t0 + beat * b, 0.35, 0.3);
      k.draw(t0 + beat * b, { agentId: '__baton', kind: 'intro', midis: [], velocity: 1, duration: 0.2, index: i + 1 });
    });
    const downbeat = t0 + 8 * b;
    // the first chord: Fmaj9 with a crash
    ens.sampler('piano').triggerAttackRelease([41, 53, 57, 60, 64, 67].map(toNote), 3, downbeat, 0.7);
    ens.sampler('bass_pizz').triggerAttackRelease(toNote(41), 1.5, downbeat, 0.8);
    ens.sampler('sax_sus').triggerAttackRelease(toNote(69), 2.4, downbeat, 0.45);
    ens.sampler('trumpet_mute').triggerAttackRelease(toNote(76), 2.2, downbeat, 0.32);
    k.hit(ens, 'kit', CRASH, downbeat, 0.4, 3);
    k.hit(ens, 'kit', KICK_F, downbeat, 0.5, 1);
    k.draw(downbeat, { agentId: '__all', kind: 'resolve', midis: [41, 57, 64, 69], velocity: 0.8, duration: 2, index: 0 });
    return downbeat;
  },

  bed(k, time, _bar, active) {
    const ens = k.ensemble;
    const b = k.spb;
    const lift = Math.min(1, 0.65 + active * 0.08);
    // walking bass, one note per beat, leading into the next chord
    walk(k.chord, k.nextChord).forEach((m, i) => ens.sampler('bass_pizz').triggerAttackRelease(toNote(m), b * 0.95, time + i * b, (i === 0 ? 0.85 : 0.7) * lift));
    // ride: ding, ding-a ding, ding-a
    const ride: Array<[number, number]> = [
      [0, 0.5],
      [b, 0.42],
      [b + swung(b), 0.3],
      [2 * b, 0.5],
      [3 * b, 0.42],
      [3 * b + swung(b), 0.3],
    ];
    ride.forEach(([at, vel], i) => k.hit(ens, 'kit', RIDE[i % 3], time + at, vel * lift, 1.5));
    // hi-hat foot on 2 and 4
    k.hit(ens, 'kit', HH_PEDAL, time + b, 0.45 * lift, 0.4);
    k.hit(ens, 'kit', HH_PEDAL, time + 3 * b, 0.45 * lift, 0.4);
    // piano comping on the Charleston rhythm once two or more are playing
    if (active >= 2) {
      const chord = voicing(k.chord, 52, 4).map(toNote);
      ens.sampler('piano').triggerAttackRelease(chord, b * 0.5, time, 0.42);
      ens.sampler('piano').triggerAttackRelease(chord, b * 0.4, time + b + swung(b), 0.36);
    }
  },

  percussion(k, v, kind, time) {
    const b = k.spb;
    const draw = (vel: number, kd: NoteInfo['kind'], at = time, index = 0) =>
      k.draw(at, { agentId: v.agentId, kind: kd, midis: [60], velocity: vel, duration: 0.2, index });
    switch (kind) {
      case 'file_read':
        k.hit(v, 'kit', RIDE[0], time, 0.35, 1.5);
        draw(0.3, 'file_read');
        return 2;
      case 'tool_start':
        // a soft triplet on the snare
        [0, b / 3, (2 * b) / 3].forEach((at, i) => {
          k.hit(v, 'kit', SNARE, time + at, 0.3 + i * 0.1, 0.4);
          draw(0.3, 'tool_start', time + at, i);
        });
        return 4;
      case 'file_write':
        k.hit(v, 'kit', KICK_F, time, 0.6, 1);
        k.hit(v, 'kit', BELL, time, 0.4, 1.5);
        draw(0.5, 'file_write');
        return 4;
      case 'bash': {
        const pat: Array<[string, number, number]> = [
          [HH, 0, 0.42],
          [STICK, swung(b) / 2, 0.38],
          [HH, swung(b), 0.3],
          [KICK, swung(b), 0.35],
        ];
        pat.forEach(([n, at, vel], i) => {
          k.hit(v, 'kit', n, time + at, vel, 0.4);
          draw(vel, 'bash', time + at, i);
        });
        return 4;
      }
      case 'thinking':
        k.hit(v, 'kit', BELL, time, 0.14, 1.5);
        draw(0.1, 'tuning');
        return 4;
      default:
        return 1;
    }
  },

  percussionRun(k, v, time, step) {
    k.hit(v, 'kit', step % 4 === 0 ? SNARE_F : SNARE, time, step % 4 === 0 ? 0.42 : 0.3, 0.3);
    k.draw(time, { agentId: v.agentId, kind: 'run', midis: [60], velocity: 0.35, duration: 0.1, index: step });
  },

  error(k, v, time) {
    const ens = k.ensemble;
    const spec = v.instrument === 'percussion' ? null : jazz.specs[v.instrument];
    const base = spec ? Math.round((spec.range[0] + spec.range[1]) / 2) : 62;
    const cluster = [base, base + 1, base + 6];
    if (!spec) {
      k.hit(v, 'kit', RIM, time, 0.7, 0.5);
      k.hit(v, 'kit', CRASH, time, 0.35, 2.5);
      k.hit(v, 'kit', KICK_F, time, 0.6, 1);
    } else {
      v.sampler(spec.chord).triggerAttackRelease(cluster.slice(0, Math.max(2, spec.chordSize)).map(toNote), 1.2, time, 0.7);
    }
    // a sour low cluster on the piano
    ens.sampler('piano').triggerAttackRelease([40, 41, 47, 51, 52].map(toNote), 1.6, time, 0.6);
    k.draw(time, { agentId: v.agentId, kind: 'test_fail', midis: cluster, velocity: 0.8, duration: 1.4, index: 0 });
  },

  cadence(k, v, time) {
    // a drum fill into a big Fmaj9: C7 → F
    const ens = k.ensemble;
    const b = k.spb;
    [0, b / 3, (2 * b) / 3].forEach((at, i) => k.hit(v, 'kit', i === 2 ? SNARE_F : SNARE, time + at, 0.4 + i * 0.12, 0.4));
    k.hit(v, 'kit', CRASH, time + b, 0.55, 3);
    k.hit(v, 'kit', KICK_F, time + b, 0.6, 1);
    ens.sampler('piano').triggerAttackRelease(voicing(C.C7, 52, 4).map(toNote), b, time, 0.55);
    ens.sampler('piano').triggerAttackRelease([41, 53, 57, 60, 64, 67].map(toNote), b * 3, time + b, 0.7);
    ens.sampler('bass_pizz').triggerAttackRelease(toNote(41), 1.5, time + b, 0.8);
    k.hit(ens, 'kit', BELL, time + b, 0.35, 2);
    k.draw(time, { agentId: v.agentId, kind: 'test_pass', midis: [36], velocity: 0.6, duration: b, index: 0 });
    k.draw(time + b, { agentId: v.agentId, kind: 'test_pass', midis: [41, 57, 64, 69], velocity: 0.9, duration: 2, index: 1 });
  },

  finaleTail(k, time) {
    k.hit(k.ensemble, 'kit', BELL, time, 0.4, 2);
    k.ensemble.sampler('piano').triggerAttackRelease([77, 81, 84, 88].map(toNote), 2, time, 0.32);
  },

  join(k, time) {
    // a piano sweep up, and the sax lands on a chord tone
    k.gliss('piano', time, 60, 89, k.s16(1) / 2, 0.38);
    k.ensemble.sampler('sax_sus').triggerAttackRelease(toNote(nearestChordTone(k.chord, 65, 60, 70)), 1.8, time + k.s16(4), 0.35);
  },

  leave(k, time) {
    k.gliss('piano', time, 60, 89, k.s16(1) / 2, 0.28, -1);
  },

  fermataNotes(tension) {
    // C7♭9, built from the bottom: C, B♭, E ... up to a screaming D♭ on the trumpet
    const notes: HeldNote[] = [
      ['piano', 36, 0.5],
      ['piano', 46, 0.4],
      ['sax_sus', 52, 0.4],
    ];
    if (tension > 0.1) notes.push(['sax_sus', 58, 0.42]);
    if (tension > 0.28) notes.push(['trumpet_mute', 64, 0.36], ['piano', 61, 0.36]);
    if (tension > 0.48) notes.push(['trumpet_mute', 70, 0.4]);
    if (tension > 0.66) notes.push(['trumpet_mute', 73, 0.42], ['sax_sus', 67, 0.4]);
    if (tension > 0.82) notes.push(['trumpet_mute', 76, 0.45], ['piano', 85, 0.3]);
    return notes;
  },

  fermataRoll(k, _sampler, t, bar, tension) {
    if (tension < 0.3) return;
    // the ride swells: more strokes per bar as the tension rises
    const strokes = 4 + Math.round(tension * 8);
    for (let i = 0; i < strokes; i++) k.hit(k.ensemble, 'kit', RIDE[i % 3], t + (bar / strokes) * i, 0.18 + tension * 0.3 * (i / strokes), 1.2);
  },

  heartbeat(k, t, vel) {
    k.hit(k.ensemble, 'kit', KICK, t, vel, 0.8);
  },

  resolve(k, time, approved) {
    const ens = k.ensemble;
    if (approved) {
      ens.sampler('piano').triggerAttackRelease([41, 53, 57, 60, 64, 67].map(toNote), 4, time, 0.7);
      ens.sampler('bass_pizz').triggerAttackRelease(toNote(41), 2, time, 0.85);
      ens.sampler('sax_sus').triggerAttackRelease(toNote(69), 2.8, time, 0.5);
      ens.sampler('trumpet_mute').triggerAttackRelease(toNote(76), 2.6, time, 0.4);
      k.hit(ens, 'kit', CRASH, time, 0.55, 4);
      k.hit(ens, 'kit', KICK_F, time, 0.6, 1);
      k.hit(ens, 'kit', BELL, time + k.s16(2), 0.4, 2);
      k.gliss('piano', time + 0.03, 65, 96, 0.03, 0.4);
    } else {
      ens.sampler('piano').triggerAttackRelease([38, 50, 53, 57, 60].map(toNote), 3, time, 0.45);
      ens.sampler('bass_pizz').triggerAttackRelease(toNote(38), 1.6, time, 0.6);
      k.hit(ens, 'kit', HH_OPEN, time, 0.3, 1);
      k.gliss('piano', time + 0.03, 62, 86, 0.045, 0.3, -1);
    }
  },
};
