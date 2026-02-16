---
name: codex-discord-relay-stuck-check
description: "Use when Codex via Discord (codex-discord-relay) appears stuck/stalled: check relay health, watchdog restarts, proxy issues (GFW), and hung Codex runs; summarize cause and recovery steps."
---

# Codex Discord Relay Stuck Check

## When To Use
- User reports the Discord Codex bot is "stuck", "stalled", not replying, or progress stopped updating.
- A Discord conversation seems blocked: new messages get no response while an earlier "Running Codex..." message never completes.
- The relay is flapping (restarting frequently) or disconnecting.

## Quick Checks (From Discord UI)
- Try `/help` or `/status` in DM to the bot.
  - If those do not respond, treat it as **relay down**.
- If messaging in a guild channel:
  - Make sure you mentioned the bot (unless you're in a thread with auto-respond enabled).
  - Check allowlists: `DISCORD_ALLOWED_GUILDS` / `DISCORD_ALLOWED_CHANNELS`.

## Server-Side Stuck Check (Preferred)
Run the bundled script and then summarize the results:

```bash
bash /root/.codex/skills/codex-discord-relay-stuck-check/scripts/stuck_check.sh
```

If you cannot run the script, do the manual checks below.

## Manual Checks
Status / processes:

```bash
codex-discord-relay-multictl list
pgrep -af "codex-discord-relay/relay.js" || true
```

Logs:

```bash
tail -n 200 /root/.codex-discord-relay/relay.log
```

Watchdog cron (frequent restarts can look like "stalls"):

```bash
crontab -l | rg -n "codex-discord-relay" || true
```

Potential hung Codex runs (can block the per-conversation queue indefinitely):

```bash
pgrep -af "codex .*exec" || true
```

Proxy/GFW sanity (do NOT print token/proxy values):

```bash
rg -n "^(DISCORD_GATEWAY_PROXY|DISCORD_PROXY_URL|HTTPS_PROXY|HTTP_PROXY|ALL_PROXY|OPENCLAW_PROXY_URL)=" /root/.codex-discord-relay.env /root/.openclaw/proxy.env 2>/dev/null \\
  | sed -E 's/=.*$/=***REDACTED***/'
```

## Common Root Causes (Map Symptom -> Fix)
Relay not responding at all:
- Relay process down or crashing. Check `/root/.codex-discord-relay/relay.log` for the last stack trace.
- Fix: restart from SSH: `codex-discord-relay-multictl restart default`

Relay restarts every minute:
- Watchdog cron is restarting a crashing process; symptoms appear as intermittent stalls.
- Fix: find the crash in the log, address it, then restart.

"Working... elapsed ..." stops updating:
- Discord message edits failing (permissions / missing access / rate limiting / network).
- Fix: check relay log for Discord API errors; consider increasing `RELAY_PROGRESS_MIN_EDIT_MS` and `RELAY_PROGRESS_HEARTBEAT_MS`.

Conversation queue blocked forever:
- A spawned `codex exec` process is hung; relay waits on it indefinitely.
- Fix (immediate): kill the hung `codex exec ...` process and restart the relay.
- Fix (hardening, if requested): add a max-runtime/idle-timeout + a `/cancel` command to the relay.

Proxy/GFW issues:
- Gateway connects intermittently or never connects.
- Fix: ensure `DISCORD_GATEWAY_PROXY`/`HTTPS_PROXY` are set and reachable; confirm `/usr/local/bin/codex-discord-relay-ensure*.sh` is sourcing `/root/.openclaw/proxy.env`.

## Recovery Playbook (Safe Defaults)
- Prefer `codex-discord-relay-multictl restart default` from SSH.
- If you need the existing Codex context, use Discord `/status` to capture `thread_id` before resetting.
- If you must reset a stuck Discord conversation: `/reset` (starts a new Codex thread).

## Safety
- Never paste `DISCORD_BOT_TOKEN` (or any proxy URL that may embed creds) into chat or logs.
- When showing env files, print only key names or redact values.

