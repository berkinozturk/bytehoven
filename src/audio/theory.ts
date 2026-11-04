/**
 * Harmony for Bytehoven. Everything is in D major. A gentle eight-bar
 * progression loops under the agents; every event picks its notes from the
 * chord that is sounding, so nothing an agent does can ever sound "wrong"
 * — except when it is meant to (errors).
 */

export interface Chord {
  name: string;
  /** Pitch classes, root first. */
  tones: number[];
  /** Bass pitch class. */
  bass: number;
}

const ch = (name: string, tones: number[], bass = tones[0]): Chord => ({ name, tones, bass });

// D=2 E=4 F#=6 G=7 A=9 B=11 C#=1
export const D_MAJOR_SCALE = [2, 4, 6, 7, 9, 11, 1];

export const CHORDS = {
  I: ch('D', [2, 6, 9]),
  V6: ch('A/C#', [9, 1, 4], 1),
  vi: ch('Bm', [11, 2, 6]),
  iii64: ch('F#m/A', [6, 9, 1], 9),
  IV: ch('G', [7, 11, 2]),
  I6: ch('D/F#', [2, 6, 9], 6),
  ii7: ch('Em7', [4, 7, 11, 2]),
  V7: ch('A7', [9, 1, 4, 7]),
  V7sus: ch('A7sus4', [9, 2, 4, 7]),
};

export const PROGRESSION: Chord[] = [
  CHORDS.I,
  CHORDS.V6,
  CHORDS.vi,
  CHORDS.iii64,
  CHORDS.IV,
  CHORDS.I6,
  CHORDS.ii7,
  CHORDS.V7,
];

export const pc = (midi: number) => ((midi % 12) + 12) % 12;

/** All chord tones of `chord` inside [lo, hi]. */
export function chordTones(chord: Chord, lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) if (chord.tones.includes(pc(m))) out.push(m);
  return out;
}

export function scaleTones(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) if (D_MAJOR_SCALE.includes(pc(m))) out.push(m);
  return out;
}

/** The chord tone nearest to `prev` (smooth voice leading), with a little randomness. */
export function nearestChordTone(chord: Chord, prev: number, lo: number, hi: number): number {
  const tones = chordTones(chord, lo, hi);
  if (!tones.length) return prev;
  tones.sort((a, b) => Math.abs(a - prev) - Math.abs(b - prev));
  const k = Math.random() < 0.65 ? 0 : Math.min(tones.length - 1, 1 + Math.floor(Math.random() * 2));
  return tones[k];
}

/** Next diatonic step from `from` in direction `dir`, bouncing inside the range. */
export function scaleStep(from: number, dir: 1 | -1, lo: number, hi: number): { midi: number; dir: 1 | -1 } {
  const tones = scaleTones(lo, hi);
  let i = tones.findIndex((m) => m >= from);
  if (i < 0) i = tones.length - 1;
  let j = i + dir;
  if (j < 0 || j >= tones.length) {
    dir = (dir * -1) as 1 | -1;
    j = i + dir;
  }
  return { midi: tones[Math.max(0, Math.min(tones.length - 1, j))], dir };
}

/** Lowest bass note of the chord inside [lo, hi]. */
export function bassNote(chord: Chord, lo: number, hi: number): number {
  for (let m = lo; m <= hi; m++) if (pc(m) === chord.bass) return m;
  return lo;
}

/** A close voicing of the chord starting at/above `lo`. */
export function voicing(chord: Chord, lo: number, count = 3): number[] {
  const out: number[] = [];
  let m = lo;
  while (out.length < count && m < lo + 36) {
    if (chord.tones.includes(pc(m))) out.push(m);
    m++;
  }
  return out;
}
