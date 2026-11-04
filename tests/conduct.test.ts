import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { Conductor, conductArgs, BLOCKED, PLAN_ARGS, parsePlan, planPrompt } from '../server/live/conduct.ts';

/** A fake child_process.spawn that records how it was called. */
function fakeSpawn() {
  const calls: Array<{ bin: string; args: string[]; opts: Record<string, unknown>; stdin: string; child: EventEmitter }> = [];
  const spawn = (bin: string, args: string[], opts: Record<string, unknown>) => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const child = Object.assign(new EventEmitter(), { stdin, stdout, kill: () => child.emit('exit', null) });
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

// ---------------------------------------------------------------- planning first

const answer = (structured: unknown) => JSON.stringify({ type: 'result', is_error: false, structured_output: structured });

test('the plan comes from a tool-less run that answers in a fixed shape', () => {
  assert.equal(PLAN_ARGS[0], '-p');
  assert.deepEqual(PLAN_ARGS.slice(PLAN_ARGS.indexOf('--tools'), PLAN_ARGS.indexOf('--tools') + 2), ['--tools', '']);
  assert.ok(PLAN_ARGS.includes('--no-session-persistence'));
  const schema = JSON.parse(PLAN_ARGS[PLAN_ARGS.indexOf('--json-schema') + 1]);
  assert.deepEqual(schema.properties.parts.items.properties.role.enum, ['code', 'research', 'docs', 'test', 'refactor']);
  assert.ok(planPrompt(TASK).includes(TASK));
});

test('a well-formed plan is accepted', () => {
  const parts = [
    { role: 'code', task: 'add the toggle' },
    { role: 'docs', task: 'document it' },
  ];
  assert.deepEqual(parsePlan(answer({ parts })), { parts });
});

test('a malformed plan is refused, so nothing starts', () => {
  const bad = [
    'not json',
    JSON.stringify({ result: 'no structured output' }),
    JSON.stringify({ is_error: true, structured_output: { parts: [{ role: 'code', task: 'x' }] } }),
    answer({ parts: [] }),
    answer({ parts: [{ role: 'boss', task: 'x' }] }),
    answer({ parts: [{ role: 'code', task: '   ' }] }),
    answer({ parts: [{ role: 'code', task: 'x'.repeat(4001) }] }),
    answer({ parts: Array.from({ length: 6 }, () => ({ role: 'code', task: 'x' })) }),
  ];
  for (const b of bad) assert.deepEqual(parsePlan(b), { error: 'malformed' }, b.slice(0, 60));
});

test('planning sends the task on stdin and reads the plan from stdout', async () => {
  const f = fakeSpawn();
  const c = new Conductor({ spawn: f.spawn as never });
  const pending = c.plan({ cwd: '/work/shop', task: TASK });
  await new Promise((r) => setImmediate(r));
  const call = f.calls[0];
  assert.deepEqual(call.args, PLAN_ARGS);
  assert.ok(call.stdin.includes(TASK));
  assert.notEqual(call.opts.shell, true);
  const out = (call.child as unknown as { stdout: PassThrough }).stdout;
  out.end(answer({ parts: [{ role: 'test', task: 'run the tests' }] }));
  call.child.emit('exit', 0);
  assert.deepEqual(await pending, { parts: [{ role: 'test', task: 'run the tests' }] });
});

test('a plan runs its parts one after another', async () => {
  const f = fakeSpawn();
  const started: string[] = [];
  const c = new Conductor({ spawn: f.spawn as never, onStart: (_id, role) => started.push(role ?? '?') });
  const r = c.startPlan({ cwd: '/a', parts: [
    { role: 'code', task: 'first' },
    { role: 'docs', task: 'second' },
  ] });
  assert.deepEqual(r, { ok: true });
  await new Promise((r) => setImmediate(r));
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].stdin, 'first');
  assert.deepEqual(c.startPlan({ cwd: '/a', parts: [{ role: 'code', task: 'x' }] }), { error: 'busy' });
  f.calls[0].child.emit('exit', 0);
  await new Promise((r) => setImmediate(r));
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].stdin, 'second');
  assert.deepEqual(started, ['code', 'docs']);
  assert.deepEqual(c.startPlan({ cwd: '/a', parts: [{ role: 'boss' as never, task: 'x' }] }), { error: 'busy' });
  f.calls[1].child.emit('exit', 0);
  assert.deepEqual(c.startPlan({ cwd: '/a', parts: [{ role: 'boss' as never, task: 'x' }] }), { error: 'malformed' });
});
