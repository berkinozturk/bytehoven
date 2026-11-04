#!/usr/bin/env node
/**
 * Bytehoven sample preparation.
 *
 * Takes raw VSCO 2 Community Edition WAV files (CC0) and turns them into
 * small, tightly trimmed mono MP3s plus a manifest the audio engine reads.
 *
 *   node scripts/prepare-samples.mjs <raw-dir> [out-dir=public/samples]
 *
 * <raw-dir> must contain one sub-folder per sample group (piano/, violin/, ...).
 * For each file we:
 *   1. decode PCM WAV (16/24 bit),
 *   2. fold to mono,
 *   3. cut the silence before the attack so every note speaks on the beat,
 *   4. cap the length and add a smooth fade-out,
 *   5. peak-normalise,
 *   6. detect the fundamental and verify / correct the note name,
 *   7. encode a 96 kbps MP3.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Mp3Encoder } from '@breezystack/lamejs';

const [, , rawDir, outDirArg] = process.argv;
if (!rawDir) {
  console.error('usage: prepare-samples.mjs <raw-dir> [out-dir]');
  process.exit(1);
}
const outDir = path.resolve(outDirArg ?? 'public/samples');

/** Per-group processing rules. maxSec = hard cap before fade, pitched = has a note name. */
const GROUPS = {
  piano: { maxSec: 5.0, fade: 1.2, pitched: true, gainDb: 0 },
  harp: { maxSec: 4.0, fade: 1.0, pitched: true, gainDb: 0 },
  glock: { maxSec: 3.0, fade: 1.0, pitched: true, gainDb: -3 },
  violin: { maxSec: 4.0, fade: 0.8, pitched: true, gainDb: 0 },
  violin_spic: { maxSec: 0.9, fade: 0.25, pitched: true, gainDb: 0 },
  violin_pizz: { maxSec: 1.4, fade: 0.4, pitched: true, gainDb: 0 },
  strings_sus: { maxSec: 6.0, fade: 1.5, pitched: true, gainDb: 0 },
  strings_trem: { maxSec: 6.0, fade: 1.2, pitched: true, gainDb: 0 },
  cello_trem: { maxSec: 6.0, fade: 1.2, pitched: true, gainDb: 0 },
  bass_pizz: { maxSec: 2.4, fade: 0.6, pitched: true, gainDb: 0 },
  bass_sus: { maxSec: 4.0, fade: 1.0, pitched: true, gainDb: 0 },
  flute_stac: { maxSec: 1.0, fade: 0.3, pitched: true, gainDb: 0 },
  flute_sus: { maxSec: 4.0, fade: 1.0, pitched: true, gainDb: 0 },
  timp: { maxSec: 3.5, fade: 1.2, pitched: 'detect', gainDb: 0 },
  timp_roll: { maxSec: 7.0, fade: 1.5, pitched: 'detect', gainDb: 0 },
  snare: { maxSec: 1.2, fade: 0.4, pitched: false, gainDb: 0 },
  bdrum: { maxSec: 2.2, fade: 0.8, pitched: false, gainDb: 0 },
  cymbal: { maxSec: 6.0, fade: 1.5, pitched: false, gainDb: -2 },
  triangle: { maxSec: 3.0, fade: 1.0, pitched: false, gainDb: -4 },
  // Jazz club: tenor sax (VCSL), muted trumpet (VSCO 2 CE), drum kit (Virtuosity Drums)
  sax_sus: { maxSec: 3.0, fade: 0.8, pitched: true, gainDb: 0 },
  sax_stac: { maxSec: 0.8, fade: 0.25, pitched: true, gainDb: 0 },
  trumpet_mute: { maxSec: 3.0, fade: 0.8, pitched: true, gainDb: 0 },
  kit: { maxSec: 3.5, fade: 1.0, pitched: false, gainDb: 0 },
};

// ---------------------------------------------------------------- WAV decode
function decodeWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  let off = 12;
  let fmt = null;
  let data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        rate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      data = buf.subarray(body, Math.min(body + size, buf.length));
    }
    off = body + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('missing fmt/data chunk');
  if (fmt.format !== 1 && fmt.format !== 0xfffe) throw new Error('only PCM supported');
  const bps = fmt.bits / 8;
  const frames = Math.floor(data.length / (bps * fmt.channels));
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let acc = 0;
    for (let c = 0; c < fmt.channels; c++) {
      const p = (i * fmt.channels + c) * bps;
      let v;
      if (fmt.bits === 16) v = data.readInt16LE(p) / 32768;
      else if (fmt.bits === 24) v = data.readIntLE(p, 3) / 8388608;
      else if (fmt.bits === 32) v = data.readInt32LE(p) / 2147483648;
      else throw new Error(`unsupported bit depth ${fmt.bits}`);
      acc += v;
    }
    mono[i] = acc / fmt.channels;
  }
  return { rate: fmt.rate, samples: mono };
}

// ---------------------------------------------------------------- helpers
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const midiToName = (m) => NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1);
const nameToMidi = (n) => {
  const m = /^([A-G]#?)(-?\d)$/.exec(n);
  if (!m) return null;
  return NOTE_NAMES.indexOf(m[1]) + (Number(m[2]) + 1) * 12;
};
const freqToMidi = (f) => 69 + 12 * Math.log2(f / 440);

function findOnset(x, rate) {
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  const thr = peak * 0.02; // about -34 dB below the peak
  let i = 0;
  while (i < x.length && Math.abs(x[i]) < thr) i++;
  // keep 4 ms of pre-roll so the transient is never clipped
  return Math.max(0, i - Math.round(rate * 0.004));
}

/** YIN pitch estimate (de Cheveigné & Kawahara 2002) on a steady window. */
function detectPitch(x, rate, fromSec = 0.15, lenSec = 0.3, minHz = 35, maxHz = 2500) {
  const start = Math.min(x.length - 1, Math.round(fromSec * rate));
  const maxLag = Math.floor(rate / minHz);
  const W = Math.round(lenSec * rate);
  if (start + W + maxLag > x.length) return null;
  const minLag = Math.floor(rate / maxHz);
  const d = new Float64Array(maxLag + 1);
  for (let tau = 1; tau <= maxLag; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) {
      const v = x[start + i] - x[start + i + tau];
      s += v * v;
    }
    d[tau] = s;
  }
  // cumulative mean normalised difference
  const c = new Float64Array(maxLag + 1);
  c[0] = 1;
  let run = 0;
  for (let tau = 1; tau <= maxLag; tau++) {
    run += d[tau];
    c[tau] = (d[tau] * tau) / (run || 1);
  }
  let tau = -1;
  for (let t = Math.max(2, minLag); t < maxLag; t++) {
    if (c[t] < 0.15) {
      while (t + 1 < maxLag && c[t + 1] < c[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) {
    let best = Infinity;
    for (let t = Math.max(2, minLag); t < maxLag; t++) if (c[t] < best) { best = c[t]; tau = t; }
    if (best > 0.35) return null;
  }
  // parabolic interpolation
  const a = c[tau - 1], b = c[tau], g = c[tau + 1] ?? b;
  const shift = (a - g) / (2 * (a - 2 * b + g) || 1);
  return { hz: rate / (tau + (Number.isFinite(shift) ? shift : 0)), confidence: 1 - b };
}

function encodeMp3(x, rate, kbps = 96) {
  const enc = new Mp3Encoder(1, rate, kbps);
  const pcm = new Int16Array(x.length);
  for (let i = 0; i < x.length; i++) pcm[i] = Math.max(-1, Math.min(1, x[i])) * 32767;
  const chunks = [];
  const block = 1152;
  for (let i = 0; i < pcm.length; i += block) {
    const b = enc.encodeBuffer(pcm.subarray(i, i + block));
    if (b.length) chunks.push(Buffer.from(b.buffer, b.byteOffset, b.length));
  }
  const end = enc.flush();
  if (end.length) chunks.push(Buffer.from(end.buffer, end.byteOffset, end.length));
  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------- main
// Groups without a raw folder keep their existing entry, so one family can be rebuilt on its own.
const manifestPath = path.join(outDir, 'manifest.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { groups: {} };
manifest.source = 'VSCO 2 CE, VCSL and Virtuosity Drums (all CC0 1.0) — see CREDITS.md';
let totalBytes = 0;
const warnings = [];

for (const [group, rule] of Object.entries(GROUPS)) {
  const dir = path.join(rawDir, group);
  if (!fs.existsSync(dir)) {
    warnings.push(`missing group folder ${group}`);
    continue;
  }
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.wav')).sort();
  const entry = { pitched: Boolean(rule.pitched), samples: {} };
  fs.mkdirSync(path.join(outDir, group), { recursive: true });
  let idx = 0;
  const pending = [];
  for (const file of files) {
    const { rate, samples } = decodeWav(fs.readFileSync(path.join(dir, file)));
    const onset = findOnset(samples, rate);
    const maxLen = Math.round(rule.maxSec * rate);
    let x = samples.slice(onset, onset + maxLen);
    // trim trailing near-silence
    let end = x.length;
    while (end > rate * 0.2 && Math.abs(x[end - 1]) < 1e-4) end--;
    x = x.slice(0, end);
    // fade-in 2 ms, cosine fade-out
    const fi = Math.round(rate * 0.002);
    for (let i = 0; i < fi && i < x.length; i++) x[i] *= i / fi;
    const fo = Math.min(x.length, Math.round(rule.fade * rate));
    for (let i = 0; i < fo; i++) {
      const k = x.length - fo + i;
      x[k] *= 0.5 * (1 + Math.cos((Math.PI * i) / fo));
    }
    // normalise to -1 dBFS (+ group trim)
    let peak = 0;
    for (const v of x) peak = Math.max(peak, Math.abs(v));
    const g = (Math.pow(10, -1 / 20) / (peak || 1)) * Math.pow(10, rule.gainDb / 20);
    for (let i = 0; i < x.length; i++) x[i] *= g;

    let key;
    if (rule.pitched === true) {
      const m = /_([A-G]#?\d)(?:_|\.)/.exec(file);
      if (!m) {
        warnings.push(`${group}/${file}: no note name, skipped`);
        continue;
      }
      let midi = nameToMidi(m[1]);
      const p = detectPitch(x, rate);
      if (p) {
        const diff = freqToMidi(p.hz) - midi;
        const oct = Math.round(diff / 12);
        if (Math.abs(diff - oct * 12) < 0.7) entry._votes = [...(entry._votes ?? []), oct];
      }
      key = midiToName(midi);
    } else if (rule.pitched === 'detect') {
      const p = detectPitch(x, rate, 0.25, 0.5, 40, 400);
      if (!p) {
        warnings.push(`${group}/${file}: pitch not detected, skipped`);
        continue;
      }
      key = midiToName(Math.round(freqToMidi(p.hz)));
      if (pending.some((q) => q.key === key)) continue; // one sample per detected pitch
    } else {
      key = file
        .replace(/\.wav$/i, '')
        .replace(/_Sum$/, '')
        .replace(/[^A-Za-z0-9]+/g, '_')
        .toLowerCase();
    }
    pending.push({ key, x, rate });
    idx++;
  }
  // octave labelling differs between VSCO instruments (C3 vs C4 = middle C):
  // shift the whole group by the majority vote of the pitch detector.
  let shift = 0;
  if (rule.pitched === true && entry._votes?.length) {
    const counts = {};
    for (const v of entry._votes) counts[v] = (counts[v] ?? 0) + 1;
    shift = Number(Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]);
    const agree = counts[shift];
    console.log(`  ${group}: octave shift ${shift} (${agree}/${entry._votes.length} files agree, ${files.length} total)`);
  }
  delete entry._votes;
  for (const { key: k0, x, rate } of pending) {
    const key = rule.pitched === true ? midiToName(nameToMidi(k0) + shift * 12) : k0;
    const outName = `${key.replace('#', 's')}.mp3`;
    const mp3 = encodeMp3(x, rate);
    fs.writeFileSync(path.join(outDir, group, outName), mp3);
    totalBytes += mp3.length;
    entry.samples[key] = `${group}/${outName}`;
  }
  manifest.groups[group] = entry;
  console.log(`${group.padEnd(14)} ${Object.keys(entry.samples).length} samples  [${Object.keys(entry.samples).join(' ')}]`);
}

fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`\nwrote ${(totalBytes / 1e6).toFixed(2)} MB to ${outDir}`);
if (warnings.length) console.log('\nnotes:\n  ' + warnings.join('\n  '));
