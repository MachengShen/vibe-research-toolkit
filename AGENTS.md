# Agent Playbook

Objective: on a fresh machine, set up:
- OpenClaw Gateway + dashboard
- OpenClaw Discord channel (optional)
- Proxy env for China/GFW (optional)
- Codex Discord Relay (Codex via Discord)
- Cron watchdogs so it auto-recovers after reboot/network blips

## One-shot run

1. Copy env template:

- `cp config/setup.env.example config/setup.env`
- Fill tokens/IDs and proxy URL.

2. Run bootstrap as root:

- `sudo ./bootstrap.sh`

## Verification

- `openclaw gateway health`
- `openclaw status`
- `codex-discord-relayctl status`
- DM the Codex relay bot in Discord.

## Security

Never commit real tokens/keys. Rotate any token ever pasted into chat logs.
