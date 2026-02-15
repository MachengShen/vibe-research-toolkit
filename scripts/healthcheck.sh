#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/common.sh"

log "openclaw: $(command -v openclaw || echo 'missing')"
openclaw gateway health 2>/dev/null || true
openclaw health 2>/dev/null || true

log "codex relay:"
/usr/local/bin/codex-discord-relayctl status 2>/dev/null || true
