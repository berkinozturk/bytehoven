import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CAST, MIXABLE, parseMix, recast, roleOf } from '../src/core/mixer.ts';

test('with nothing saved, everyone plays their usual part and every event sounds', () => {
  const m = parseMix(null);
  assert.deepEqual(m.cast, DEFAULT_CAST);
  assert.deepEqual(m.silent, []);
});

test('giving a role to another musician swaps the two, so every role keeps one musician', () => {
  const cast = recast(DEFAULT_CAST, 'code', 'ines');
  assert.equal(cast.code, 'ines');
  assert.equal(cast.research, 'clara');
  assert.equal(new Set(Object.values(cast)).size, 5);
  assert.equal(roleOf(cast, 'ines'), 'code');
  assert.equal(roleOf(cast, 'clara'), 'research');
  assert.deepEqual(DEFAULT_CAST.code, 'clara', 'the default is not changed');
});

test('a saved mix comes back as it was', () => {
  const saved = { cast: recast(DEFAULT_CAST, 'test', 'mira'), silent: ['file_read', 'thinking'] };
  assert.deepEqual(parseMix(JSON.stringify(saved)), saved);
});

test('a broken or tampered mix falls back safely', () => {
  assert.deepEqual(parseMix('not json').cast, DEFAULT_CAST);
  // two roles on one musician is not a valid cast
  assert.deepEqual(parseMix(JSON.stringify({ cast: { ...DEFAULT_CAST, docs: 'clara' } })).cast, DEFAULT_CAST);
  // unknown events and the fermata can't be silenced
  assert.deepEqual(parseMix(JSON.stringify({ silent: ['thinking', 'permission_request', 'nope'] })).silent, ['thinking']);
  assert.ok(!MIXABLE.includes('permission_request' as never));
});
