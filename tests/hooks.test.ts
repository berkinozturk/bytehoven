import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setupHook } from '../server/hooks.ts';

const how = { write: 'w', remove: 'r' };

test('installing twice adds the hook once, and removing takes it out, wherever the hook file lives', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytehoven-hooks-'));
  process.env.CLAUDE_CONFIG_DIR = dir;
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ hooks: { PermissionRequest: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'other-tool' }] }] }, theme: 'dark' }));
  const script = path.join(dir, 'somewhere', 'hook.mjs');
  const log = console.log;
  console.log = () => {};
  try {
    setupHook('write', script, how);
    setupHook('write', script, how);
    let s = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(s.hooks.PermissionRequest.length, 2, 'theirs + ours, once');
    assert.equal(s.theme, 'dark');
    setupHook('remove', script, how);
    s = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(s.hooks.PermissionRequest, [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'other-tool' }] }]);
  } finally {
    console.log = log;
    delete process.env.CLAUDE_CONFIG_DIR;
  }
});
