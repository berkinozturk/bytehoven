import * as Tone from 'tone';
import type { AgentEventKind } from '../../core/events';
import type { HeldNote, NoteInfo, SoundTheme } from '../sound-theme';
import { CHORDS, D_MAJOR_SCALE, PROGRESSION, bassNote, nearestChordTone, voicing } from '../theory';

/**
 * The Orchestra: D major at 92 BPM, strings, harp and timpani in a concert hall.
 * The fermata holds A7 in tremolo strings and resolves to D in full orchestra.
 */

const BPM = 92;
const toNote = (m: number) => Tone.Frequency(m, 'midi').toNote();

export const orchestra: SoundTheme = {
  bpm: BPM,
  swing: 0,
  groups: [
    'piano', 'harp', 'glock', 'violin', 'violin_spic', 'violin_pizz', 'strings_sus', 'strings_trem', 'cello_trem',
    'bass_pizz', 'bass_sus', 'flute_stac', 'flute_sus', 'timp', 'timp_roll', 'snare', 'bdrum', 'cymbal', 'triangle',
  ],
  progression: PROGRESSION,
  tonic: CHORDS.I,
  dominant: CHORDS.V7,
  deceptive: CHORDS.vi,
  scale: D_MAJOR_SCALE,
  specs: {
    piano: { range: [50, 86], soft: 'piano', motif: 'piano', chord: 'piano', rhythm: 'piano', long: 'piano', chordSize: 3, gainDb: -3, tuningNote: 69 },
    violin: { range: [62, 88], soft: 'violin_pizz', motif: 'violin_spic', chord: 'violin', rhythm: 'violin_spic', long: 'violin', chordSize: 2, gainDb: -4, tuningNote: 69 },
    flute: { range: [69, 93], soft: 'flute_sus', motif: 'flute_stac', chord: 'flute_sus', rhythm: 'flute_stac', long: 'flute_sus', chordSize: 1, gainDb: -6, tuningNote: 81 },
    contrabass: { range: [28, 50], soft: 'bass_pizz', motif: 'bass_pizz', chord: 'bass_sus', rhythm: 'bass_pizz', long: 'bass_sus', chordSize: 1, gainDb: -1, tuningNote: 33 },
  },
  env: {
    strings_sus: { attack: 0.25, release: 1.6 },
    strings_trem: { attack: 0.5, release: 1.4 },
    cello_trem: { attack: 0.5, release: 1.4 },
    bass_sus: { attack: 0.08, release: 0.9 },
    flute_sus: { attack: 0.06, release: 0.6 },
    violin: { attack: 0.05, release: 0.7 },
    timp_roll: { attack: 0.3, release: 1.2 },
  },
  reverb: { decay: 3.4, wet: 0.3, preDelay: 0.025 },

  intro(k, now) {
    const ens = k.ensemble;
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
    for (const n of tuners) {
      ens.sampler(n.group).triggerAttackRelease(toNote(n.midi), n.dur, now + n.at, n.vel);
      k.draw(now + n.at, { agentId: '__intro', kind: 'intro', midis: [n.midi], velocity: n.vel, duration: n.dur, index: 0 });
    }
    // silence... then the conductor taps the stand twice
    const tap1 = now + 4.6;
    const tap2 = tap1 + 0.5;
    k.hit(ens, 'snare', 'snare1_rimshot_f', tap1, 0.12, 0.3);
    k.hit(ens, 'snare', 'snare1_rimshot_f', tap2, 0.12, 0.3);
    k.draw(tap1, { agentId: '__baton', kind: 'intro', midis: [], velocity: 1, duration: 0.2, index: 1 });
    k.draw(tap2, { agentId: '__baton', kind: 'intro', midis: [], velocity: 1, duration: 0.2, index: 2 });
    const downbeat = tap2 + (60 / BPM) * 1.0;
    // the first chord: a soft tutti D major
    ens.sampler('strings_sus').triggerAttackRelease(voicing(CHORDS.I, 62, 4).map(toNote), 4.5, downbeat, 0.7);
    ens.sampler('bass_sus').triggerAttackRelease(toNote(38), 4, downbeat, 0.75);
    ens.sampler('harp').triggerAttackRelease(toNote(50), 3, downbeat, 0.6);
    k.hit(ens, 'cymbal', 'suscymb1_hit_mp_rr1', downbeat, 0.25, 4);
    k.gliss('harp', downbeat + 0.05, 50, 86, 0.024, 0.45);
    k.draw(downbeat, { agentId: '__all', kind: 'resolve', midis: [38, 62, 66, 69], velocity: 0.8, duration: 2, index: 0 });
    return downbeat;
  },

  bed(k, time, bar, active) {
    // a soft string pad that follows how busy the orchestra is
    const vel = Math.min(0.75, 0.3 + active * 0.09);
    const slot = bar % 2;
    k.ensemble.sampler('strings_sus', slot).triggerAttackRelease(voicing(k.chord, 57, 3).map(toNote), k.spb * 4.3, time, vel);
    if (active >= 3) k.ensemble.sampler('cello_trem', slot).triggerAttackRelease(toNote(bassNote(k.chord, 40, 52)), k.spb * 4.2, time, 0.22);
  },

  percussion(k, v, kind: AgentEventKind, time) {
    const draw = (midis: number[], vel: number, kd: NoteInfo['kind'], at = time, index = 0) =>
      k.draw(at, { agentId: v.agentId, kind: kd, midis, velocity: vel, duration: 0.2, index });
    const root = bassNote(k.chord, 33, 44);
    switch (kind) {
      case 'file_read':
        v.sampler('timp').triggerAttackRelease(toNote(root), 1.2, time, 0.22);
        draw([root], 0.25, 'file_read');
        return 2;
      case 'tool_start':
        ['snare1_pp_1', 'snare1_pp_1', 'snare1_mp_1'].forEach((n, i) => {
          k.hit(v, 'snare', n, time + k.s16(i) * 0.5, 0.3 + i * 0.12, 0.4);
          draw([60], 0.3, 'tool_start', time + k.s16(i) * 0.5, i);
        });
        return 3;
      case 'file_write':
        v.sampler('timp').triggerAttackRelease(toNote(root), 1.5, time, 0.5);
        k.hit(v, 'bdrum', 'bdrum_pp_1', time, 0.4, 1);
        draw([root], 0.5, 'file_write');
        return 4;
      case 'bash': {
        const pat: Array<[string, string, number]> = [
          ['bdrum', 'bdrum_mp_1', 0.5],
          ['snare', 'snare1_pp_1', 0.28],
          ['snare', 'snare1_mp_1', 0.42],
          ['snare', 'snare1_pp_1', 0.3],
        ];
        pat.forEach(([g, n, vel], i) => {
          k.hit(v, g, n, time + k.s16(i), vel, 0.5);
          draw([60], vel, 'bash', time + k.s16(i), i);
        });
        return 4;
      }
      case 'thinking':
        k.hit(v, 'triangle', 'triangle3_hit_v1_rr1', time, 0.12, 1.5);
        draw([], 0.1, 'tuning');
        return 4;
      default:
        return 1;
    }
  },

  percussionRun(k, v, time, step) {
    k.hit(v, 'snare', step % 4 === 0 ? 'snare1_mp_1' : 'snare1_pp_1', time, 0.35, 0.3);
    k.draw(time, { agentId: v.agentId, kind: 'run', midis: [60], velocity: 0.35, duration: 0.1, index: step });
  },

  error(k, v, time) {
    const ens = k.ensemble;
    const spec = v.instrument === 'percussion' ? null : orchestra.specs[v.instrument];
    const base = spec ? Math.round((spec.range[0] + spec.range[1]) / 2) : 62;
    // minor second + tritone: unmistakably "something is off", but brief
    const cluster = [base, base + 1, base + 6];
    if (!spec) {
      k.hit(v, 'snare', 'snare1_rimshot_f', time, 0.7, 0.5);
      v.sampler('timp').triggerAttackRelease([toNote(38), toNote(39)], 1.8, time, 0.7);
      k.hit(v, 'cymbal', 'cymbal_crash1_mf_rr1', time, 0.32, 2.5);
    } else {
      v.sampler(spec.chord).triggerAttackRelease(cluster.slice(0, Math.max(2, spec.chordSize)).map(toNote), 1.4, time, 0.7);
    }
    ens.sampler('piano').triggerAttackRelease([toNote(51), toNote(52), toNote(58), toNote(63)], 1.6, time, 0.55);
    ens.sampler('cello_trem').triggerAttackRelease([toNote(45), toNote(46)], 1.6, time, 0.45);
    k.draw(time, { agentId: v.agentId, kind: 'test_fail', midis: cluster, velocity: 0.8, duration: 1.4, index: 0 });
  },

  cadence(k, v, time) {
    // V → I in the timpani, cymbal swell, the strings answer
    const ens = k.ensemble;
    const b = k.spb;
    v.sampler('timp').triggerAttackRelease(toNote(33), 1, time, 0.6);
    v.sampler('timp').triggerAttackRelease(toNote(33), 1, time + b * 0.5, 0.45);
    v.sampler('timp').triggerAttackRelease(toNote(38), 2.5, time + b, 0.85);
    k.hit(v, 'cymbal', 'suscymb1_hit_mp_rr1', time + b, 0.5, 4);
    k.hit(v, 'triangle', 'triangle3_hit_v1_rr2', time + b, 0.3, 2);
    ens.sampler('strings_sus').triggerAttackRelease(voicing(CHORDS.V7, 57, 4).map(toNote), b, time, 0.6);
    ens.sampler('strings_sus').triggerAttackRelease(voicing(CHORDS.I, 62, 4).map(toNote), b * 3, time + b, 0.75);
    ens.sampler('glock').triggerAttackRelease([toNote(86), toNote(90)], 2, time + b, 0.35);
    k.draw(time, { agentId: v.agentId, kind: 'test_pass', midis: [33], velocity: 0.6, duration: b, index: 0 });
    k.draw(time + b, { agentId: v.agentId, kind: 'test_pass', midis: [38, 62, 66, 69], velocity: 0.9, duration: 2, index: 1 });
  },

  finaleTail(k, time, top) {
    k.ensemble.sampler('glock').triggerAttackRelease(toNote(top + 12 > 96 ? top : top + 12), 2, time, 0.3);
    k.ensemble.sampler('harp').triggerAttackRelease(voicing(CHORDS.I, 50, 3).map(toNote), 2, time, 0.5);
  },

  join(k, time) {
    // a new voice enters: rising harp arpeggio + a held note that will become the new layer
    k.gliss('harp', time, 55, 84, k.s16(1) / 2, 0.5);
    k.ensemble.sampler('violin').triggerAttackRelease(toNote(nearestChordTone(k.chord, 74, 69, 81)), 2.2, time + k.s16(4), 0.3);
  },

  leave(k, time) {
    k.gliss('harp', time, 55, 84, k.s16(1) / 2, 0.35, -1);
  },

  fermataNotes(tension) {
    const notes: HeldNote[] = [
      ['cello_trem', 45, 0.5],
      ['cello_trem', 52, 0.42],
    ];
    if (tension > 0.1) notes.push(['strings_trem', 57, 0.45], ['strings_trem', 61, 0.42]);
    if (tension > 0.28) notes.push(['strings_trem', 64, 0.42], ['strings_trem', 67, 0.48]);
    if (tension > 0.48) notes.push(['strings_trem', 73, 0.45]);
    if (tension > 0.66) notes.push(['strings_trem', 74, 0.38], ['strings_trem', 81, 0.4]);
    if (tension > 0.82) notes.push(['strings_trem', 79, 0.42], ['strings_trem', 85, 0.32]);
    return notes;
  },

  fermataRoll(_k, sampler, t, bar, tension) {
    if (tension > 0.4) sampler('timp_roll').triggerAttackRelease(toNote(33), bar * 1.5, t, 0.25 + tension * 0.5);
  },

  heartbeat(k, t, vel) {
    k.hit(k.ensemble, 'bdrum', 'bdrum_pp_1', t, vel, 0.8);
  },

  resolve(k, time, approved) {
    const ens = k.ensemble;
    if (approved) {
      ens.sampler('strings_sus').triggerAttackRelease([62, 66, 69, 74, 78].map(toNote), 5, time, 0.85);
      ens.sampler('cello_trem').triggerAttackRelease([toNote(38), toNote(50)], 3, time, 0.5);
      ens.sampler('bass_sus').triggerAttackRelease(toNote(38), 4.5, time, 0.85);
      ens.sampler('piano').triggerAttackRelease([38, 50, 57, 62, 66].map(toNote), 4, time, 0.6);
      ens.sampler('timp').triggerAttackRelease(toNote(38), 3, time, 0.8);
      k.hit(ens, 'cymbal', 'suscymb1_hit_mp_rr1', time, 0.55, 5);
      k.hit(ens, 'triangle', 'triangle3_hit_v1_rr1', time + 0.02, 0.4, 3);
      ens.sampler('glock').triggerAttackRelease([toNote(86), toNote(93)], 2.5, time + k.s16(2), 0.4);
      k.gliss('harp', time + 0.03, 50, 90, 0.028, 0.55);
    } else {
      ens.sampler('strings_sus').triggerAttackRelease([59, 62, 66, 71].map(toNote), 4, time, 0.6);
      ens.sampler('bass_sus').triggerAttackRelease(toNote(35), 4, time, 0.6);
      ens.sampler('piano').triggerAttackRelease([47, 59, 62, 66].map(toNote), 3, time, 0.4);
      k.gliss('harp', time + 0.03, 59, 86, 0.04, 0.35, -1);
    }
  },
};
