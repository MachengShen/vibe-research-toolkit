# OpenClaw + Codex Discord + Skills Kit

Portable setup kit for:
- OpenClaw Gateway + dashboard
- OpenClaw Discord channel (optional)
- Proxy env (China/GFW)
- Direct Discord -> Codex CLI relay (so you can vibe code from iPhone)
- Reusable local Codex skills (packaged + installable)

Repository rename note:
- Canonical repo name is now `openclaw-codex-discord-skills-kit`.
- Previous name `openclaw-codex-discord-kit` may still work via GitHub redirect.

## Quick Start (new machine, one-shot)

1. Clone repo:

```bash
git clone <your-repo-url>
cd openclaw-codex-discord-skills-kit
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

Bootstrap installs:

- `/usr/local/bin/openclaw-gateway-ensure.sh`
- `/usr/local/bin/codex-discord-relay-ensure.sh`
- `/usr/local/bin/codex-discord-relayctl`
- `/usr/local/bin/codex-discord-relay-ensure-multi.sh`
- `/usr/local/bin/codex-discord-relay-multictl`
- `/usr/local/bin/openclaw-kit-autoupdate.sh`
- `/etc/systemd/system/openclaw-kit-autoupdate.service`
- `/etc/systemd/system/openclaw-kit-autoupdate.timer`
- Cron entries for gateway + relay ensure scripts (`@reboot` + periodic ensure)
- Proxy env at `/root/.openclaw/proxy.env` (or `$OPENCLAW_STATE_DIR/proxy.env`) sourced by ensure scripts and autoupdate script
- Packaged custom skills from `packaged-skills/codex/*` installed into `$CODEX_HOME/skills` (default `~/.codex/skills`)

Relay multi-instance state layout:

- Default relay state: `/root/.codex-discord-relay`
- Extra instance env files: `/root/.codex-discord-relay/instances.d/<name>.env`
- Extra instance state dirs: `/root/.codex-discord-relay/instances/<name>/`

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

codex-discord-relay-multictl list
codex-discord-relay-multictl logs default

# Auto-update service
systemctl status openclaw-kit-autoupdate.timer --no-pager
systemctl list-timers --all | rg openclaw-kit-autoupdate
tail -n 120 /var/log/openclaw-kit-autoupdate.log

# If systemd is unavailable (container/minimal init), fallback cron is used:
cat /etc/cron.d/openclaw-kit-autoupdate

# Packaged skills:
bash ./scripts/install_packaged_skills.sh --list
ls -la "${CODEX_HOME:-$HOME/.codex}/skills"
```

## Packaged Skills

This repo bundles reusable local skills under:

- `packaged-skills/codex/codex-discord-relay-stuck-check`
- `packaged-skills/codex/discord-image-upload`
- `packaged-skills/codex/openclaw-media-send`
- `packaged-skills/codex/periodic-mechanistic-service`

Install/update bundled skills with one command:

```bash
bash ./scripts/install_packaged_skills.sh
```

Useful options:

```bash
# only install selected skills
bash ./scripts/install_packaged_skills.sh --only "discord-image-upload,openclaw-media-send"

# do not overwrite existing installed skills
bash ./scripts/install_packaged_skills.sh --overwrite false

# preview actions
bash ./scripts/install_packaged_skills.sh --dry-run
```

## Auto-Update Config

Set these in `config/setup.env` before bootstrap:

- `OPENCLAW_KIT_AUTOUPDATE_ENABLED=true|false`
- `OPENCLAW_KIT_AUTOUPDATE_CALENDAR` (default `daily`, supports systemd `OnCalendar` syntax)
- `OPENCLAW_KIT_AUTOUPDATE_RANDOMIZED_DELAY` (default `30m`)
- `OPENCLAW_KIT_AUTOUPDATE_PERSISTENT` (default `true`)
- `OPENCLAW_KIT_AUTOUPDATE_CRON` (fallback cron schedule, used only when systemd is unavailable; default `17 3 * * *`)

Example cadences:

- Daily: `OPENCLAW_KIT_AUTOUPDATE_CALENDAR=daily`
- Every 3 days (03:00): `OPENCLAW_KIT_AUTOUPDATE_CALENDAR=*-*-1,4,7,10,13,16,19,22,25,28 03:00:00`

## Relay Stall Triage (Quick)

```bash
# relay process + instance status
codex-discord-relay-multictl list
pgrep -af "codex-discord-relay/relay.js" || true

# look for long-running/hung codex child jobs
pgrep -af "codex .*exec" || true

# inspect logs
tail -n 200 /root/.codex-discord-relay/relay.log
```

Common signals:

- `ETIMEDOUT ...:443` -> proxy/network path issue (check `/root/.openclaw/proxy.env`).
- `Cannot find module 'node:fs'` or `node:fs/promises` -> old Node runtime was used.
- `Working...` message stops updating while a `codex exec` process is still alive -> queue is blocked by a hung run; restart relay from SSH.

## Notes

- Secrets are never committed. Put them in `config/setup.env` (and rotate any token you pasted into chats/logs).
- If Discord is blocked, set `OPENCLAW_PROXY_URL` to your local proxy (e.g. Clash `http://127.0.0.1:7897`).
- If you want this repo to be publicly cloneable, keep it public but never add `config/setup.env` (it is gitignored).
