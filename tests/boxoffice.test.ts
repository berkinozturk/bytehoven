import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BoxOffice } from '../server/live/boxoffice.ts';

const NOW = new Date(2026, 10, 4, 15, 0, 0);
const TODAY = new Date(2026, 10, 4, 10, 0, 0).toISOString();
const YESTERDAY = new Date(2026, 10, 3, 22, 0, 0).toISOString();

const usage = (input: number, output: number, cacheRead: number, cacheWrite: number) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheWrite,
});
const line = (o: object) => JSON.stringify(o) + '\n';
const assistant = (id: string, ts: string, content: object[], u: object) => line({ type: 'assistant', timestamp: ts, message: { id, usage: u, content } });

function home() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytehoven-box-'));
  fs.mkdirSync(path.join(dir, 'projects', 'p'), { recursive: true });
  return dir;
}

test("counts today's tokens once per message, per musician, with cache reads apart", () => {
  const dir = home();
  const file = path.join(dir, 'projects', 'p', 'sess.jsonl');
  const u1 = usage(10, 200, 5000, 300);
  fs.writeFileSync(
    file,
    // m1 is split over three lines that repeat its usage: count it once, for the reader (its first tool)
    assistant('m1', TODAY, [{ type: 'thinking', thinking: 'SECRET THOUGHT' }], u1) +
      assistant('m1', TODAY, [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a/secret.ts' } }], u1) +
      assistant('m1', TODAY, [{ type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: '/a/b.ts' } }], u1) +
      line({ type: 'user', timestamp: TODAY, message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'SECRET FILE' }] } }) +
      // m2 only talks: it stays with whoever played last (the Edit, so the coder)
      assistant('m2', TODAY, [{ type: 'text', text: 'SECRET ANSWER' }], usage(1, 50, 6000, 0)) +
      // m3 runs the tests
      assistant('m3', TODAY, [{ type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'npm test' } }], usage(2, 30, 7000, 100)) +
      // yesterday doesn't count
      assistant('m0', YESTERDAY, [{ type: 'tool_use', id: 't0', name: 'Edit', input: {} }], usage(999, 999, 999, 999)),
  );
  const box = new BoxOffice(dir, () => NOW);
  const r = box.today();
  assert.equal(r.messages, 3);
  assert.deepEqual(r.chairs.ines, { input: 10, output: 200, cacheRead: 5000, cacheWrite: 300 });
  assert.deepEqual(r.chairs.clara, { input: 1, output: 50, cacheRead: 6000, cacheWrite: 0 });
  assert.deepEqual(r.chairs.otto, { input: 2, output: 30, cacheRead: 7000, cacheWrite: 100 });
  assert.deepEqual(r.total, { input: 13, output: 280, cacheRead: 18000, cacheWrite: 400 });
  assert.ok(!JSON.stringify(r).includes('SECRET'), 'nothing but numbers leaves the parser');
});

test('reads only what was added since last time, and starts over on a new day', () => {
  const dir = home();
  const file = path.join(dir, 'projects', 'p', 'sess.jsonl');
  fs.writeFileSync(file, assistant('m1', TODAY, [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: 'README.md' } }], usage(1, 10, 0, 0)));
  let now = NOW;
  const box = new BoxOffice(dir, () => now);
  assert.equal(box.today().chairs.mira?.output, 10);
  fs.appendFileSync(file, assistant('m2', TODAY, [{ type: 'tool_use', id: 't2', name: 'Write', input: { file_path: 'notes.md' } }], usage(1, 5, 0, 0)));
  assert.equal(box.today().chairs.mira?.output, 15);
  now = new Date(2026, 10, 5, 9, 0, 0);
  assert.equal(box.today().messages, 0);
});
