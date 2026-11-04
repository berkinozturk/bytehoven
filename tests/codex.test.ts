import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CodexParser } from '../server/live/codex.ts';

const L = (type: string, payload: object) => JSON.stringify({ timestamp: '2026-11-04T10:00:00.000Z', type, payload });
const call = (name: string, args: object, id: string) => L('response_item', { type: 'function_call', name, arguments: JSON.stringify(args), call_id: id });
const out = (id: string, output: string) => L('response_item', { type: 'function_call_output', call_id: id, output });

test('reads the session id and folder from session_meta', () => {
  const p = new CodexParser();
  p.feed(L('session_meta', { id: 'th-1', session_id: 'root-1', cwd: '/Users/me/code/shop', cli_version: '1.0' }));
  assert.deepEqual(p.meta, { id: 'root-1', cwd: '/Users/me/code/shop' });
});

test('shell commands keep only their verb, in every argument shape Codex has used', () => {
  const p = new CodexParser();
  assert.deepEqual(p.feed(call('exec_command', { cmd: 'git push origin main --force' }, 'a')), [{ kind: 'bash', tool: 'Bash', target: 'git' }]);
  assert.deepEqual(p.feed(call('shell', { command: ['bash', '-lc', 'npm test -- --watch=false'] }, 'b')), [{ kind: 'bash', tool: 'Bash', target: 'npm test' }]);
  assert.deepEqual(p.feed(call('shell_command', { command: 'ls -la /secret' }, 'c')), [{ kind: 'bash', tool: 'Bash', target: 'ls' }]);
  assert.deepEqual(p.feed(L('response_item', { type: 'local_shell_call', call_id: 'd', status: 'completed', action: { type: 'exec', command: ['pytest', '-q'] } })), [{ kind: 'bash', tool: 'Bash', target: 'pytest' }]);
});

test('test results come from the exit code in the output text', () => {
  const p = new CodexParser();
  p.feed(call('exec_command', { cmd: 'npm test' }, 't1'));
  assert.deepEqual(p.feed(out('t1', 'Wall time: 3s\nProcess exited with code 1\nOutput:\nSECRET FAILURE')), [{ kind: 'test_fail', tool: 'Bash', target: 'npm test' }]);
  p.feed(call('shell', { command: ['bash', '-lc', 'pytest'] }, 't2'));
  assert.deepEqual(p.feed(out('t2', JSON.stringify({ output: 'ok', metadata: { exit_code: 0 } }))), [{ kind: 'test_pass', tool: 'Bash', target: 'pytest' }]);
  p.feed(call('exec_command', { cmd: 'git status' }, 't3'));
  assert.deepEqual(p.feed(out('t3', 'Exit code: 128\nfatal')), [{ kind: 'error', tool: 'Bash', target: 'git' }]);
  p.feed(call('exec_command', { cmd: 'git status' }, 't4'));
  assert.deepEqual(p.feed(out('t4', 'Process exited with code 0')), []);
});

test('apply_patch becomes one write per file, with only the base name', () => {
  const p = new CodexParser();
  const patch = '*** Begin Patch\n*** Update File: src/app/cart.ts\n@@\n-SECRET\n+SECRET2\n*** Add File: docs/guide.md\n+hello\n*** End Patch';
  assert.deepEqual(p.feed(L('response_item', { type: 'custom_tool_call', call_id: 'p', name: 'apply_patch', input: patch })), [
    { kind: 'file_write', tool: 'Edit', target: 'cart.ts' },
    { kind: 'file_write', tool: 'Edit', target: 'guide.md' },
  ]);
});

test('thinking, searches and other tools; messages and their text are dropped', () => {
  const p = new CodexParser();
  assert.deepEqual(p.feed(L('response_item', { type: 'reasoning', summary: [{ type: 'summary_text', text: 'SECRET' }], encrypted_content: 'x' })), [{ kind: 'thinking' }]);
  assert.deepEqual(p.feed(L('response_item', { type: 'web_search_call', status: 'completed' })), [{ kind: 'tool_start', tool: 'WebSearch' }]);
  assert.deepEqual(p.feed(call('view_image', { path: '/a/b.png' }, 'v')), [{ kind: 'tool_start', tool: 'view_image' }]);
  assert.deepEqual(p.feed(L('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'SECRET' }] })), []);
  assert.deepEqual(p.feed('not json'), []);
});

test('a finished turn is noticed', () => {
  const p = new CodexParser();
  assert.equal(p.turnDone, false);
  p.feed(L('event_msg', { type: 'task_started', turn_id: 'x' }));
  assert.equal(p.turnDone, false);
  p.feed(L('event_msg', { type: 'task_complete', turn_id: 'x', last_agent_message: 'SECRET' }));
  assert.equal(p.turnDone, true);
});

// Newer Codex versions run tools from a code cell (`exec`) and record each finished
// item as event_msg item_completed, with the command, its exit code and changed files.
const done = (item: object) => L('event_msg', { type: 'item_completed', thread_id: 'th', turn_id: 'tu', item });

test('newer Codex: finished commands, file changes, tools and searches come from item_completed', () => {
  const p = new CodexParser();
  assert.deepEqual(p.feed(done({ type: 'CommandExecution', id: '1', command: ['/bin/zsh', '-lc', 'npm test -- SECRET'], parsed_cmd: [{ type: 'unknown', cmd: 'npm test' }], exit_code: 1, status: 'failed', aggregated_output: 'SECRET' })), [
    { kind: 'bash', tool: 'Bash', target: 'npm test' },
    { kind: 'test_fail', tool: 'Bash', target: 'npm test' },
  ]);
  assert.deepEqual(p.feed(done({ type: 'CommandExecution', id: '2', command: ['/bin/zsh', '-lc', 'git status'], parsed_cmd: [{ type: 'unknown', cmd: 'git status' }], exit_code: 0, status: 'completed' })), [{ kind: 'bash', tool: 'Bash', target: 'git' }]);
  assert.deepEqual(p.feed(done({ type: 'CommandExecution', id: '3', command: ['/bin/zsh', '-lc', 'sed -n 1,9p src/SECRET/cart.ts'], parsed_cmd: [{ type: 'read', cmd: 'sed', name: 'cart.ts', path: 'src/SECRET/cart.ts' }], exit_code: 0, status: 'completed' })), [{ kind: 'file_read', tool: 'Read', target: 'cart.ts' }]);
  assert.deepEqual(p.feed(done({ type: 'CommandExecution', id: '4', command: ['rg', 'SECRET'], parsed_cmd: [{ type: 'search', cmd: 'rg', query: 'SECRET' }], exit_code: 0, status: 'completed' })), [{ kind: 'tool_start', tool: 'Grep' }]);
  assert.deepEqual(p.feed(done({ type: 'FileChange', id: '5', changes: { '/Users/me/shop/src/a.ts': { type: 'update' }, '/Users/me/shop/README.md': { type: 'add' } }, status: 'completed' })), [
    { kind: 'file_write', tool: 'Edit', target: 'a.ts' },
    { kind: 'file_write', tool: 'Edit', target: 'README.md' },
  ]);
  assert.deepEqual(p.feed(done({ type: 'FileChange', id: '6', changes: { '/x/b.ts': {} }, status: 'declined' })), []);
  assert.deepEqual(p.feed(done({ type: 'McpToolCall', id: '7', server: 'node_repl', tool: 'js', arguments: 'SECRET', status: 'failed' })), [
    { kind: 'tool_start', tool: 'js' },
    { kind: 'error', tool: 'js' },
  ]);
  assert.deepEqual(p.feed(done({ type: 'Extension', kind: 'web.search', id: '8', query: 'SECRET' })), [{ kind: 'tool_start', tool: 'WebSearch' }]);
  assert.deepEqual(p.feed(done({ type: 'Reasoning', id: '9', summary_text: ['SECRET'] })), [{ kind: 'thinking' }]);
  assert.deepEqual(p.feed(done({ type: 'AgentMessage', id: '10', content: 'SECRET' })), []);
});

test('once item_completed shows up, the raw response items are not played twice', () => {
  const p = new CodexParser();
  p.feed(done({ type: 'Reasoning', id: '1' }));
  assert.deepEqual(p.feed(L('response_item', { type: 'reasoning', summary: [] })), []);
  assert.deepEqual(p.feed(L('response_item', { type: 'custom_tool_call', call_id: 'x', name: 'exec', input: 'await tools.exec_command({cmd:"SECRET"})' })), []);
});
