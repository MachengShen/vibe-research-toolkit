# OpenClaw + Codex Discord Kit

Portable setup kit for:
- OpenClaw Gateway + Discord channel
- Proxy env (China/GFW)
- Direct Discord -> Codex CLI relay (so you can vibe code from iPhone)

## Quick Start (new machine)

1. Clone repo
2. Create config:

```bash
cp config/setup.env.example config/setup.env
$EDITOR config/setup.env
```

3. Run:

```bash
sudo ./bootstrap.sh
```

## What gets installed

- `/usr/local/bin/openclaw-gateway-ensure.sh`
- `/usr/local/bin/codex-discord-relay-ensure.sh`
- `/usr/local/bin/codex-discord-relayctl`
- Cron entries to keep both services alive
- Proxy env at `/root/.openclaw/proxy.env` (or `$OPENCLAW_STATE_DIR/proxy.env`)

## Run/Check

```bash
openclaw gateway health
openclaw status
codex-discord-relayctl status
codex-discord-relayctl logs
```

## Notes

- Secrets are never committed. Put them in `config/setup.env`.
- If Discord is blocked, set `OPENCLAW_PROXY_URL` to your local proxy (e.g. Clash `http://127.0.0.1:7897`).
