# OpenClaw + Codex Discord Kit

Portable setup kit for:
- OpenClaw Gateway + dashboard
- OpenClaw Discord channel (optional)
- Proxy env (China/GFW)
- Direct Discord -> Codex CLI relay (so you can vibe code from iPhone)

## Quick Start (new machine, one-shot)

1. Clone repo:

```bash
git clone <your-repo-url>
cd openclaw-codex-discord-kit
```

2. Create config (secrets live here, never committed):

```bash
cp config/setup.env.example config/setup.env
$EDITOR config/setup.env
```

Minimum fields to set:
- `CODEX_DISCORD_BOT_TOKEN` (required)
- `OPENCLAW_PROXY_URL` (recommended if Discord/OpenAI/Gemini/etc are blocked; example `http://127.0.0.1:7897`)

Optional:
- `OPENCLAW_DISCORD_BOT_TOKEN` (only if you also want OpenClaw to respond on Discord)
- `OPENCLAW_DISCORD_GUILD_ID` / `OPENCLAW_DISCORD_CHANNEL_ID` (to allowlist where OpenClaw replies)
- `CODEX_ALLOWED_GUILDS` / `CODEX_ALLOWED_CHANNELS` (to restrict where the Codex relay replies in servers)

3. Run bootstrap as root (installs watchdog scripts + cron):

```bash
sudo ./bootstrap.sh
```

## What gets installed

- `/usr/local/bin/openclaw-gateway-ensure.sh`
- `/usr/local/bin/codex-discord-relay-ensure.sh`
- `/usr/local/bin/codex-discord-relayctl`
- Cron entries to keep both services alive (`@reboot` + periodic ensure)
- Proxy env at `/root/.openclaw/proxy.env` (or `$OPENCLAW_STATE_DIR/proxy.env`) sourced by both ensure scripts

## How It Works (Discord)

- **Codex relay bot**:
  - Replies in DMs.
  - Replies in servers only when mentioned (and optionally restricted by allowlists).
  - Maintains separate Codex `thread_id` per Discord context (DM vs channel vs thread).
  - Supports `/attach <thread_id>` (DM-only by default) to link an existing Codex session to a Discord context.

- **OpenClaw Discord bot** (optional):
  - Separate from the Codex relay bot if you want; recommended to avoid duplicate replies.

## Verify/Operate

```bash
openclaw gateway health
openclaw status
codex-discord-relayctl status
codex-discord-relayctl logs
```

## Notes

- Secrets are never committed. Put them in `config/setup.env` (and rotate any token you pasted into chats/logs).
- If Discord is blocked, set `OPENCLAW_PROXY_URL` to your local proxy (e.g. Clash `http://127.0.0.1:7897`).
- If you want this repo to be publicly cloneable, keep it public but never add `config/setup.env` (it is gitignored).
