import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chairFor, chairForTool } from '../src/core/route.ts';

test('each kind of work has its musician', () => {
  const cases: Array<[Parameters<typeof chairFor>[0], string]> = [
    [{ kind: 'file_write', tool: 'Edit', target: 'cart.ts' }, 'clara'],
    [{ kind: 'file_write', tool: 'Write', target: 'README.md' }, 'mira'],
    [{ kind: 'file_write', tool: 'Edit', target: 'guide.mdx' }, 'mira'],
    [{ kind: 'file_read', tool: 'Read', target: 'cart.ts' }, 'ines'],
    [{ kind: 'tool_start', tool: 'Grep' }, 'ines'],
    [{ kind: 'tool_start', tool: 'WebSearch' }, 'ines'],
    [{ kind: 'bash', tool: 'Bash', target: 'npm test' }, 'otto'],
    [{ kind: 'bash', tool: 'Bash', target: 'pytest' }, 'otto'],
    [{ kind: 'test_pass', tool: 'Bash', target: 'npm test' }, 'otto'],
    [{ kind: 'test_fail', tool: 'Bash', target: 'vitest' }, 'otto'],
    [{ kind: 'bash', tool: 'Bash', target: 'git' }, 'bruno'],
    [{ kind: 'bash', tool: 'Bash', target: 'npm' }, 'bruno'],
  ];
  for (const [ev, chair] of cases) assert.equal(chairFor(ev, 'clara'), chair, JSON.stringify(ev));
});

test('work with no clear owner stays with whoever the session played last', () => {
  assert.equal(chairFor({ kind: 'thinking' }, 'otto'), 'otto');
  assert.equal(chairFor({ kind: 'task_done' }, 'mira'), 'mira');
  assert.equal(chairFor({ kind: 'tool_start', tool: 'browser_batch' }, 'bruno'), 'bruno');
});

test('an error lands on the musician of the tool that failed', () => {
  assert.equal(chairFor({ kind: 'error', tool: 'Bash', target: 'git' }, 'clara'), 'bruno');
  assert.equal(chairFor({ kind: 'error', tool: 'Edit', target: 'notes.md' }, 'clara'), 'mira');
  assert.equal(chairFor({ kind: 'error', tool: 'WebFetch' }, 'clara'), 'ines');
});

test('a permission request goes to the musician of the requested tool', () => {
  assert.equal(chairForTool('Write', 'app.ts', 'ines'), 'clara');
  assert.equal(chairForTool('Write', 'CHANGELOG.md', 'ines'), 'mira');
  assert.equal(chairForTool('Bash', 'npm test', 'ines'), 'otto');
  assert.equal(chairForTool('Bash', 'git', 'ines'), 'bruno');
  assert.equal(chairForTool('WebFetch', undefined, 'clara'), 'ines');
  assert.equal(chairForTool('mcp__github__create_issue', undefined, 'clara'), 'clara');
});
