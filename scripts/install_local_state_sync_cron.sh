#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/common.sh"

require_root

SYNC_ENABLED="${OPENCLAW_STATE_SYNC_CRON_ENABLED:-false}"
# Default daily cadence (03:05 local time) to align with the kit autoupdate (03:17).
SYNC_CRON="${OPENCLAW_STATE_SYNC_CRON:-5 3 * * *}"
SYNC_CRON_FILE="${OPENCLAW_STATE_SYNC_CRON_FILE:-/etc/cron.d/openclaw-state-sync}"
SYNC_LOG="${OPENCLAW_STATE_SYNC_LOG:-/var/log/openclaw-state-sync.log}"
WITH_SECRETS="${OPENCLAW_STATE_SYNC_INCLUDE_SECRETS:-false}"
SYNC_PUSH="${OPENCLAW_STATE_SYNC_PUSH:-false}"

bool_normalize() {
  local raw="${1:-}"
  case "$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) echo "true" ;;
    0|false|no|off) echo "false" ;;
    *) die "invalid boolean: $raw" ;;
  esac
}

SYNC_ENABLED="$(bool_normalize "$SYNC_ENABLED")"
WITH_SECRETS="$(bool_normalize "$WITH_SECRETS")"
SYNC_PUSH="$(bool_normalize "$SYNC_PUSH")"

if [[ "$SYNC_ENABLED" != "true" ]]; then
  rm -f "$SYNC_CRON_FILE" 2>/dev/null || true
  log "state-sync cron disabled (OPENCLAW_STATE_SYNC_CRON_ENABLED=$SYNC_ENABLED)"
  exit 0
fi

secret_flag="--no-secrets"
[[ "$WITH_SECRETS" == "true" ]] && secret_flag="--with-secrets"
push_flag="--push false"
[[ "$SYNC_PUSH" == "true" ]] && push_flag="--push true"

cat > "$SYNC_CRON_FILE" <<EOF2
# Snapshot local machine settings back into toolkit repo.
$SYNC_CRON root cd $ROOT_DIR && /bin/bash ./scripts/sync_local_state_to_repo.sh $secret_flag --commit true $push_flag >>$SYNC_LOG 2>&1
EOF2
chmod 644 "$SYNC_CRON_FILE"

touch "$SYNC_LOG"
chmod 600 "$SYNC_LOG" 2>/dev/null || true

log "installed state-sync cron: $SYNC_CRON_FILE ($SYNC_CRON)"
