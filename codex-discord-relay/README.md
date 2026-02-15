# Codex Discord Relay

Direct Discord -> Codex CLI relay so you can chat with Codex from Discord (including iPhone) without going through OpenClaw.

## What it does

- Replies in DMs and when mentioned in guild channels.
- Persists a Codex `thread_id` per Discord conversation.
- Queues messages per conversation to avoid overlap.
- Supports quick commands:
  - `/status`
  - `/reset`
  - `/workdir /absolute/path`
  - `/attach <thread_id>`
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
```

4. Check logs:

```bash
tail -f /root/.codex-discord-relay/relay.log
```

## Notes

- Default `CODEX_APPROVAL=never` prevents approval prompts from blocking mobile usage.
- Keep `CODEX_SANDBOX=workspace-write` unless you intentionally need broader access.
- `/workdir` is restricted by `CODEX_ALLOWED_WORKDIR_ROOTS`.
- If Discord is blocked on your network, the relay supports proxies via `DISCORD_GATEWAY_PROXY` / `HTTPS_PROXY` / `HTTP_PROXY`.
  It will also automatically source `/root/.openclaw/proxy.env` when starting (same proxy config used by OpenClaw).
- `/attach` is **DM-only by default**. Set `RELAY_ATTACH_ALLOW_GUILDS=true` if you intentionally want to allow attaching sessions in guild channels.
