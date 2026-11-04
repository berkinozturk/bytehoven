import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { Conductor, conductArgs, BLOCKED } from '../server/live/conduct.ts';

/** A fake child_process.spawn that records how it was called. */
function fakeSpawn() {
  const calls: Array<{ bin: string; args: string[]; opts: Record<string, unknown>; stdin: string; child: EventEmitter }> = [];
  const spawn = (bin: string, args: string[], opts: Record<string, unknown>) => {
    const stdin = new PassThrough();
    const child = Object.assign(new EventEmitter(), { stdin, kill: () => child.emit('exit', null) });
    const call = { bin, args, opts, stdin: '', child };
    stdin.on('data', (c) => (call.stdin += c));
    calls.push(call);
    return child;
  };
  return { spawn, calls };
}

const TASK = 'Add a line to README; also "; rm -rf ~ #" and $(curl evil)';

test('the task goes to stdin, never into the arguments', async () => {
  const f = fakeSpawn();
  const c = new Conductor({ spawn: f.spawn as never });
  const r = c.start({ cwd: '/work/shop', task: TASK });
  assert.ok('id' in r);
  await new Promise((r) => setImmediate(r));
  const call = f.calls[0];
  assert.equal(call.bin, 'claude');
  assert.equal(call.stdin, TASK);
  assert.ok(!call.args.some((a) => a.includes('README') || a.includes('rm -rf')));
  assert.equal(call.opts.cwd, '/work/shop');
  assert.notEqual(call.opts.shell, true);
});

test('dangerous commands are always blocked and permissions stay narrow', () => {
  const args = conductArgs('11111111-2222-3333-4444-555555555555');
  assert.equal(args[0], '-p');
  assert.deepEqual(args.slice(args.indexOf('--permission-mode'), args.indexOf('--permission-mode') + 2), ['--permission-mode', 'default']);
  for (const b of ['Bash(rm:*)', 'Bash(git push:*)', 'Bash(curl:*)']) assert.ok(BLOCKED.includes(b) && args.includes(b), b);
  const allowed = args.slice(args.indexOf('--allowedTools') + 1, args.indexOf('--disallowedTools'));
  assert.ok(!allowed.some((t) => t.startsWith('Bash')), 'shell commands must wait for your approval');
  assert.ok(args.includes('--session-id'));
});

test('one part at a time', () => {
  const f = fakeSpawn();
  const c = new Conductor({ spawn: f.spawn as never });
  assert.ok('id' in c.start({ cwd: '/a', task: 'one' }));
  assert.deepEqual(c.start({ cwd: '/a', task: 'two' }), { error: 'busy' });
  f.calls[0].child.emit('exit', 0);
  assert.ok('id' in c.start({ cwd: '/a', task: 'three' }));
});

test('empty or oversized tasks are refused', () => {
  const c = new Conductor({ spawn: fakeSpawn().spawn as never });
  assert.deepEqual(c.start({ cwd: '/a', task: '   ' }), { error: 'empty' });
  assert.deepEqual(c.start({ cwd: '/a', task: 'x'.repeat(4001) }), { error: 'too_long' });
});

test('reports when the part ends', () => {
  const f = fakeSpawn();
  const ended: string[] = [];
  const c = new Conductor({ spawn: f.spawn as never, onEnd: (id) => ended.push(id) });
  const r = c.start({ cwd: '/a', task: 'go' }) as { id: string };
  f.calls[0].child.emit('exit', 0);
  assert.deepEqual(ended, [r.id]);
});
