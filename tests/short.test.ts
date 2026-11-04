import { test } from 'node:test';
import assert from 'node:assert/strict';
import { short } from '../src/ui/token-format.ts';

test('token counts read at a glance', () => {
  assert.equal(short(0), '0');
  assert.equal(short(950), '950');
  assert.equal(short(1200), '1.2k');
  assert.equal(short(12_345), '12.3k');
  assert.equal(short(4_560_000), '4.56M');
  assert.equal(short(38_000_000), '38M');
});
