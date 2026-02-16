# Codex Discord Relay

Direct Discord -> Codex CLI relay so you can chat with Codex from Discord (including iPhone) without going through OpenClaw.

## What it does

- Replies in DMs. In guild channels it replies when mentioned; in threads it can auto-respond without mention (see `RELAY_THREAD_AUTO_RESPOND`).
- Persists a Codex `thread_id` per Discord conversation.
- Queues messages per conversation to avoid overlap.
- Supports quick commands:
  - `/status`
  - `/reset`
  - `/workdir /absolute/path`
  - `/attach <thread_id>`
  - `/upload <path>`
  - `/help`

## Setup

1. Install dependencies:

```bash
cd /root/codex-discord-relay
npm install
```

2. Create runtime env:

```bash
cp /root/codex-discord-relay/.env.example /root/.codex-discord-relay.env
chmod 600 /root/.codex-discord-relay.env
```

3. Start/recover service:

```bash
/usr/local/bin/codex-discord-relay-ensure.sh

# If multi-instance wrappers are installed on this machine:
/usr/local/bin/codex-discord-relay-ensure-multi.sh
```

4. Check logs:

```bash
tail -f /root/.codex-discord-relay/relay.log
```

## Operate

Single-instance commands:

```bash
codex-discord-relayctl status
codex-discord-relayctl restart
codex-discord-relayctl logs
```

Multi-instance commands (if installed):

```bash
codex-discord-relay-multictl list
codex-discord-relay-multictl status all
codex-discord-relay-multictl restart default
codex-discord-relay-multictl logs default
```

## Instance Layout (multi-instance mode)

- Default env: `/root/.codex-discord-relay.env`
- Extra env files: `/root/.codex-discord-relay/instances.d/<name>.env`
- Default state: `/root/.codex-discord-relay`
- Extra state: `/root/.codex-discord-relay/instances/<name>/`

## Notes

- Default `CODEX_APPROVAL=never` prevents approval prompts from blocking mobile usage.
- Keep `CODEX_SANDBOX=workspace-write` unless you intentionally need broader access.
- `/workdir` is restricted by `CODEX_ALLOWED_WORKDIR_ROOTS`.
- The relay edits the initial `Running Codex...` message with human-readable intermediate progress (see `RELAY_PROGRESS*` env vars).
- `DISCORD_ALLOWED_CHANNELS` is matched against the thread parent channel as well, so threads created under an allowed channel work without adding each thread id.
- Image uploads: Codex can ask the relay to upload a local image by including `[[upload:some.png]]` in its response (or you can use `/upload some.png`). Files are resolved relative to the per-conversation `upload_dir` shown by `/status`.
- If Discord is blocked on your network, the relay supports proxies via `DISCORD_GATEWAY_PROXY` / `HTTPS_PROXY` / `HTTP_PROXY`.
  It will also automatically source `/root/.openclaw/proxy.env` when starting (same proxy config used by OpenClaw).
- `/attach` is **DM-only by default**. Set `RELAY_ATTACH_ALLOW_GUILDS=true` if you intentionally want to allow attaching sessions in guild channels.

## Progress Message Tuning

These `.env` variables control intermediate status edits in Discord:

- `RELAY_PROGRESS=true|false`
- `RELAY_PROGRESS_MIN_EDIT_MS` (default `5000`)
- `RELAY_PROGRESS_HEARTBEAT_MS` (default `20000`)
- `RELAY_PROGRESS_MAX_LINES` (default `6`)
- `RELAY_PROGRESS_SHOW_COMMANDS=false` (recommended; avoid leaking sensitive command text)

## Troubleshooting Stalls

```bash
# 1) Is relay alive?
codex-discord-relay-multictl list

# 2) Are Codex child jobs stuck?
pgrep -af "codex .*exec" || true

# 3) Check relay logs
tail -n 200 /root/.codex-discord-relay/relay.log
```

Frequent causes:

- Proxy/network issues: `ETIMEDOUT ...:443` in relay log.
- Old Node runtime: `Cannot find module 'node:fs'` or `node:fs/promises`.
- Hung Codex child run blocks that conversation queue until process exits or relay restarts.
