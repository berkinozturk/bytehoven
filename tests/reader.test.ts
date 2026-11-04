import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionReader, type LiveMsg } from '../server/live/reader.ts';

const line = (o: object) => JSON.stringify(o) + '\n';
const toolUse = (id: string, name: string, input: object) => line({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bytehoven-'));
  const sid = 'aaaa-1111';
  fs.mkdirSync(path.join(home, 'sessions'), { recursive: true });
  const proj = path.join(home, 'projects', '-Users-me-shop');
  fs.mkdirSync(proj, { recursive: true });
  const transcript = path.join(proj, `${sid}.jsonl`);
  fs.writeFileSync(transcript, toolUse('old', 'Read', { file_path: '/x/old-history.ts' }));
  const sessionFile = path.join(home, 'sessions', '4242.json');
  const writeSession = (status: string) =>
    fs.writeFileSync(sessionFile, JSON.stringify({ pid: 4242, sessionId: sid, cwd: '/Users/me/shop', status, kind: 'interactive', entrypoint: 'cli', name: 'my secret title' }));
  writeSession('busy');
  const msgs: LiveMsg[] = [];
  const reader = new SessionReader(home, (m) => msgs.push(m));
  return { home, sid, proj, transcript, sessionFile, writeSession, msgs, reader };
}

test('finds running sessions by their project folder, not their title', () => {
  const f = fixture();
  f.reader.poll();
  assert.deepEqual(f.msgs, [{ type: 'session', session: { id: f.sid, folder: 'shop', status: 'busy' } }]);
});

test('plays only what happens after Bytehoven starts listening', () => {
  const f = fixture();
  f.reader.poll();
  fs.appendFileSync(f.transcript, toolUse('n1', 'Edit', { file_path: '/Users/me/shop/cart.ts' }));
  f.reader.poll();
  const events = f.msgs.filter((m) => m.type === 'event');
  assert.deepEqual(events, [{ type: 'event', session: f.sid, ev: { kind: 'file_write', tool: 'Edit', target: 'cart.ts' } }]);
});

test('a line written in two pieces is read once, whole', () => {
  const f = fixture();
  f.reader.poll();
  const l = toolUse('n2', 'Read', { file_path: '/a/b.ts' });
  fs.appendFileSync(f.transcript, l.slice(0, 20));
  f.reader.poll();
  fs.appendFileSync(f.transcript, l.slice(20));
  f.reader.poll();
  assert.equal(f.msgs.filter((m) => m.type === 'event').length, 1);
});

test('status changes and ended sessions are reported', () => {
  const f = fixture();
  f.reader.poll();
  f.writeSession('idle');
  f.reader.poll();
  fs.rmSync(f.sessionFile);
  f.reader.poll();
  assert.deepEqual(
    f.msgs.map((m) => (m.type === 'session' ? `session:${m.session.status}` : m.type)),
    ['session:busy', 'session:idle', 'session_end'],
  );
});

test('sub-agent transcripts play under the tool call that started them', () => {
  const f = fixture();
  f.reader.poll();
  const sub = path.join(f.proj, f.sid, 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, 'agent-x1.meta.json'), JSON.stringify({ agentType: 'Explore', toolUseId: 'call-9', description: 'secret task' }));
  fs.writeFileSync(path.join(sub, 'agent-x1.jsonl'), toolUse('s1', 'Grep', { pattern: 'secret' }));
  f.reader.poll();
  const events = f.msgs.filter((m) => m.type === 'event');
  assert.deepEqual(events, [{ type: 'event', session: f.sid, agent: 'call-9', ev: { kind: 'tool_start', tool: 'Grep' } }]);
  assert.ok(!JSON.stringify(f.msgs).includes('secret'));
});

test('a broken sessions folder never throws', () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.home, 'sessions', 'junk.json'), '{not json');
  assert.doesNotThrow(() => f.reader.poll());
  const missing = new SessionReader(path.join(f.home, 'nope'), () => {});
  assert.doesNotThrow(() => missing.poll());
});

test('the full project path stays on the server', () => {
  const f = fixture();
  f.reader.poll();
  assert.equal(f.reader.cwdOf(f.sid), '/Users/me/shop');
  assert.ok(!JSON.stringify(f.msgs).includes('/Users/me'), 'pages only ever see the folder name');
  assert.equal(f.reader.cwdOf('unknown'), undefined);
});
