#!/usr/bin/env bash
set -euo pipefail

KIT_REPO_DIR="${OPENCLAW_KIT_REPO_DIR:-/root/openclaw-codex-discord-kit}"
PROXY_ENV_FILE="${OPENCLAW_PROXY_ENV_FILE:-/root/.openclaw/proxy.env}"
LOG_FILE="${OPENCLAW_KIT_AUTOUPDATE_LOG:-/var/log/openclaw-kit-autoupdate.log}"
LOCK_FILE="${OPENCLAW_KIT_AUTOUPDATE_LOCK:-/tmp/openclaw-kit-autoupdate.lock}"

mkdir -p "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"
chmod 600 "$LOG_FILE" 2>/dev/null || true

log() {
  printf '[%s] %s\n' "$(date --iso-8601=seconds)" "$*" >>"$LOG_FILE"
}

mkdir -p "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "auto-update skipped: another run is active (lock: $LOCK_FILE)"
  exit 0
fi

if [[ ! -d "$KIT_REPO_DIR/.git" ]]; then
  log "auto-update failed: missing git repo at $KIT_REPO_DIR"
  exit 1
fi

if [[ -f "$PROXY_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$PROXY_ENV_FILE"
  set +a
fi

cd "$KIT_REPO_DIR"

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
if [[ -z "$branch" || "$branch" == "HEAD" ]]; then
  log "auto-update skipped: detached HEAD"
  exit 0
fi

if [[ -n "$(git status --porcelain)" ]]; then
  log "auto-update skipped: local changes present in $KIT_REPO_DIR"
  exit 0
fi

before="$(git rev-parse HEAD)"
log "checking updates (repo=$KIT_REPO_DIR branch=$branch head=$before)"

git fetch --prune origin "$branch" >>"$LOG_FILE" 2>&1
remote_ref="origin/$branch"
if ! git rev-parse --verify "$remote_ref" >/dev/null 2>&1; then
  log "auto-update failed: remote ref not found: $remote_ref"
  exit 1
fi

remote_head="$(git rev-parse "$remote_ref")"
if [[ "$before" != "$remote_head" ]]; then
  git merge --ff-only "$remote_ref" >>"$LOG_FILE" 2>&1
  after="$(git rev-parse HEAD)"
  log "repository updated: $before -> $after"
else
  log "repository already up-to-date: $before"
fi

log "re-applying deployment scripts"
"$KIT_REPO_DIR/scripts/install_openclaw_gateway_watchdog.sh" >>"$LOG_FILE" 2>&1
"$KIT_REPO_DIR/scripts/install_codex_discord_relay.sh" >>"$LOG_FILE" 2>&1
"$KIT_REPO_DIR/scripts/install_openclaw_kit_autoupdate.sh" >>"$LOG_FILE" 2>&1
"$KIT_REPO_DIR/scripts/install_cron.sh" >>"$LOG_FILE" 2>&1

if [[ -x /usr/local/bin/openclaw-gateway-ensure.sh ]]; then
  /usr/local/bin/openclaw-gateway-ensure.sh >>"$LOG_FILE" 2>&1 || true
fi

if [[ -x /usr/local/bin/codex-discord-relay-ensure-multi.sh ]]; then
  /usr/local/bin/codex-discord-relay-ensure-multi.sh >>"$LOG_FILE" 2>&1 || true
elif [[ -x /usr/local/bin/codex-discord-relay-ensure.sh ]]; then
  /usr/local/bin/codex-discord-relay-ensure.sh >>"$LOG_FILE" 2>&1 || true
fi

if command -v openclaw >/dev/null 2>&1; then
  if openclaw gateway health >/dev/null 2>&1; then
    log "health: openclaw gateway ok"
  else
    log "health: openclaw gateway check failed"
  fi
fi

if [[ -x /usr/local/bin/codex-discord-relay-multictl ]]; then
  /usr/local/bin/codex-discord-relay-multictl list >>"$LOG_FILE" 2>&1 || true
elif [[ -x /usr/local/bin/codex-discord-relayctl ]]; then
  /usr/local/bin/codex-discord-relayctl status >>"$LOG_FILE" 2>&1 || true
fi

log "auto-update run complete"

