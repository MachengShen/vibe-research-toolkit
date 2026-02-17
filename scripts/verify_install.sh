#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/common.sh"

VERSIONS_LOCK="${OPENCLAW_VERSIONS_LOCK:-$ROOT_DIR/versions.lock}"

failures=0
warnings=0

pass() {
  printf '[PASS] %s\n' "$*"
}

warn() {
  warnings=$((warnings + 1))
  printf '[WARN] %s\n' "$*"
}

fail() {
  failures=$((failures + 1))
  printf '[FAIL] %s\n' "$*"
}

check_bin() {
  local bin="$1"
  if command -v "$bin" >/dev/null 2>&1; then
    pass "binary: $bin -> $(command -v "$bin")"
  else
    fail "missing binary: $bin"
  fi
}

check_file() {
  local path="$1"
  local required="$2"
  if [[ -e "$path" ]]; then
    pass "path exists: $path"
  else
    if [[ "$required" == "true" ]]; then
      fail "missing path: $path"
    else
      warn "missing optional path: $path"
    fi
  fi
}

major_of() {
  local raw="$1"
  printf '%s' "$raw" | sed -E 's/[^0-9]*([0-9]+).*/\1/'
}

compare_major() {
  local label="$1"
  local expected="$2"
  local actual_raw="$3"
  local actual
  actual="$(major_of "$actual_raw")"
  if [[ -z "$actual" || -z "$expected" ]]; then
    warn "version check skipped for $label (expected=$expected actual=$actual_raw)"
    return
  fi
  if [[ "$actual" == "$expected" ]]; then
    pass "$label major=$actual (expected=$expected)"
  else
    warn "$label major drift: actual=$actual expected=$expected (raw=$actual_raw)"
  fi
}

if [[ -f "$VERSIONS_LOCK" ]]; then
  # shellcheck disable=SC1090
  source "$VERSIONS_LOCK"
  pass "loaded versions lock: $VERSIONS_LOCK"
else
  warn "versions lock missing: $VERSIONS_LOCK"
fi

check_bin git
check_bin bash
check_bin node
check_bin npm
check_bin codex
if command -v openclaw >/dev/null 2>&1; then
  pass "binary: openclaw -> $(command -v openclaw)"
else
  warn "openclaw not installed"
fi

check_file /usr/local/bin/openclaw-gateway-ensure.sh true
if [[ -x /usr/local/bin/codex-discord-relay-ensure-multi.sh || -x /usr/local/bin/codex-discord-relay-ensure.sh ]]; then
  pass "relay ensure script installed"
else
  fail "relay ensure script missing"
fi
check_file /usr/local/bin/openclaw-kit-autoupdate.sh true
check_file /root/.codex-discord-relay.env true
check_file /root/.openclaw/proxy.env false

if command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]; then
  if systemctl is-enabled openclaw-kit-autoupdate.timer >/dev/null 2>&1; then
    pass "autoupdate timer enabled"
  else
    warn "autoupdate timer not enabled"
  fi
else
  if [[ -f /etc/cron.d/openclaw-kit-autoupdate ]]; then
    pass "autoupdate cron fallback installed"
  else
    warn "autoupdate schedule not found (no systemd timer, no cron fallback)"
  fi
fi

if [[ -x /usr/local/bin/codex-discord-relay-multictl ]]; then
  if /usr/local/bin/codex-discord-relay-multictl list >/dev/null 2>&1; then
    pass "relay multictl list ok"
  else
    warn "relay multictl list failed"
  fi
elif [[ -x /usr/local/bin/codex-discord-relayctl ]]; then
  if /usr/local/bin/codex-discord-relayctl status >/dev/null 2>&1; then
    pass "relayctl status ok"
  else
    warn "relayctl status failed"
  fi
else
  fail "relay control binary missing"
fi

if command -v openclaw >/dev/null 2>&1; then
  if openclaw gateway health >/dev/null 2>&1; then
    pass "openclaw gateway health ok"
  else
    warn "openclaw gateway health check failed"
  fi
fi

if command -v openclaw >/dev/null 2>&1; then
  openclaw_ver="$(openclaw --version 2>/dev/null || true)"
  [[ -n "${OPENCLAW_EXPECTED_VERSION:-}" ]] && {
    if [[ "$openclaw_ver" == "$OPENCLAW_EXPECTED_VERSION" ]]; then
      pass "openclaw version=$openclaw_ver"
    else
      warn "openclaw version drift: actual=$openclaw_ver expected=$OPENCLAW_EXPECTED_VERSION"
    fi
  }
fi

codex_ver="$(codex --version 2>/dev/null || true)"
[[ -n "${CODEX_EXPECTED_MAJOR:-}" ]] && compare_major "codex" "$CODEX_EXPECTED_MAJOR" "$codex_ver"
node_ver="$(node -v 2>/dev/null || true)"
[[ -n "${NODE_EXPECTED_MAJOR:-}" ]] && compare_major "node" "$NODE_EXPECTED_MAJOR" "$node_ver"
npm_ver="$(npm -v 2>/dev/null || true)"
[[ -n "${NPM_EXPECTED_MAJOR:-}" ]] && compare_major "npm" "$NPM_EXPECTED_MAJOR" "$npm_ver"
python_ver="$(python3 --version 2>/dev/null || true)"
[[ -n "${PYTHON_EXPECTED_MAJOR:-}" ]] && compare_major "python3" "$PYTHON_EXPECTED_MAJOR" "$python_ver"

printf '\nSummary: failures=%s warnings=%s\n' "$failures" "$warnings"
if [[ "$failures" -gt 0 ]]; then
  exit 1
fi
