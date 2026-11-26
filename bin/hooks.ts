/**
 * Sets up Bytehoven's PermissionRequest hook in Claude Code's user settings, from a clone of the repo.
 *
 *   npm run hooks              show what would be added (changes nothing)
 *   npm run hooks -- --write   add it to ~/.claude/settings.json (a backup is saved first)
 *   npm run hooks -- --remove  take it out again
 *   npm run hooks -- --codex --write   the same for OpenAI Codex CLI (~/.codex/hooks.json)
 *
 * With `npx bytehoven`, use `npx bytehoven hooks` instead.
 */
import path from 'node:path';
import { hookMode, setupHook } from '../server/hooks.ts';

const codex = process.argv.includes('--codex');
const flag = codex ? ' --codex' : '';
process.exitCode = setupHook(
  hookMode(process.argv),
  path.join(import.meta.dirname, 'bytehoven-hook.ts'),
  { write: `npm run hooks --${flag} --write`, remove: `npm run hooks --${flag} --remove` },
  codex ? 'codex' : 'claude',
);
