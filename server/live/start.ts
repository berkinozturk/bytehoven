import crypto from 'node:crypto';
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { BoxOffice } from './boxoffice.ts';
import { Conductor } from './conduct.ts';
import { LiveHub } from './hub.ts';
import { CodexReader, GeminiReader, codexHome, geminiHome } from './others.ts';
import { SessionReader } from './reader.ts';

/**
 * Live mode, ready to mount on any local HTTP server (the Vite dev server or
 * `npx bytehoven`): reads the agents' sessions and serves /__live/*.
 */

/** Where the hook finds a running Bytehoven: `~/.bytehoven/live.json` (port + a random token, readable only by you). */
export const bytehovenHome = () => process.env.BYTEHOVEN_HOME || path.join(os.homedir(), '.bytehoven');
export const liveFile = () => path.join(bytehovenHome(), 'live.json');

/**
 * The key: a random secret in `~/.bytehoven/key`, readable only by you. It stays
 * the same between runs, so a page you opened once keeps working; delete the
 * file to make a new one.
 */
export function liveKey(): string {
  const file = path.join(bytehovenHome(), 'key');
  try {
    const k = fs.readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{48}$/.test(k)) return k;
  } catch {
    /* not made yet */
  }
  fs.mkdirSync(bytehovenHome(), { recursive: true, mode: 0o700 });
  const k = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(file, k, { mode: 0o600 });
  return k;
}

/** The address that opens live mode with the key (print it only where only you can see it). */
export const liveUrl = (port: number, key: string) => `http://127.0.0.1:${port}/?live&k=${key}`;

export function startLive(port: number): { key: string; handle: (req: IncomingMessage, res: ServerResponse, next: () => void) => void; close: () => void } {
  const token = liveKey();
  const file = liveFile();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify({ port, token }), { mode: 0o600 });

  const hub = new LiveHub({ token });
  hub.port = port;
  const home = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const claude = new SessionReader(home, (m) => hub.publish(m));
  // Codex and Gemini CLI sessions play in the same orchestra
  const readers = [claude, new CodexReader(codexHome(), (m) => hub.publish(m)), new GeminiReader(geminiHome(), (m) => hub.publish(m))];
  const cwdOf = (id: string) => readers.map((r) => r.cwdOf(id)).find(Boolean);
  hub.sessions = () => readers.flatMap((r) => r.sessions());
  const box = new BoxOffice(home);
  hub.takings = () => box.today();
  let planSession = '';
  const conductor = new Conductor({
    onEnd: (child) => hub.send({ type: 'part_end', child }),
    // a plan's parts: tell the page which kind of work each one is
    onStart: (child, role) => role && hub.send({ type: 'part', session: planSession, child, role }),
  });
  hub.onTask = (session, task) => {
    const cwd = cwdOf(session);
    return cwd ? conductor.start({ cwd, task }) : { error: 'unknown' };
  };
  hub.onPlan = async (session, task) => {
    const cwd = cwdOf(session);
    return cwd ? conductor.plan({ cwd, task }) : { error: 'unknown' };
  };
  hub.onPlanRun = (session, parts) => {
    const cwd = cwdOf(session);
    if (!cwd) return { error: 'unknown' };
    planSession = session;
    return conductor.startPlan({ cwd, parts });
  };
  readers.forEach((r) => r.start());

  return {
    key: token,
    handle: (req, res, next) => hub.handle(req, res, next),
    close: () => {
      readers.forEach((r) => r.stop());
      hub.close();
      // a newer Bytehoven may have written its own token since: leave that one
      try {
        if (JSON.parse(fs.readFileSync(file, 'utf8')).token === token) fs.rmSync(file);
      } catch {
        /* already gone */
      }
    },
  };
}
