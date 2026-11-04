/**
 * Sets up Bytehoven's PermissionRequest hook in Claude Code's user settings, from a clone of the repo.
 *
 *   npm run hooks              show what would be added (changes nothing)
 *   npm run hooks -- --write   add it to ~/.claude/settings.json (a backup is saved first)
 *   npm run hooks -- --remove  take it out again
 *
 * With `npx bytehoven`, use `npx bytehoven hooks` instead.
 */
import path from 'node:path';
import { hookMode, setupHook } from '../server/hooks.ts';

process.exitCode = setupHook(hookMode(process.argv), path.join(import.meta.dirname, 'bytehoven-hook.ts'), {
  write: 'npm run hooks -- --write',
  remove: 'npm run hooks -- --remove',
});
