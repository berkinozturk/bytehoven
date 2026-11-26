---
description: Open Bytehoven and hear this session (and your others) as an orchestra
allowed-tools: Bash(npx -y bytehoven:*), Bash(curl -s -o /dev/null -w %{http_code} http://127.0.0.1:5180/)
---

Start Bytehoven for the user, so they can see and hear their coding sessions.

1. Check whether it is already running: `curl -s -o /dev/null -w %{http_code} http://127.0.0.1:5180/`.
2. If that prints 200, it is running: tell the user to switch to the Bytehoven tab in their browser, or to open the Live link printed where it was started. Stop here.
3. Otherwise run `npx -y bytehoven` **in the background** (it keeps running; it opens the browser with live mode by itself). Do not wait for it to exit.
4. Tell the user, in one or two sentences: Bytehoven is open in their browser; press "Begin the concert" for sound; while that page is open, Claude Code's permission prompts appear there as a fermata they can answer with Approve / Deny. Stop Bytehoven with Ctrl+C in that process, or by ending the background task.

Never print the Live link or its `k=` key in the chat: it unlocks their sessions, and the browser already has it.
