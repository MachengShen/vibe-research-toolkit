#!/usr/bin/env bash
set -euo pipefail

# Creates ~/.openclaw/proxy.env (or /root/.openclaw/proxy.env) using OPENCLAW_PROXY_URL.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/common.sh"

require_root

STATE_DIR="${OPENCLAW_STATE_DIR:-/root/.openclaw}"
PROXY_ENV_FILE="${OPENCLAW_PROXY_ENV_FILE:-$STATE_DIR/proxy.env}"

mkdir -p "$STATE_DIR"

if [[ -z "${OPENCLAW_PROXY_URL:-}" ]]; then
  log "OPENCLAW_PROXY_URL is empty; writing proxy.env template but leaving proxy disabled"
fi

cat > "$PROXY_ENV_FILE" <<EOF2
OPENCLAW_PROXY_URL="${OPENCLAW_PROXY_URL:-}"
HTTP_PROXY="${OPENCLAW_PROXY_URL:-}"
HTTPS_PROXY="${OPENCLAW_PROXY_URL:-}"
ALL_PROXY="${OPENCLAW_PROXY_URL:-}"
NO_PROXY="${NO_PROXY:-127.0.0.1,localhost,::1}"
DISCORD_GATEWAY_PROXY="${OPENCLAW_PROXY_URL:-}"
EOF2
chmod 600 "$PROXY_ENV_FILE"

log "wrote $PROXY_ENV_FILE"
