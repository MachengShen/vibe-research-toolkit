#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/common.sh"

require_root

add_line() {
  local line="$1"
  local current
  current="$(crontab -l 2>/dev/null || true)"
  if printf '%s\n' "$current" | grep -Fqx "$line"; then
    return 0
  fi
  printf '%s\n' "$current" "$line" | sed '/^$/d' | crontab -
}

add_line '@reboot /usr/local/bin/openclaw-gateway-ensure.sh'
add_line '*/2 * * * * /usr/local/bin/openclaw-gateway-ensure.sh'

add_line '@reboot /usr/local/bin/codex-discord-relay-ensure.sh'
add_line '*/1 * * * * /usr/local/bin/codex-discord-relay-ensure.sh'

log "cron installed/updated"
crontab -l | tail -n 20
