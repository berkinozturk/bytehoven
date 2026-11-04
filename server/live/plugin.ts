import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Plugin } from 'vite';
import { Conductor } from './conduct.ts';
import { BoxOffice } from './boxoffice.ts';
import { LiveHub } from './hub.ts';
import { SessionReader } from './reader.ts';

/** Adds live mode to the dev server: reads Claude Code sessions, serves /__live/*. */
export function live(): Plugin {
  return {
    name: 'bytehoven-live',
    apply: 'serve',
    configureServer(server) {
      // Where the hook finds this server: port + a random token, readable only by you.
      const LIVE_FILE = path.join(server.config.root, '.bytehoven', 'live.json');
      const token = crypto.randomBytes(24).toString('hex');
      const port = server.config.server.port ?? 5180;
      fs.mkdirSync(path.dirname(LIVE_FILE), { recursive: true, mode: 0o700 });
      fs.writeFileSync(LIVE_FILE, JSON.stringify({ port, token }), { mode: 0o600 });

      const hub = new LiveHub({ token });
      hub.port = port;
      const home = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
      const reader = new SessionReader(home, (m) => hub.publish(m));
      hub.sessions = () => reader.sessions();
      const box = new BoxOffice(home);
      hub.takings = () => box.today();
      let planSession = '';
      const conductor = new Conductor({
        onEnd: (child) => hub.send({ type: 'part_end', child }),
        // a plan's parts: tell the page which kind of work each one is
        onStart: (child, role) => role && hub.send({ type: 'part', session: planSession, child, role }),
      });
      hub.onTask = (session, task) => {
        const cwd = reader.cwdOf(session);
        return cwd ? conductor.start({ cwd, task }) : { error: 'unknown' };
      };
      hub.onPlan = async (session, task) => {
        const cwd = reader.cwdOf(session);
        return cwd ? conductor.plan({ cwd, task }) : { error: 'unknown' };
      };
      hub.onPlanRun = (session, parts) => {
        const cwd = reader.cwdOf(session);
        if (!cwd) return { error: 'unknown' };
        planSession = session;
        return conductor.startPlan({ cwd, parts });
      };
      reader.start();
      server.middlewares.use((req, res, next) => hub.handle(req, res, next));
      server.httpServer?.on('close', () => {
        reader.stop();
        hub.close();
        // On a restart the new server has already written its own token: leave that one.
        try {
          if (JSON.parse(fs.readFileSync(LIVE_FILE, 'utf8')).token === token) fs.rmSync(LIVE_FILE);
        } catch {
          /* already gone */
        }
      });
    },
  };
}
