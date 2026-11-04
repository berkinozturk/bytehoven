import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TranscriptParser, commandTarget } from '../server/live/parse.ts';

// Strings that must never leave the parser: prompts, messages, file contents, full commands.
const SECRET = ['TOP-SECRET-PROMPT', 'hunter2-password', 'PRIVATE-FILE-BODY', 'sk-live-123', '/Users/alice/clients/acme'];

const line = (o: object) => JSON.stringify(o);
const assistant = (...content: object[]) => line({ type: 'assistant', message: { role: 'assistant', content } });
const user = (content: unknown, extra: object = {}) => line({ type: 'user', message: { role: 'user', content }, ...extra });

const transcript = [
  user('Please refactor TOP-SECRET-PROMPT now'),
  assistant({ type: 'thinking', thinking: 'thinking about hunter2-password' }),
  assistant({ type: 'text', text: 'Sure, I will touch PRIVATE-FILE-BODY' }),
  assistant({ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/Users/alice/clients/acme/src/app.ts' } }),
  user([{ type: 'tool_result', tool_use_id: 't1', content: 'PRIVATE-FILE-BODY' }]),
  assistant({ type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: '/Users/alice/clients/acme/README.md', old_string: 'PRIVATE-FILE-BODY', new_string: 'x' } }),
  assistant({ type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'API_KEY=sk-live-123 curl https://acme.test --data hunter2-password' } }),
  user([{ type: 'tool_result', tool_use_id: 't3', is_error: true, content: 'boom hunter2-password' }]),
  assistant({ type: 'tool_use', id: 't4', name: 'Bash', input: { command: 'npm test -- --grep TOP-SECRET-PROMPT' } }),
  user([{ type: 'tool_result', tool_use_id: 't4', is_error: false, content: 'ok' }]),
  assistant({ type: 'tool_use', id: 't5', name: 'Grep', input: { pattern: 'hunter2-password', path: '/Users/alice/clients/acme' } }),
  assistant({ type: 'tool_use', id: 't6', name: 'Agent', input: { subagent_type: 'Explore', description: 'TOP-SECRET-PROMPT', prompt: 'TOP-SECRET-PROMPT' } }),
  user([{ type: 'tool_result', tool_use_id: 't6', content: 'done PRIVATE-FILE-BODY' }]),
  assistant({ type: 'tool_use', id: 't7', name: 'mcp__github__create_issue', input: { title: 'TOP-SECRET-PROMPT' } }),
  'this line is not json {',
  line({ type: 'some-future-line-type', payload: 'TOP-SECRET-PROMPT' }),
];

function parseAll() {
  const p = new TranscriptParser();
  return transcript.flatMap((l) => p.feed(l));
}

test('turns tool calls into musical events', () => {
  const kinds = parseAll().map((e) => `${e.kind}:${e.tool ?? ''}:${e.target ?? ''}`);
  assert.deepEqual(kinds, [
    'thinking::',
    'file_read:Read:app.ts',
    'file_write:Edit:README.md',
    'bash:Bash:curl',
    'error:Bash:curl',
    'bash:Bash:npm test',
    'test_pass:Bash:npm test',
    'tool_start:Grep:',
    'subagent_join:Agent:Explore',
    'subagent_leave:Agent:Explore',
    'tool_start:create_issue:',
  ]);
});

test('sub-agents are keyed by the tool call that started them', () => {
  const join = parseAll().find((e) => e.kind === 'subagent_join');
  assert.equal(join?.child, 't6');
});

test('nothing private ever leaves the parser', () => {
  const out = JSON.stringify(parseAll());
  for (const s of SECRET) assert.ok(!out.includes(s), `leaked: ${s}`);
});

test('a failing test command plays as test_fail', () => {
  const p = new TranscriptParser();
  p.feed(assistant({ type: 'tool_use', id: 'a', name: 'Bash', input: { command: 'cd web && pnpm run test' } }));
  const out = p.feed(user([{ type: 'tool_result', tool_use_id: 'a', is_error: true, content: 'x' }]));
  assert.deepEqual(out.map((e) => `${e.kind}:${e.target}`), ['test_fail:pnpm test']);
});

test('command targets keep only the verb', () => {
  assert.equal(commandTarget('git push origin main'), 'git');
  assert.equal(commandTarget('FOO=1 BAR=2 python3 -m pytest -q'), 'pytest');
  assert.equal(commandTarget('cd app && npx vitest run'), 'vitest');
  assert.equal(commandTarget('/usr/local/bin/node script.js'), 'node');
  assert.equal(commandTarget('cargo test --all'), 'cargo test');
  assert.equal(commandTarget(''), undefined);
});
