import { test } from 'node:test';
import assert from 'node:assert/strict';
import { permissionBody } from '../server/live/permission.ts';

test('a Claude Code permission request becomes a short, private message', () => {
  const body = permissionBody({ hook_event_name: 'PermissionRequest', session_id: 's1', cwd: '/Users/me/shop', agent_id: 'a1', tool_name: 'Bash', tool_input: { command: 'rm -rf /Users/me/SECRET' } }, false);
  assert.deepEqual(body, { event: 'PermissionRequest', session: 's1', folder: 'shop', agent: 'a1', tool: 'Bash', target: 'rm' });
  assert.deepEqual(permissionBody({ hook_event_name: 'PermissionRequest', session_id: 's1', tool_name: 'Write', tool_input: { file_path: '/a/SECRET/notes.md', content: 'SECRET' } }, false)?.target, 'notes.md');
  assert.equal(permissionBody({ hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Bash' }, false), null);
});

test('a Codex request names the session and folder the way the Codex reader does', () => {
  const body = permissionBody({ hook_event_name: 'PermissionRequest', session_id: 'th-1', cwd: '/Users/me/shop', turn_id: 't', tool_name: 'Bash', tool_input: { command: ['bash', '-lc', 'git push --force SECRET'] } }, true);
  assert.deepEqual(body, { event: 'PermissionRequest', session: 'codex:th-1', folder: 'shop · codex', agent: undefined, tool: 'Bash', target: 'git' });
  assert.equal(permissionBody({ hook_event_name: 'PermissionRequest', session_id: 'th-1', tool_name: 'exec_command', tool_input: { cmd: 'npm test' } }, true)?.target, 'npm test');
  assert.equal(permissionBody({ hook_event_name: 'PermissionRequest', session_id: 'th-1', tool_name: 'exec_command', tool_input: { cmd: 'npm test' } }, true)?.tool, 'Bash');
  assert.equal(permissionBody({ hook_event_name: 'PermissionRequest', session_id: 'th-1', tool_name: 'apply_patch', tool_input: { input: '*** Begin Patch\n*** Update File: src/SECRET/cart.ts\n-x\n*** End Patch' } }, true)?.target, 'cart.ts');
});
