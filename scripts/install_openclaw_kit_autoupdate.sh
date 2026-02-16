#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/common.sh"

require_root

AUTOUPDATE_ENABLED="${OPENCLAW_KIT_AUTOUPDATE_ENABLED:-true}"
AUTOUPDATE_CALENDAR="${OPENCLAW_KIT_AUTOUPDATE_CALENDAR:-daily}"
AUTOUPDATE_RANDOMIZED_DELAY="${OPENCLAW_KIT_AUTOUPDATE_RANDOMIZED_DELAY:-30m}"
AUTOUPDATE_PERSISTENT="${OPENCLAW_KIT_AUTOUPDATE_PERSISTENT:-true}"
AUTOUPDATE_REPO_DIR="${OPENCLAW_KIT_AUTOUPDATE_REPO_DIR:-$ROOT_DIR}"
AUTOUPDATE_LOG="${OPENCLAW_KIT_AUTOUPDATE_LOG:-/var/log/openclaw-kit-autoupdate.log}"
PROXY_ENV_FILE="${OPENCLAW_PROXY_ENV_FILE:-/root/.openclaw/proxy.env}"
AUTOUPDATE_CRON="${OPENCLAW_KIT_AUTOUPDATE_CRON:-17 3 * * *}"
FALLBACK_CRON_FILE="/etc/cron.d/openclaw-kit-autoupdate"

SERVICE_FILE="/etc/systemd/system/openclaw-kit-autoupdate.service"
TIMER_FILE="/etc/systemd/system/openclaw-kit-autoupdate.timer"

install -m 755 "$ROOT_DIR/system/openclaw-kit-autoupdate.sh" /usr/local/bin/openclaw-kit-autoupdate.sh
install -m 644 "$ROOT_DIR/system/openclaw-kit-autoupdate.service" "$SERVICE_FILE"
install -m 644 "$ROOT_DIR/system/openclaw-kit-autoupdate.timer" "$TIMER_FILE"

escape_sed() {
  printf '%s' "$1" | sed -e 's/[\\/&]/\\&/g'
}

repo_esc="$(escape_sed "$AUTOUPDATE_REPO_DIR")"
proxy_esc="$(escape_sed "$PROXY_ENV_FILE")"
log_esc="$(escape_sed "$AUTOUPDATE_LOG")"
cal_esc="$(escape_sed "$AUTOUPDATE_CALENDAR")"
delay_esc="$(escape_sed "$AUTOUPDATE_RANDOMIZED_DELAY")"
persist_esc="$(escape_sed "$AUTOUPDATE_PERSISTENT")"

sed -i "s|^Environment=OPENCLAW_KIT_REPO_DIR=.*|Environment=OPENCLAW_KIT_REPO_DIR=${repo_esc}|" "$SERVICE_FILE"
sed -i "s|^Environment=OPENCLAW_PROXY_ENV_FILE=.*|Environment=OPENCLAW_PROXY_ENV_FILE=${proxy_esc}|" "$SERVICE_FILE"
sed -i "s|^Environment=OPENCLAW_KIT_AUTOUPDATE_LOG=.*|Environment=OPENCLAW_KIT_AUTOUPDATE_LOG=${log_esc}|" "$SERVICE_FILE"

sed -i "s|^OnCalendar=.*|OnCalendar=${cal_esc}|" "$TIMER_FILE"
sed -i "s|^RandomizedDelaySec=.*|RandomizedDelaySec=${delay_esc}|" "$TIMER_FILE"
sed -i "s|^Persistent=.*|Persistent=${persist_esc}|" "$TIMER_FILE"

if command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]; then
  systemctl daemon-reload
  case "$(printf '%s' "$AUTOUPDATE_ENABLED" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on)
      systemctl enable --now openclaw-kit-autoupdate.timer
      rm -f "$FALLBACK_CRON_FILE" 2>/dev/null || true
      log "enabled openclaw-kit-autoupdate.timer (calendar=$AUTOUPDATE_CALENDAR, randomized_delay=$AUTOUPDATE_RANDOMIZED_DELAY)"
      ;;
    *)
      systemctl disable --now openclaw-kit-autoupdate.timer >/dev/null 2>&1 || true
      rm -f "$FALLBACK_CRON_FILE" 2>/dev/null || true
      log "installed auto-update units but timer disabled (OPENCLAW_KIT_AUTOUPDATE_ENABLED=$AUTOUPDATE_ENABLED)"
      ;;
  esac
else
  case "$(printf '%s' "$AUTOUPDATE_ENABLED" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on)
      cat > "$FALLBACK_CRON_FILE" <<EOF
# Fallback auto-update schedule when systemd is unavailable.
$AUTOUPDATE_CRON root OPENCLAW_KIT_REPO_DIR=${AUTOUPDATE_REPO_DIR} OPENCLAW_PROXY_ENV_FILE=${PROXY_ENV_FILE} OPENCLAW_KIT_AUTOUPDATE_LOG=${AUTOUPDATE_LOG} /usr/local/bin/openclaw-kit-autoupdate.sh
EOF
      chmod 644 "$FALLBACK_CRON_FILE"
      log "systemd not available; installed cron fallback at $FALLBACK_CRON_FILE ($AUTOUPDATE_CRON)"
      ;;
    *)
      rm -f "$FALLBACK_CRON_FILE" 2>/dev/null || true
      log "systemd not available; autoupdate disabled (OPENCLAW_KIT_AUTOUPDATE_ENABLED=$AUTOUPDATE_ENABLED)"
      ;;
  esac
fi
