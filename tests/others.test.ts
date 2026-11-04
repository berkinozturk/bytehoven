import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CodexReader, GeminiReader } from '../server/live/others.ts';
import type { LiveMsg } from '../server/live/reader.ts';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bytehoven-others-'));
const day = (d: Date) => [String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')];
const L = (type: string, payload: object) => JSON.stringify({ timestamp: 't', type, payload }) + '\n';

test('a Codex rollout that is being written becomes a live session, history skipped', () => {
  const home = tmp();
  const dir = path.join(home, 'sessions', ...day(new Date()));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'rollout-2026-11-04T10-00-00-abc.jsonl');
  fs.writeFileSync(file, L('session_meta', { id: 'abc', cwd: '/Users/me/shop' }) + L('response_item', { type: 'reasoning', summary: [] }));
  const msgs: LiveMsg[] = [];
  const r = new CodexReader(home, (m) => msgs.push(m));
  r.poll();
  assert.deepEqual(msgs, [{ type: 'session', session: { id: 'codex:abc', folder: 'shop · codex', status: 'busy' } }]);
  assert.equal(r.cwdOf('codex:abc'), '/Users/me/shop');
  fs.appendFileSync(file, L('response_item', { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: 'npm test' }), call_id: 'c1' }));
  r.poll();
  assert.deepEqual(msgs.at(-1), { type: 'event', session: 'codex:abc', ev: { kind: 'bash', tool: 'Bash', target: 'npm test' } });
  fs.appendFileSync(file, L('event_msg', { type: 'task_complete', turn_id: 'x' }));
  r.poll();
  assert.deepEqual(msgs.at(-1), { type: 'session', session: { id: 'codex:abc', folder: 'shop · codex', status: 'idle' } });
});

test('a Gemini chat that is being written becomes a live session, with its project folder', () => {
  const home = tmp();
  const chats = path.join(home, 'tmp', 'shop', 'chats');
  fs.mkdirSync(chats, { recursive: true });
  fs.writeFileSync(path.join(home, 'projects.json'), JSON.stringify({ projects: { '/Users/me/shop': 'shop' } }));
  const file = path.join(chats, 'session-2026-11-04T10-00-s1.jsonl');
  fs.writeFileSync(file, JSON.stringify({ sessionId: 's1', projectHash: 'h', startTime: 'x', lastUpdated: 'x', kind: 'main' }) + '\n');
  const msgs: LiveMsg[] = [];
  const r = new GeminiReader(home, (m) => msgs.push(m));
  r.poll();
  assert.deepEqual(msgs, [{ type: 'session', session: { id: 'gemini:s1', folder: 'shop · gemini', status: 'busy' } }]);
  assert.equal(r.cwdOf('gemini:s1'), '/Users/me/shop');
  fs.appendFileSync(file, JSON.stringify({ id: 'm1', type: 'gemini', toolCalls: [{ id: 'a', name: 'read_file', args: { file_path: '/x/cart.ts' }, status: 'executing' }] }) + '\n');
  r.poll();
  assert.deepEqual(msgs.at(-1), { type: 'event', session: 'gemini:s1', ev: { kind: 'file_read', tool: 'Read', target: 'cart.ts' } });
});

test('old files are not sessions, and a quiet session ends', () => {
  const home = tmp();
  const dir = path.join(home, 'sessions', ...day(new Date()));
  fs.mkdirSync(dir, { recursive: true });
  const old = path.join(dir, 'rollout-old.jsonl');
  fs.writeFileSync(old, L('session_meta', { id: 'old', cwd: '/a' }));
  const hourAgo = new Date(Date.now() - 3600_000);
  fs.utimesSync(old, hourAgo, hourAgo);
  const fresh = path.join(dir, 'rollout-new.jsonl');
  fs.writeFileSync(fresh, L('session_meta', { id: 'new', cwd: '/b' }));
  let now = Date.now();
  const msgs: LiveMsg[] = [];
  const r = new CodexReader(home, (m) => msgs.push(m), () => now);
  r.poll();
  assert.deepEqual(r.sessions().map((s) => s.id), ['codex:new']);
  now += 11 * 60_000;
  r.poll();
  assert.deepEqual(msgs.at(-1), { type: 'session_end', id: 'codex:new' });
  assert.deepEqual(r.sessions(), []);
});
