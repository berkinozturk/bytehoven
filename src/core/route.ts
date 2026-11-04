/**
 * Live mode routes work, not sessions: every musician stands for a kind of work,
 * and any session can make any of them play.
 *
 *   Clara (piano)        writes code
 *   Mira (flute)         writes docs (.md and friends)
 *   Ines (violin)        reads and researches: Read, Grep, Glob, the web
 *   Otto (timpani)       runs tests
 *   Bruno (double bass)  runs other commands and builds
 *
 * Work with no clear owner (thinking, a finished turn, other tools) stays with
 * whoever that session played last. No imports, so the tests run it directly.
 */

export type ChairId = 'clara' | 'ines' | 'otto' | 'mira' | 'bruno';

const DOC = /\.(md|mdx|markdown|rst|adoc|txt)$/i;
const RESEARCH = new Set(['Read', 'NotebookRead', 'Grep', 'Glob', 'LS', 'WebSearch', 'WebFetch', 'ToolSearch']);
const WRITE = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const SHELL = new Set(['Bash', 'PowerShell']);
const RUNNERS = new Set(['vitest', 'jest', 'pytest', 'mocha', 'playwright', 'phpunit', 'rspec']);

/** Same rule as the transcript parser: "npm test", "cargo test", a known runner, `node --test`. */
const isTest = (target?: string) => !!target && (target.endsWith(' test') || target === 'node --test' || RUNNERS.has(target));

/** The musician for a tool call (also used for permission requests and errors). */
export function chairForTool<F>(tool: string, target: string | undefined, fallback: F): ChairId | F {
  if (SHELL.has(tool)) return isTest(target) ? 'otto' : 'bruno';
  if (WRITE.has(tool)) return target && DOC.test(target) ? 'mira' : 'clara';
  if (RESEARCH.has(tool)) return 'ines';
  return fallback;
}

export function chairFor<F>(ev: { kind: string; tool?: string; target?: string }, fallback: F): ChairId | F {
  switch (ev.kind) {
    case 'test_pass':
    case 'test_fail':
      return 'otto';
    case 'file_write':
      return ev.target && DOC.test(ev.target) ? 'mira' : 'clara';
    case 'file_read':
      return 'ines';
    case 'bash':
      return isTest(ev.target) ? 'otto' : 'bruno';
    case 'tool_start':
    case 'error':
      return ev.tool ? chairForTool(ev.tool, ev.target, fallback) : fallback;
    default:
      return fallback;
  }
}
