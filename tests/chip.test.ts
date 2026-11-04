import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drums, pulse, triangle } from '../src/audio/chip.ts';

const RATE = 48000;

/** Rising zero crossings per second ≈ the fundamental. */
function pitchOf(x: Float32Array, rate: number) {
  let n = 0;
  for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) n++;
  return n / (x.length / rate);
}

test('pulse and triangle play the note they are asked for', () => {
  for (const [midi, hz] of [
    [57, 220],
    [69, 440],
    [81, 880],
  ]) {
    assert.ok(Math.abs(pitchOf(pulse(midi, 0.25, RATE, 1), RATE) - hz) < 2, `pulse ${midi}`);
    assert.ok(Math.abs(pitchOf(triangle(midi, RATE, 1), RATE) - hz) < 2, `triangle ${midi}`);
  }
});

test('the duty cycle sets how long the pulse stays high', () => {
  for (const duty of [0.125, 0.25, 0.5]) {
    const x = pulse(60, duty, RATE, 1);
    const high = x.filter((v) => v > 0).length / x.length;
    assert.ok(Math.abs(high - duty) < 0.01, `duty ${duty}: ${high}`);
  }
});

test('notes have the requested length, stay in range and start and end silent', () => {
  const x = pulse(60, 0.5, RATE, 2);
  assert.equal(x.length, 2 * RATE);
  assert.ok(x.every((v) => Math.abs(v) <= 1));
  assert.equal(x[0], 0);
  assert.equal(x[x.length - 1], 0);
});

test('every drum hit sounds and fades out', () => {
  const kit = drums(RATE);
  assert.deepEqual(Object.keys(kit).sort(), ['crash', 'hat', 'hat_open', 'kick', 'snare']);
  for (const [name, x] of Object.entries(kit)) {
    const head = x.subarray(0, x.length >> 3).reduce((a, v) => Math.max(a, Math.abs(v)), 0);
    const tail = x.subarray(x.length - (x.length >> 3)).reduce((a, v) => Math.max(a, Math.abs(v)), 0);
    assert.ok(head > 0.1, `${name} is silent`);
    assert.ok(tail < head / 2, `${name} does not fade`);
  }
});
