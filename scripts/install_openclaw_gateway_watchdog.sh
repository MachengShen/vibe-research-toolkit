#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/common.sh"

require_root

install -m 755 "$ROOT_DIR/system/openclaw-gateway-ensure.sh" /usr/local/bin/openclaw-gateway-ensure.sh
log "installed /usr/local/bin/openclaw-gateway-ensure.sh"
