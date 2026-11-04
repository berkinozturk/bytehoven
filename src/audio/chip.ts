/**
 * A tiny sound chip, rendered to plain sample arrays: pulse waves with three
 * duty cycles, a 4-bit stepped triangle and a noise channel (a 15-bit LFSR)
 * for the drums. The chiptune theme turns these into buffers once at load and
 * plays them through the same samplers as every other theme.
 *
 * No imports, so the tests run it directly.
 */

const freq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** A short fade at both ends so notes start and stop without clicks. */
function edges(x: Float32Array, rate: number) {
  const fi = Math.round(rate * 0.002),
    fo = Math.round(rate * 0.02);
  for (let i = 0; i < fi && i < x.length; i++) x[i] *= i / fi;
  for (let i = 0; i < fo && i < x.length; i++) x[x.length - 1 - i] *= i / fo;
  return x;
}

/** A pulse wave: high for `duty` of each cycle. Sustains, easing down to 70% over its length. */
export function pulse(midi: number, duty: number, rate: number, sec = 3): Float32Array {
  const x = new Float32Array(Math.round(rate * sec));
  const f = freq(midi) / rate;
  let phase = 0;
  for (let i = 0; i < x.length; i++) {
    x[i] = (phase < duty ? 1 : -1) * 0.3 * (1 - 0.3 * (i / x.length));
    phase = (phase + f) % 1;
  }
  return edges(x, rate);
}

/** The chip triangle: 16 steps up, 16 down, no volume control (so no decay either). */
export function triangle(midi: number, rate: number, sec = 3): Float32Array {
  const x = new Float32Array(Math.round(rate * sec));
  const f = freq(midi) / rate;
  let phase = 0;
  for (let i = 0; i < x.length; i++) {
    const step = Math.floor(phase * 32);
    const level = step < 16 ? step : 31 - step;
    x[i] = (level / 7.5 - 1) * 0.45;
    phase = (phase + f) % 1;
  }
  return edges(x, rate);
}

/** The noise channel: a 15-bit shift register, clocked at `hz`; `short` mode is the metallic one. */
function noise(rate: number, sec: number, hz: number, short: boolean, decay: number, seed = 1): Float32Array {
  const x = new Float32Array(Math.round(rate * sec));
  let reg = seed;
  let acc = 0;
  let out = 1;
  for (let i = 0; i < x.length; i++) {
    acc += hz / rate;
    while (acc >= 1) {
      acc -= 1;
      const bit = (reg ^ (reg >> (short ? 6 : 1))) & 1;
      reg = (reg >> 1) | (bit << 14);
      out = reg & 1 ? 1 : -1;
    }
    x[i] = out * 0.35 * Math.exp(-i / (rate * decay));
  }
  return edges(x, rate);
}

/** Drum hits made on the chip: a triangle kick that drops in pitch, noise for the rest. */
export function drums(rate: number): Record<string, Float32Array> {
  const kick = new Float32Array(Math.round(rate * 0.3));
  let phase = 0;
  for (let i = 0; i < kick.length; i++) {
    const t = i / rate;
    const hz = 50 + 130 * Math.exp(-t * 28);
    const step = Math.floor(phase * 32);
    kick[i] = ((step < 16 ? step : 31 - step) / 7.5 - 1) * 0.6 * Math.exp(-t * 9);
    phase = (phase + hz / rate) % 1;
  }
  // the snare: a tone-ish body with a noise tail
  const snare = noise(rate, 0.28, 9000, false, 0.07, 3);
  const body = pulse(50, 0.5, rate, 0.28);
  for (let i = 0; i < snare.length; i++) snare[i] += body[i] * Math.exp(-i / (rate * 0.03));
  return {
    kick: edges(kick, rate),
    snare,
    hat: noise(rate, 0.08, 18000, true, 0.018, 5),
    hat_open: noise(rate, 0.4, 18000, true, 0.12, 7),
    crash: noise(rate, 1.6, 12000, false, 0.45, 11),
  };
}

/** Root notes to render for a pitched channel: every 6 semitones, so no note is repitched far. */
export const ROOTS = Array.from({ length: 13 }, (_, i) => 24 + i * 6);
