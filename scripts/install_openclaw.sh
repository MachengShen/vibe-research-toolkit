#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/common.sh"

require_root
require_cmd npm

ver="${OPENCLAW_VERSION:-}"
if [[ -n "$ver" ]]; then
  log "installing openclaw@$ver"
  npm install -g "openclaw@$ver"
else
  log "installing latest openclaw"
  npm install -g openclaw
fi

log "openclaw installed: $(openclaw --version 2>/dev/null || true)"
