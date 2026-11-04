import type { AgentEventKind, Role } from './events';
import type { ChairId } from './route';

/**
 * The mixer: who plays which kind of work, and which events make a sound.
 * Saved in the browser (localStorage), nothing else. Pure, so the tests run it directly.
 */

export const ROLES: Role[] = ['code', 'research', 'docs', 'test', 'refactor'];
export const CHAIRS: ChairId[] = ['clara', 'ines', 'mira', 'otto', 'bruno'];

/** The usual cast: Clara codes, Ines researches, Mira writes docs, Otto tests, Bruno runs commands. */
export const DEFAULT_CAST: Readonly<Record<Role, ChairId>> = Object.freeze({ code: 'clara', research: 'ines', docs: 'mira', test: 'otto', refactor: 'bruno' });

/** Events that can be silenced. The fermata can't: it's how Bytehoven asks you something. */
export const MIXABLE: AgentEventKind[] = ['file_read', 'file_write', 'tool_start', 'bash', 'thinking', 'test_pass', 'test_fail', 'error', 'subagent_join', 'subagent_leave', 'task_done'];

export interface Mix {
  cast: Record<Role, ChairId>;
  silent: AgentEventKind[];
}

/** A saved mix, checked: anything broken falls back to the default for that part. */
export function parseMix(raw: string | null): Mix {
  let v: { cast?: unknown; silent?: unknown } = {};
  try {
    v = raw ? JSON.parse(raw) : {};
  } catch {
    /* not JSON */
  }
  const cast = v.cast as Record<string, unknown> | undefined;
  const valid = !!cast && ROLES.every((r) => CHAIRS.includes(cast[r] as ChairId)) && new Set(ROLES.map((r) => cast[r])).size === ROLES.length;
  const silent = Array.isArray(v.silent) ? MIXABLE.filter((k) => (v.silent as unknown[]).includes(k)) : [];
  return { cast: valid ? (Object.fromEntries(ROLES.map((r) => [r, cast[r]])) as Mix['cast']) : { ...DEFAULT_CAST }, silent };
}

/** Give `role` to `chair`; whoever had it takes `chair`'s old role. */
export function recast(cast: Readonly<Record<Role, ChairId>>, role: Role, chair: ChairId): Record<Role, ChairId> {
  const next = { ...cast };
  const other = roleOf(cast, chair);
  next[other] = cast[role];
  next[role] = chair;
  return next;
}

export function roleOf(cast: Readonly<Record<Role, ChairId>>, chair: ChairId): Role {
  return ROLES.find((r) => cast[r] === chair) ?? 'code';
}
