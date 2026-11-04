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
import { bytehovenHome, liveUrl, startLive } from '../server/live/start.ts';
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
    // the live link carries the key: it opens your sessions, so it is shown only here
    const liveAt = liveUrl(port, live.key);
    console.log(`\n  𝄐 Bytehoven is playing at ${url}\n\n  Demo: ${url}\n  Live: ${liveAt}\n\n  Ctrl+C to stop.\n`);
    if (!args.includes('--no-open')) open(liveAt);
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

/**
 * Open the page in the default browser: an argument list, never a shell command line.
 * The link holds the key, and other accounts can see a program's arguments (`ps`), so the
 * browser gets a small file only you can read, which forwards to the link.
 */
function open(url: string) {
  const file = path.join(bytehovenHome(), 'open.html');
  try {
    fs.writeFileSync(file, `<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><script>location.replace(${JSON.stringify(url)})</script>`, { mode: 0o600 });
    fs.chmodSync(file, 0o600);
  } catch {
    return; // the link is printed above
  }
  const [cmd, argv] = process.platform === 'darwin' ? ['open', [file]] : process.platform === 'win32' ? ['explorer.exe', [file]] : ['xdg-open', [file]];
  try {
    spawn(cmd, argv, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  } catch {
    /* no browser to open: the URL is printed above */
  }
}
