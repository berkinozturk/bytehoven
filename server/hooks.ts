import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Sets up Bytehoven's PermissionRequest hook in Claude Code's user settings
 * (`~/.claude/settings.json`): show what would change, add it (after a
 * backup), or take it out. `script` is the hook file Claude Code will run.
 */

/** Hook entries we wrote: the repo's script or the copy `npx bytehoven hooks` installs. */
const OURS = /bytehoven-hook\.ts|\.bytehoven[\\/]hook\.mjs/;

type Group = { hooks?: Array<{ command?: string }> };
type Settings = { hooks?: Record<string, Group[]> };

export function setupHook(mode: 'show' | 'write' | 'remove', script: string, how: { write: string; remove: string }): number {
  const entry = { matcher: '*', hooks: [{ type: 'command', command: `node "${script}"`, timeout: 60 }] };
  const home = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const file = path.join(home, 'settings.json');
  let settings: Settings = {};
  if (fs.existsSync(file)) {
    try {
      settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      console.error(`${file} is not valid JSON; fix it first, nothing was changed.`);
      return 1;
    }
  }
  const ours = (g: Group) => !!g.hooks?.some((h) => OURS.test(h.command ?? '') || (h.command ?? '').includes(script));
  const list = settings.hooks?.PermissionRequest ?? [];
  const installed = list.some(ours);

  if (mode === 'show') {
    console.log(installed ? `Already installed in ${file}.` : `This would be added to ${file}:\n`);
    if (!installed) console.log(JSON.stringify({ hooks: { PermissionRequest: [entry] } }, null, 2));
    console.log(`\nRun \`${how.write}\` to add it, or \`${how.remove}\` to take it out.`);
    return 0;
  }
  const next: Settings = { ...settings, hooks: { ...settings.hooks } };
  if (mode === 'write') {
    if (installed) return console.log('Already installed, nothing to do.'), 0;
    next.hooks!.PermissionRequest = [...list, entry];
  } else {
    if (!installed) return console.log('Not installed, nothing to do.'), 0;
    const rest = list.filter((g) => !ours(g));
    if (rest.length) next.hooks!.PermissionRequest = rest;
    else delete next.hooks!.PermissionRequest;
  }
  if (fs.existsSync(file)) {
    const backup = `${file}.bytehoven-backup-${Date.now()}`;
    fs.copyFileSync(file, backup);
    console.log(`Backup: ${backup}`);
  }
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  console.log(mode === 'write' ? `Added Bytehoven's permission hook to ${file}.` : `Removed Bytehoven's permission hook from ${file}.`);
  console.log('New Claude Code sessions pick it up; restart running ones.');
  return 0;
}

export const hookMode = (argv: string[]) => (argv.includes('--write') ? 'write' : argv.includes('--remove') ? 'remove' : 'show');
