# Auto-Reset All Sessions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `/reset-all` slash command and an optional periodic auto-reset timer that clear every active session so all agents pick up fresh global context (CLAUDE.md / AGENTS.md).

**Architecture:** Two additions to `relay.js`: (1) a new `/reset-all` command handler that iterates `state.sessions` and nulls every `threadId`; (2) a `setInterval` timer in `main()` controlled by a new env var `RELAY_AUTO_RESET_INTERVAL_MS` that fires the same reset logic on a schedule and posts a notification to a configurable Discord channel. Both paths reuse the existing reset logic, extracted into a shared `resetAllSessions()` helper.

**Tech Stack:** Node.js, discord.js (already in repo), relay.js (1397 lines), `.codex-discord-relay.env` config.

---

### Task 1: Extract shared reset logic into `resetAllSessions()`

**Files:**
- Modify: `codex-discord-relay/relay.js:1060-1067`

**Step 1: Locate the existing `/reset` handler (line 1060–1067)**

```js
if (command.name === "reset") {
  session.threadId = null;
  session.contextVersion = 0;
  session.updatedAt = new Date().toISOString();
  await queueSaveState();
  await message.reply(`Session reset. Next message starts a new ${AGENT_LABEL} session.`);
  return true;
}
```

**Step 2: Add `resetAllSessions()` helper just above `handleCommand` (find the function that contains the reset block, insert before it)**

Add this function before `handleCommand`:

```js
function resetAllSessions() {
  const now = new Date().toISOString();
  let count = 0;
  for (const key of Object.keys(state.sessions)) {
    const s = state.sessions[key];
    if (s && typeof s === "object") {
      s.threadId = null;
      s.contextVersion = 0;
      s.updatedAt = now;
      count++;
    }
  }
  return count;
}
```

**Step 3: Update `/reset` single-session handler to remain unchanged** (it resets only the current session — keep as-is).

**Step 4: Verify relay still starts without errors**

```bash
cd /root/openclaw-codex-discord-skills-kit/codex-discord-relay
node --check relay.js
```
Expected: no output (syntax OK).

**Step 5: Commit**

```bash
git add codex-discord-relay/relay.js
git commit -m "refactor: extract resetAllSessions() helper in relay"
```

---

### Task 2: Add `/reset-all` slash command

**Files:**
- Modify: `codex-discord-relay/relay.js:703-710` (parseCommand regex)
- Modify: `codex-discord-relay/relay.js:1060-1067` (handleCommand reset block)

**Step 1: Extend `parseCommand` to recognise `reset-all`**

Find line ~704:
```js
const match = prompt.match(/^\/(help|status|reset|workdir|attach|upload)\b(?:\s+([\s\S]+))?$/i);
```
Change to:
```js
const match = prompt.match(/^\/(help|status|reset|reset-all|workdir|attach|upload)\b(?:\s+([\s\S]+))?$/i);
```

**Step 2: Add handler in `handleCommand` right after the existing `/reset` block (after line 1067)**

```js
if (command.name === "reset-all") {
  const count = resetAllSessions();
  await queueSaveState();
  await message.reply(
    `All sessions reset (${count} session${count === 1 ? "" : "s"}). ` +
    `Every next message starts a fresh ${AGENT_LABEL} session with updated global context.`
  );
  return true;
}
```

**Step 3: Add `/reset-all` to the `/help` output**

Find the help command handler (search for `command.name === "help"`) and add a line for `reset-all`:
```
/reset-all — reset ALL active sessions (pick up new global context everywhere)
```

**Step 4: Syntax check**

```bash
node --check relay.js
```
Expected: no output.

**Step 5: Manual smoke test**

Restart relay:
```bash
codex-discord-relay-multictl restart default
```
In Discord, type `/reset-all`. Expected reply: `All sessions reset (N session(s))...`

**Step 6: Commit**

```bash
git add codex-discord-relay/relay.js
git commit -m "feat: add /reset-all command to reset every active session"
```

---

### Task 3: Add periodic auto-reset via `RELAY_AUTO_RESET_INTERVAL_MS`

**Files:**
- Modify: `codex-discord-relay/relay.js:127-189` (CONFIG block)
- Modify: `codex-discord-relay/relay.js:1379-1391` (end of `main()`, before `client.login`)
- Modify: `.codex-discord-relay.env` (add new env var)
- Modify: `codex-discord-relay/README.md` (document the new vars)

**Step 1: Add config keys to CONFIG object (after line 188, inside CONFIG)**

```js
autoResetIntervalMs: intEnv("RELAY_AUTO_RESET_INTERVAL_MS", 0),
autoResetNotifyChannelId: (process.env.RELAY_AUTO_RESET_NOTIFY_CHANNEL_ID || "").trim(),
```

- `0` means disabled (default).
- A value like `86400000` means 24 hours.

**Step 2: Add the timer in `main()`, after shutdown handlers and before `client.login()`** (around line 1390):

```js
if (CONFIG.autoResetIntervalMs > 0) {
  const intervalMs = CONFIG.autoResetIntervalMs;
  logRelayEvent("auto_reset.scheduled", { intervalMs });
  setInterval(async () => {
    const count = resetAllSessions();
    await queueSaveState();
    logRelayEvent("auto_reset.fired", { count });
    if (CONFIG.autoResetNotifyChannelId) {
      try {
        const ch = await client.channels.fetch(CONFIG.autoResetNotifyChannelId);
        if (ch && ch.isTextBased && ch.isTextBased()) {
          await ch.send(
            `[Auto-reset] All ${count} session${count === 1 ? "" : "s"} reset ` +
            `— agents will pick up fresh global context on the next message.`
          );
        }
      } catch (err) {
        logRelayEvent("auto_reset.notify_failed", {
          error: String(err && err.message ? err.message : err).slice(0, 240),
        });
      }
    }
  }, intervalMs);
}
```

**Step 3: Add env vars to `.codex-discord-relay.env`**

Add these lines (disabled by default):
```bash
# Auto-reset: clear all sessions on a schedule so agents reload global context.
# Set to ms interval (e.g. 86400000 = 24h). 0 = disabled.
RELAY_AUTO_RESET_INTERVAL_MS=0
# Optional: Discord channel ID to post a notification when auto-reset fires.
RELAY_AUTO_RESET_NOTIFY_CHANNEL_ID=
```

**Step 4: Syntax check**

```bash
node --check relay.js
```

**Step 5: Test with a short interval**

Temporarily set `RELAY_AUTO_RESET_INTERVAL_MS=10000` (10s) in the env, restart relay, wait 10s, confirm log shows `auto_reset.fired`:
```bash
grep auto_reset /root/.codex-discord-relay/relay.log | tail -5
```
Expected: `{"subsystem":"relay-runtime","event":"auto_reset.fired",...}`

Restore to `0` or `86400000` after verifying.

**Step 6: Commit**

```bash
git add codex-discord-relay/relay.js .codex-discord-relay.env
git commit -m "feat: add periodic auto-reset timer (RELAY_AUTO_RESET_INTERVAL_MS)"
```

---

### Task 4: Document and propagate to skills kit

**Files:**
- Modify: `codex-discord-relay/README.md`
- Modify: `config/setup.env.example`

**Step 1: Add section to `codex-discord-relay/README.md`**

Add under a new `## Session Auto-Reset` heading:

```markdown
## Session Auto-Reset

To force all agents to reload global context (CLAUDE.md / AGENTS.md) periodically:

- **Manual:** `/reset-all` in any Discord channel — clears every active session immediately.
- **Automatic:** Set `RELAY_AUTO_RESET_INTERVAL_MS` in your relay env (e.g. `86400000` for 24h).
  Optionally set `RELAY_AUTO_RESET_NOTIFY_CHANNEL_ID` to a Discord channel ID to receive a notification when the timer fires.

This is useful after updating global context files — without a reset, existing sessions continue with their old context until restarted.
```

**Step 2: Add vars to `config/setup.env.example`**

```bash
# Auto-reset all sessions on a schedule (ms). 0 = disabled. 86400000 = 24h.
RELAY_AUTO_RESET_INTERVAL_MS=0
RELAY_AUTO_RESET_NOTIFY_CHANNEL_ID=
```

**Step 3: Commit and push**

```bash
git add codex-discord-relay/README.md config/setup.env.example
git commit -m "docs: document /reset-all command and RELAY_AUTO_RESET_INTERVAL_MS"
git push
```

---

## Summary of New Env Vars

| Var | Default | Description |
|---|---|---|
| `RELAY_AUTO_RESET_INTERVAL_MS` | `0` (off) | Milliseconds between auto-resets. Set to `86400000` for 24h. |
| `RELAY_AUTO_RESET_NOTIFY_CHANNEL_ID` | `""` (silent) | Discord channel ID to post auto-reset notifications to. |

## Testing Checklist

- [ ] `node --check relay.js` passes after each task
- [ ] `/reset-all` in Discord resets all sessions and replies with count
- [ ] `/help` lists `/reset-all`
- [ ] Log shows `auto_reset.scheduled` on startup when interval > 0
- [ ] Log shows `auto_reset.fired` after the interval elapses
- [ ] Notification appears in configured channel (if set)
- [ ] Setting interval to `0` disables the timer entirely
