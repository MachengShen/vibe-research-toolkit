#!/usr/bin/env bash
set -euo pipefail

ts() { date --iso-8601=seconds; }

echo "== codex-discord-relay stuck-check =="
echo "time: $(ts)"
echo

echo "## relay instances"
if command -v codex-discord-relay-multictl >/dev/null 2>&1; then
  codex-discord-relay-multictl list || true
elif command -v codex-discord-relayctl >/dev/null 2>&1; then
  codex-discord-relayctl status || true
else
  echo "missing: codex-discord-relay-multictl / codex-discord-relayctl"
fi
echo

echo "## relay processes"
pgrep -af "codex-discord-relay/relay.js" || echo "(none)"
echo

echo "## watchdog cron entries"
crontab -l 2>/dev/null | rg -n "codex-discord-relay" || echo "(none found)"
echo

echo "## default relay log (tail 120)"
if [[ -f /root/.codex-discord-relay/relay.log ]]; then
  tail -n 120 /root/.codex-discord-relay/relay.log
else
  echo "missing: /root/.codex-discord-relay/relay.log"
fi
echo

echo "## extra instance logs (tail 80 each)"
for d in /root/.codex-discord-relay/instances/*; do
  [[ -d "$d" ]] || continue
  name="$(basename "$d")"
  log="$d/relay.log"
  [[ -f "$log" ]] || continue
  echo "-- $name: $log --"
  tail -n 80 "$log"
  echo
done

echo "## codex processes (possible hung runs)"
if pids="$(pgrep -f "codex .*exec" 2>/dev/null || true)"; then
  if [[ -z "${pids// }" ]]; then
    echo "(none)"
  else
    for pid in $pids; do
      [[ -d "/proc/$pid" ]] || continue
      etime="$(ps -o etime= -p "$pid" 2>/dev/null | awk '{print $1}' || true)"
      comm="$(ps -o comm= -p "$pid" 2>/dev/null | awk '{print $1}' || true)"
      cmdline="$(tr '\0' ' ' </proc/"$pid"/cmdline 2>/dev/null || true)"
      # Best-effort: extract the Codex thread_id (UUID-like) without printing the full prompt/args.
      thread_id="$(printf '%s' "$cmdline" | rg -o "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}" -m 1 2>/dev/null || true)"
      if [[ -n "$thread_id" ]]; then
        echo "pid=$pid comm=${comm:-?} etime=${etime:-?} thread_id=$thread_id"
      else
        echo "pid=$pid comm=${comm:-?} etime=${etime:-?}"
      fi
    done
  fi
else
  echo "(none)"
fi
echo

echo "## node version"
if command -v node >/dev/null 2>&1; then
  echo "node: $(node -v)"
  echo "node_path: $(command -v node)"
else
  echo "node: not found"
fi
echo

echo "## env presence (redacted; <set>/<empty>)"
keys_re='^(DISCORD_BOT_TOKEN|DISCORD_GATEWAY_PROXY|DISCORD_PROXY_URL|HTTPS_PROXY|HTTP_PROXY|ALL_PROXY|OPENCLAW_PROXY_URL|DISCORD_ALLOWED_GUILDS|DISCORD_ALLOWED_CHANNELS|RELAY_PROGRESS|RELAY_PROGRESS_MIN_EDIT_MS|RELAY_PROGRESS_HEARTBEAT_MS|RELAY_PROGRESS_MAX_LINES|CODEX_BIN|CODEX_MODEL|CODEX_SANDBOX|CODEX_APPROVAL|CODEX_APPROVAL_POLICY|CODEX_ENABLE_SEARCH|CODEX_ALLOWED_WORKDIR_ROOTS)='

print_env_status() {
  local f="$1"
  if [[ ! -f "$f" ]]; then
    echo "missing: $f"
    return 0
  fi
  echo "file: $f"
  rg -n "$keys_re" "$f" | awk -F= '{
    key=$1;
    sub(/^[0-9]+:/, "", key);
    val=$0;
    sub(/^[^=]*=/, "", val);
    status=(val=="" ? "<empty>" : "<set>");
    print key "=" status;
  }' | sort -u
}

print_env_status /root/.codex-discord-relay.env
echo
print_env_status /root/.openclaw/proxy.env
