import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SECONDS, pickMime, recordingName } from '../src/ui/record-format.ts';

test('picks the best video format the browser can record', () => {
  assert.equal(pickMime(() => true), 'video/webm;codecs=vp9,opus');
  assert.equal(pickMime((m) => m === 'video/webm'), 'video/webm');
  assert.equal(pickMime((m) => m.startsWith('video/mp4')), 'video/mp4;codecs=avc1,mp4a');
  assert.equal(pickMime(() => false), null);
});

test('names the file after the day and time, with the right extension', () => {
  const d = new Date(2026, 10, 4, 9, 5, 7);
  assert.equal(recordingName(d, 'video/webm;codecs=vp9,opus'), 'bytehoven-symphony-2026-11-04-0905.webm');
  assert.equal(recordingName(d, 'video/mp4'), 'bytehoven-symphony-2026-11-04-0905.mp4');
});

test('a recording is capped at one minute', () => {
  assert.equal(MAX_SECONDS, 60);
});
