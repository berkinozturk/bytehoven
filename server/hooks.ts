import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Sets up Bytehoven's PermissionRequest hook: show what would change, add it
 * (after a backup), or take it out. `script` is the hook file the agent runs.
 *
 *   claude  ~/.claude/settings.json ($CLAUDE_CONFIG_DIR)
 *   codex   ~/.codex/hooks.json ($CODEX_HOME). Codex has the same PermissionRequest
 *           hook (openai/codex, codex-rs/hooks); the hook is told `--codex` so it
 *           can name the session the way the Codex reader does.
 */

/** Hook entries we wrote: the repo's script or the copy `npx bytehoven hooks` installs. */
const OURS = /bytehoven-hook\.ts|\.bytehoven[\\/]hook\.mjs/;

type Group = { hooks?: Array<{ command?: string }> };
type Settings = { hooks?: Record<string, Group[]> };

export function setupHook(mode: 'show' | 'write' | 'remove', script: string, how: { write: string; remove: string }, agent: 'claude' | 'codex' = 'claude'): number {
  const entry =
    agent === 'codex'
      ? { hooks: [{ type: 'command', command: `node "${script}" --codex` }] } // no matcher: every tool
      : { matcher: '*', hooks: [{ type: 'command', command: `node "${script}"`, timeout: 60 }] };
  const home = agent === 'codex' ? process.env.CODEX_HOME || path.join(os.homedir(), '.codex') : process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const file = path.join(home, agent === 'codex' ? 'hooks.json' : 'settings.json');
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
  if (agent === 'codex') console.log('New Codex sessions pick it up. Codex asks you to review and trust a new hook once before it runs it.');
  else console.log('New Claude Code sessions pick it up; restart running ones.');
  return 0;
}

export const hookMode = (argv: string[]) => (argv.includes('--write') ? 'write' : argv.includes('--remove') ? 'remove' : 'show');
