import type { Plugin } from 'vite';
import { liveUrl, startLive } from './start.ts';

/** Adds live mode to the dev server: reads the agents' sessions, serves /__live/*. */
export function live(): Plugin {
  return {
    name: 'bytehoven-live',
    apply: 'serve',
    configureServer(server) {
      const port = server.config.server.port ?? 5180;
      const l = startLive(port);
      server.middlewares.use((req, res, next) => l.handle(req, res, next));
      // live mode needs the key: the link is printed here, where only you see it
      server.httpServer?.once('listening', () => setTimeout(() => server.config.logger.info(`  ➜  Live:    ${liveUrl(port, l.key)}\n`), 50));
      server.httpServer?.on('close', () => l.close());
    },
  };
}
