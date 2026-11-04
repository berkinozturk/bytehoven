import type { Plugin } from 'vite';
import { startLive } from './start.ts';

/** Adds live mode to the dev server: reads the agents' sessions, serves /__live/*. */
export function live(): Plugin {
  return {
    name: 'bytehoven-live',
    apply: 'serve',
    configureServer(server) {
      const l = startLive(server.config.server.port ?? 5180);
      server.middlewares.use((req, res, next) => l.handle(req, res, next));
      server.httpServer?.on('close', () => l.close());
    },
  };
}
