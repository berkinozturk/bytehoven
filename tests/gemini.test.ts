import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeminiParser } from '../server/live/gemini.ts';

const J = (o: object) => JSON.stringify(o);
const msg = (id: string, toolCalls: object[], extra: object = {}) => J({ id, timestamp: '2026-11-04T10:00:00Z', type: 'gemini', content: 'SECRET ANSWER', toolCalls, ...extra });
const tc = (id: string, name: string, args: object, status: string, result?: unknown) => ({ id, name, args, status, timestamp: 't', ...(result ? { result } : {}) });

test('reads the session id from the first line', () => {
  const p = new GeminiParser();
  p.feed(J({ sessionId: 's-1', projectHash: 'abc', startTime: 'x', lastUpdated: 'x', kind: 'main' }));
  assert.equal(p.sessionId, 's-1');
});

test('each tool call plays once, when it first shows up', () => {
  const p = new GeminiParser();
  assert.deepEqual(p.feed(msg('m1', [tc('a', 'read_file', { file_path: '/Users/me/shop/SECRET/cart.ts' }, 'executing')])), [{ kind: 'file_read', tool: 'Read', target: 'cart.ts' }]);
  // the same message rewritten with a new status: no second event
  assert.deepEqual(p.feed(msg('m1', [tc('a', 'read_file', { file_path: '/Users/me/shop/SECRET/cart.ts' }, 'success')])), []);
  assert.deepEqual(p.feed(msg('m2', [tc('b', 'replace', { file_path: 'docs/a.md', old_string: 'SECRET', new_string: 'x' }, 'scheduled')])), [{ kind: 'file_write', tool: 'Edit', target: 'a.md' }]);
  assert.deepEqual(p.feed(msg('m3', [tc('c', 'grep_search', { pattern: 'SECRET' }, 'executing'), tc('d', 'google_web_search', { query: 'SECRET' }, 'executing')])), [
    { kind: 'tool_start', tool: 'Grep' },
    { kind: 'tool_start', tool: 'WebSearch' },
  ]);
});

test('shell commands keep their verb; tests pass or fail by status and exit code', () => {
  const p = new GeminiParser();
  assert.deepEqual(p.feed(msg('m1', [tc('t', 'run_shell_command', { command: 'npm test -- SECRET' }, 'executing')])), [{ kind: 'bash', tool: 'Bash', target: 'npm test' }]);
  assert.deepEqual(p.feed(msg('m1', [tc('t', 'run_shell_command', { command: 'npm test -- SECRET' }, 'success', [{ functionResponse: { response: { output: 'Exit Code: 1\nSECRET' } } }])])), [{ kind: 'test_fail', tool: 'Bash', target: 'npm test' }]);
  p.feed(msg('m2', [tc('u', 'run_shell_command', { command: 'pytest' }, 'executing')]));
  assert.deepEqual(p.feed(msg('m2', [tc('u', 'run_shell_command', { command: 'pytest' }, 'success', 'Exit Code: 0')])), [{ kind: 'test_pass', tool: 'Bash', target: 'pytest' }]);
  p.feed(msg('m3', [tc('v', 'write_file', { file_path: 'a.ts', content: 'SECRET' }, 'executing')]));
  assert.deepEqual(p.feed(msg('m3', [tc('v', 'write_file', { file_path: 'a.ts', content: 'SECRET' }, 'error')])), [{ kind: 'error', tool: 'Write', target: 'a.ts' }]);
});

test('thoughts are thinking; text, patches and rewinds are ignored', () => {
  const p = new GeminiParser();
  assert.deepEqual(p.feed(msg('m1', [], { thoughts: [{ subject: 'SECRET', description: 'SECRET', timestamp: 't' }] })), [{ kind: 'thinking' }]);
  assert.deepEqual(p.feed(J({ id: 'u1', timestamp: 't', type: 'user', content: 'SECRET PROMPT' })), []);
  assert.deepEqual(p.feed(J({ $set: { lastUpdated: 'x' } })), []);
  assert.deepEqual(p.feed(J({ $rewindTo: 'm1' })), []);
  assert.deepEqual(p.feed('{broken'), []);
});
