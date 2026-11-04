/**
 * Sets up Bytehoven's PermissionRequest hook in Claude Code's user settings.
 *
 *   npm run hooks              show what would be added (changes nothing)
 *   npm run hooks -- --write   add it to ~/.claude/settings.json (a backup is saved first)
 *   npm run hooks -- --remove  take it out again
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MARK = 'bytehoven-hook.ts';
const script = path.join(import.meta.dirname, MARK);
const entry = {
  matcher: '*',
  hooks: [{ type: 'command', command: `node "${script}"`, timeout: 60 }],
};
const home = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const file = path.join(home, 'settings.json');
const mode = process.argv.includes('--write') ? 'write' : process.argv.includes('--remove') ? 'remove' : 'show';

type Settings = { hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>> };
let settings: Settings = {};
if (fs.existsSync(file)) {
  try {
    settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    console.error(`${file} is not valid JSON; fix it first, nothing was changed.`);
    process.exit(1);
  }
}
const ours = (g: { hooks?: Array<{ command?: string }> }) => !!g.hooks?.some((h) => h.command?.includes(MARK));
const list = settings.hooks?.PermissionRequest ?? [];
const installed = list.some(ours);

if (mode === 'show') {
  console.log(installed ? `Already installed in ${file}.` : `This would be added to ${file}:\n`);
  if (!installed) console.log(JSON.stringify({ hooks: { PermissionRequest: [entry] } }, null, 2));
  console.log('\nRun `npm run hooks -- --write` to add it, or `npm run hooks -- --remove` to take it out.');
  process.exit(0);
}

const next: Settings = { ...settings, hooks: { ...settings.hooks } };
if (mode === 'write') {
  if (installed) {
    console.log('Already installed, nothing to do.');
    process.exit(0);
  }
  next.hooks!.PermissionRequest = [...list, entry];
} else {
  if (!installed) {
    console.log('Not installed, nothing to do.');
    process.exit(0);
  }
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
