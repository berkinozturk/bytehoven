#!/usr/bin/env node
/**
 * `npx bytehoven`: the whole thing on your machine, with nothing else to install.
 *
 *   npx bytehoven                   start on http://127.0.0.1:5180 and open it in your browser
 *   npx bytehoven --port 5190       another port
 *   npx bytehoven --no-open         don't open the browser
 *   npx bytehoven hooks [--write | --remove]
 *                                   the fermata: let Bytehoven answer Claude Code's permission prompts
 *
 * Built into cli/cli.js (see vite.cli.config.ts); the page itself is dist/.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { hookMode, setupHook } from '../server/hooks.ts';
import { bytehovenHome, startLive } from '../server/live/start.ts';
import { serve } from '../server/serve.ts';

const here = import.meta.dirname;
const args = process.argv.slice(2);

if (args[0] === 'hooks') {
  // copy the hook out of the npx cache, so it keeps working when the cache is cleared
  const script = path.join(bytehovenHome(), 'hook.mjs');
  const mode = hookMode(args);
  if (mode === 'write') {
    fs.mkdirSync(bytehovenHome(), { recursive: true, mode: 0o700 });
    fs.copyFileSync(path.join(here, 'hook.js'), script);
  }
  process.exitCode = setupHook(mode, script, { write: 'npx bytehoven hooks --write', remove: 'npx bytehoven hooks --remove' });
} else if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: bytehoven [--port N] [--no-open]\n       bytehoven hooks [--write | --remove]');
} else {
  const at = args.indexOf('--port');
  const port = at >= 0 ? Number(args[at + 1]) : 5180;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error('--port needs a number between 1 and 65535');
    process.exit(1);
  }
  const url = `http://127.0.0.1:${port}/`;
  const live = startLive(port);
  const server = serve({ root: path.join(here, '..', 'dist'), port, live });
  server.on('listening', () => {
    console.log(`\n  𝄐 Bytehoven is playing at ${url}\n\n  Demo: ${url}\n  Live: ${url}?live\n\n  Ctrl+C to stop.\n`);
    if (!args.includes('--no-open')) open(url);
  });
  server.on('error', (e: NodeJS.ErrnoException) => {
    live.close();
    if (e.code === 'EADDRINUSE') console.error(`Port ${port} is taken. Is Bytehoven already running? Try --port ${port + 10}.`);
    else console.error(e.message);
    process.exit(1);
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

/** Open the page in the default browser: an argument list, never a shell command line. */
function open(url: string) {
  const [cmd, argv] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['explorer.exe', [url]] : ['xdg-open', [url]];
  try {
    spawn(cmd, argv, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  } catch {
    /* no browser to open: the URL is printed above */
  }
}
