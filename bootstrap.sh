#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/common.sh"

require_root

ENV_FILE="$ROOT_DIR/config/setup.env"
if [[ -f "$ENV_FILE" ]]; then
  log "loading env from $ENV_FILE"
  load_env_file "$ENV_FILE"
else
  log "no $ENV_FILE found; relying on exported env vars"
fi

# Proxy env for GFW
"$ROOT_DIR/scripts/setup_proxy_env.sh"

# OpenClaw (optional but recommended)
if command -v npm >/dev/null 2>&1; then
  "$ROOT_DIR/scripts/install_openclaw.sh" || true
fi
"$ROOT_DIR/scripts/install_openclaw_gateway_watchdog.sh"
"$ROOT_DIR/scripts/configure_openclaw_discord.sh" || true

# Codex relay (required for vibe coding via Discord)
"$ROOT_DIR/scripts/install_codex_discord_relay.sh"

# Periodic self-update service for this toolkit
"$ROOT_DIR/scripts/install_openclaw_kit_autoupdate.sh"

# Cron + start
"$ROOT_DIR/scripts/install_cron.sh"
/usr/local/bin/openclaw-gateway-ensure.sh || true
if [[ -x /usr/local/bin/codex-discord-relay-ensure-multi.sh ]]; then
  /usr/local/bin/codex-discord-relay-ensure-multi.sh || true
else
  /usr/local/bin/codex-discord-relay-ensure.sh || true
fi

"$ROOT_DIR/scripts/healthcheck.sh" || true

log "bootstrap complete"
