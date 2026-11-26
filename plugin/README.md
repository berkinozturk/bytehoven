# Bytehoven for Claude Code

The Claude Code plugin of [Bytehoven](https://github.com/berkinozturk/bytehoven).

```text
/plugin marketplace add berkinozturk/bytehoven
/plugin install bytehoven@bytehoven
```

- `/bytehoven:open` starts Bytehoven (`npx bytehoven`) and opens it in your browser.
- While the page is open, permission prompts become a **fermata** there: the hall holds a chord until you press Approve or Deny. With the page closed, Claude Code asks as usual.

`hooks/hook.mjs` is built from `bin/bytehoven-hook.ts` (`npm run build:cli`); don't edit it by hand.
