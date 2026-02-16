#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  install_periodic_systemd_timer.sh --name NAME --script /abs/path.sh [options]

Required:
  --name NAME                     systemd unit basename (e.g. "my-job")
  --script ABS_PATH               absolute path to executable script

Optional:
  --calendar SPEC                 systemd OnCalendar spec (default: daily)
  --randomized-delay DURATION     RandomizedDelaySec (default: 15m)
  --persistent true|false         Persistent value (default: true)
  --user USER                     unit User/Group (default: root)
  --working-dir ABS_PATH          WorkingDirectory (default: /root)
  --env-file ABS_PATH             optional EnvironmentFile
  --log-file ABS_PATH             log output path (default: /var/log/<name>.log)
  --enable true|false             enable/start timer (default: true)
  --dry-run                       print files but do not write/apply
  -h, --help                      show this help
USAGE
}

bool_normalize() {
  local raw="${1:-}"
  case "$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) echo "true" ;;
    0|false|no|off) echo "false" ;;
    *)
      echo "invalid boolean: $raw" >&2
      exit 2
      ;;
  esac
}

NAME=""
SCRIPT_PATH=""
CALENDAR="daily"
RANDOMIZED_DELAY="15m"
PERSISTENT="true"
UNIT_USER="root"
WORKING_DIR="/root"
ENV_FILE=""
LOG_FILE=""
ENABLE="true"
DRY_RUN="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name) NAME="${2:-}"; shift 2 ;;
    --script) SCRIPT_PATH="${2:-}"; shift 2 ;;
    --calendar) CALENDAR="${2:-}"; shift 2 ;;
    --randomized-delay) RANDOMIZED_DELAY="${2:-}"; shift 2 ;;
    --persistent) PERSISTENT="$(bool_normalize "${2:-}")"; shift 2 ;;
    --user) UNIT_USER="${2:-}"; shift 2 ;;
    --working-dir) WORKING_DIR="${2:-}"; shift 2 ;;
    --env-file) ENV_FILE="${2:-}"; shift 2 ;;
    --log-file) LOG_FILE="${2:-}"; shift 2 ;;
    --enable) ENABLE="$(bool_normalize "${2:-}")"; shift 2 ;;
    --dry-run) DRY_RUN="true"; shift 1 ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ -z "$NAME" || -z "$SCRIPT_PATH" ]]; then
  usage
  exit 2
fi

if [[ ! "$NAME" =~ ^[A-Za-z0-9][A-Za-z0-9_.@-]*$ ]]; then
  echo "Invalid --name: $NAME" >&2
  exit 2
fi

if [[ ! "$SCRIPT_PATH" = /* ]]; then
  echo "--script must be an absolute path" >&2
  exit 2
fi

if [[ ! -f "$SCRIPT_PATH" ]]; then
  echo "Script not found: $SCRIPT_PATH" >&2
  exit 2
fi

if [[ ! -x "$SCRIPT_PATH" ]]; then
  echo "Script is not executable: $SCRIPT_PATH" >&2
  exit 2
fi

if [[ ! "$WORKING_DIR" = /* ]]; then
  echo "--working-dir must be an absolute path" >&2
  exit 2
fi

if [[ -n "$ENV_FILE" && ! "$ENV_FILE" = /* ]]; then
  echo "--env-file must be an absolute path" >&2
  exit 2
fi

if [[ -z "$LOG_FILE" ]]; then
  LOG_FILE="/var/log/${NAME}.log"
fi
if [[ ! "$LOG_FILE" = /* ]]; then
  echo "--log-file must be an absolute path" >&2
  exit 2
fi

SERVICE_PATH="/etc/systemd/system/${NAME}.service"
TIMER_PATH="/etc/systemd/system/${NAME}.timer"

SERVICE_CONTENT="$(cat <<EOF
[Unit]
Description=Periodic job: ${NAME}
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
User=${UNIT_USER}
Group=${UNIT_USER}
WorkingDirectory=${WORKING_DIR}
ExecStart=${SCRIPT_PATH}
StandardOutput=append:${LOG_FILE}
StandardError=append:${LOG_FILE}
EOF
)"

if [[ -n "$ENV_FILE" ]]; then
  SERVICE_CONTENT="${SERVICE_CONTENT}"$'\n'"EnvironmentFile=${ENV_FILE}"
fi

TIMER_CONTENT="$(cat <<EOF
[Unit]
Description=Timer for periodic job: ${NAME}

[Timer]
OnCalendar=${CALENDAR}
RandomizedDelaySec=${RANDOMIZED_DELAY}
Persistent=${PERSISTENT}

[Install]
WantedBy=timers.target
EOF
)"

if [[ "$DRY_RUN" == "true" ]]; then
  printf -- '--- %s ---\n%s\n\n' "$SERVICE_PATH" "$SERVICE_CONTENT"
  printf -- '--- %s ---\n%s\n' "$TIMER_PATH" "$TIMER_CONTENT"
  exit 0
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Must run as root." >&2
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1 || [[ ! -d /run/systemd/system ]]; then
  echo "systemd is unavailable on this host; use cron fallback instead." >&2
  exit 1
fi

mkdir -p "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"
chmod 640 "$LOG_FILE" 2>/dev/null || true

printf '%s\n' "$SERVICE_CONTENT" >"$SERVICE_PATH"
printf '%s\n' "$TIMER_CONTENT" >"$TIMER_PATH"

systemctl daemon-reload

if [[ "$ENABLE" == "true" ]]; then
  systemctl enable --now "${NAME}.timer"
else
  systemctl disable --now "${NAME}.timer" >/dev/null 2>&1 || true
fi

echo "Installed:"
echo "- $SERVICE_PATH"
echo "- $TIMER_PATH"
echo "Timer state:"
systemctl status "${NAME}.timer" --no-pager | sed -n '1,10p'
