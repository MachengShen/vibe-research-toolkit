#!/usr/bin/env bash
set -euo pipefail

DURATION_SEC="${1:-7200}"
INTERVAL_SEC="${2:-180}"
OUT_ROOT="${3:-/root/.codex-discord-relay/experiments}"

RUN_ID="vpn-probe-$(date +%Y%m%d-%H%M%S)"
OUT_DIR="$OUT_ROOT/$RUN_ID"
LATEST_LINK="$OUT_ROOT/vpn-probe-latest"
JSONL="$OUT_DIR/probe.jsonl"
SUMMARY="$OUT_DIR/summary.md"
LOG="$OUT_DIR/run.log"

mkdir -p "$OUT_DIR"
mkdir -p "$OUT_ROOT"
ln -sfn "$OUT_DIR" "$LATEST_LINK"

log() {
  printf '[%s] %s\n' "$(date --iso-8601=seconds)" "$*" | tee -a "$LOG"
}

if [[ -f /root/.openclaw/proxy.env ]]; then
  set -a
  # shellcheck disable=SC1091
  source /root/.openclaw/proxy.env
  set +a
fi

probe_http() {
  local mode="$1"
  local url="$2"
  local errf rc res code tt err
  errf="$(mktemp)"
  if [[ "$mode" == "direct" ]]; then
    set +e
    res="$(env -u HTTPS_PROXY -u HTTP_PROXY -u ALL_PROXY -u OPENCLAW_PROXY_URL -u DISCORD_GATEWAY_PROXY \
      curl -sS -o /dev/null -w '%{http_code} %{time_total}' --max-time 12 "$url" 2>"$errf")"
    rc=$?
    set -e
  else
    set +e
    res="$(curl -sS -o /dev/null -w '%{http_code} %{time_total}' --max-time 12 "$url" 2>"$errf")"
    rc=$?
    set -e
  fi
  if [[ $rc -ne 0 ]]; then
    code="ERR"
    tt="NA"
    err="$(tail -n 3 "$errf" | tr '\n' ' ' | sed -E 's/[[:space:]]+/ /g' | cut -c1-280)"
  else
    code="${res%% *}"
    tt="${res##* }"
    err=""
  fi
  rm -f "$errf"
  printf '%s|%s|%s' "$code" "$tt" "${err//|//}"
}

run_agent_probe() {
  local agent="$1"
  local prompt="Reply with exactly OK."
  local out err start_ms end_ms rc elapsed err_tail out_tail
  out="$(mktemp)"
  err="$(mktemp)"
  start_ms="$(date +%s%3N)"
  if [[ "$agent" == "codex" ]]; then
    set +e
    timeout 120s codex exec --sandbox danger-full-access --skip-git-repo-check -c approval_policy="never" --json "$prompt" >"$out" 2>"$err"
    rc=$?
    set -e
  elif [[ "$agent" == "claude" ]]; then
    if ! command -v claude >/dev/null 2>&1; then
      rm -f "$out" "$err"
      printf '127|0|claude_not_installed|'
      return
    fi
    set +e
    timeout 120s claude --permission-mode acceptEdits -p --output-format stream-json --verbose -- "$prompt" >"$out" 2>"$err"
    rc=$?
    set -e
  else
    rm -f "$out" "$err"
    printf '127|0|unknown_agent|'
    return
  fi
  end_ms="$(date +%s%3N)"
  elapsed="$((end_ms - start_ms))"
  err_tail="$(tail -n 6 "$err" 2>/dev/null | tr '\n' ' ' | sed -E 's/[[:space:]]+/ /g' | cut -c1-280)"
  out_tail="$(tail -n 4 "$out" 2>/dev/null | tr '\n' ' ' | sed -E 's/[[:space:]]+/ /g' | cut -c1-280)"
  rm -f "$out" "$err"
  printf '%s|%s|%s|%s' "$rc" "$elapsed" "${err_tail//|//}" "${out_tail//|//}"
}

cat >"$SUMMARY" <<MD
# VPN Hypothesis Probe Summary

- Run ID: $RUN_ID
- Started: $(date --iso-8601=seconds)
- Duration target (sec): $DURATION_SEC
- Interval (sec): $INTERVAL_SEC
- Data file: $JSONL

MD

log "starting probe run_id=$RUN_ID duration_sec=$DURATION_SEC interval_sec=$INTERVAL_SEC"

start_epoch="$(date +%s)"
end_epoch="$((start_epoch + DURATION_SEC))"
cycle=0

while :; do
  now_epoch="$(date +%s)"
  if [[ "$now_epoch" -gt "$end_epoch" ]]; then
    break
  fi

  cycle="$((cycle + 1))"
  ts="$(date --iso-8601=seconds)"
  relay_pid="$(pgrep -f '/root/codex-discord-relay/relay.js --instance default' | head -n1 || true)"

  IFS='|' read -r proxy_models_code proxy_models_time proxy_models_err <<<"$(probe_http proxy https://api.openai.com/v1/models)"
  IFS='|' read -r direct_models_code direct_models_time direct_models_err <<<"$(probe_http direct https://api.openai.com/v1/models)"
  IFS='|' read -r proxy_status_code proxy_status_time proxy_status_err <<<"$(probe_http proxy https://status.openai.com/api/v2/status.json)"

  IFS='|' read -r codex_code codex_ms codex_err codex_out <<<"$(run_agent_probe codex)"
  IFS='|' read -r claude_code claude_ms claude_err claude_out <<<"$(run_agent_probe claude)"

  python3 - "$JSONL" "$ts" "$cycle" "$relay_pid" \
    "$proxy_models_code" "$proxy_models_time" "$proxy_models_err" \
    "$direct_models_code" "$direct_models_time" "$direct_models_err" \
    "$proxy_status_code" "$proxy_status_time" "$proxy_status_err" \
    "$codex_code" "$codex_ms" "$codex_err" "$codex_out" \
    "$claude_code" "$claude_ms" "$claude_err" "$claude_out" <<'PY'
import json, sys
(
    out,
    ts,
    cycle,
    relay_pid,
    p_models_code,
    p_models_time,
    p_models_err,
    d_models_code,
    d_models_time,
    d_models_err,
    p_status_code,
    p_status_time,
    p_status_err,
    codex_code,
    codex_ms,
    codex_err,
    codex_out,
    claude_code,
    claude_ms,
    claude_err,
    claude_out,
) = sys.argv[1:]
row = {
    "ts": ts,
    "cycle": int(cycle),
    "relay_pid": int(relay_pid) if relay_pid and relay_pid.isdigit() else None,
    "network": {
        "proxy_models": {"code": p_models_code, "sec": p_models_time, "err": p_models_err},
        "direct_models": {"code": d_models_code, "sec": d_models_time, "err": d_models_err},
        "proxy_status": {"code": p_status_code, "sec": p_status_time, "err": p_status_err},
    },
    "codex": {"exit": int(codex_code) if codex_code.lstrip('-').isdigit() else codex_code, "ms": int(codex_ms) if codex_ms.isdigit() else None, "err": codex_err, "out": codex_out},
    "claude": {"exit": int(claude_code) if claude_code.lstrip('-').isdigit() else claude_code, "ms": int(claude_ms) if claude_ms.isdigit() else None, "err": claude_err, "out": claude_out},
}
with open(out, "a", encoding="utf-8") as f:
    f.write(json.dumps(row, ensure_ascii=True) + "\n")
PY

  log "cycle=$cycle codex_exit=$codex_code claude_exit=$claude_code proxy_models=$proxy_models_code proxy_status=$proxy_status_code"

  now_epoch="$(date +%s)"
  if [[ "$now_epoch" -ge "$end_epoch" ]]; then
    break
  fi
  sleep "$INTERVAL_SEC"
done

python3 - "$JSONL" "$SUMMARY" <<'PY'
import json, sys, pathlib
rows=[]
for line in pathlib.Path(sys.argv[1]).read_text(encoding='utf-8').splitlines():
    line=line.strip()
    if not line:
        continue
    rows.append(json.loads(line))

def ok_code(c):
    return str(c) in {"200", "401"}

def is_bad_net(r):
    n=r.get("network",{})
    pm=n.get("proxy_models",{}).get("code")
    ps=n.get("proxy_status",{}).get("code")
    return (not ok_code(pm)) or str(ps)!="200"

def is_fail(v):
    return v not in (0, "0")

cycles=len(rows)
codex_fail=sum(1 for r in rows if is_fail((r.get("codex") or {}).get("exit")))
claude_fail=sum(1 for r in rows if is_fail((r.get("claude") or {}).get("exit")))
net_bad=sum(1 for r in rows if is_bad_net(r))
both_fail=sum(1 for r in rows if is_fail((r.get("codex") or {}).get("exit")) and is_fail((r.get("claude") or {}).get("exit")))
codex_fail_net_bad=sum(1 for r in rows if is_fail((r.get("codex") or {}).get("exit")) and is_bad_net(r))
claude_fail_net_bad=sum(1 for r in rows if is_fail((r.get("claude") or {}).get("exit")) and is_bad_net(r))

lines=[]
lines.append("## Results")
lines.append("")
lines.append(f"- Cycles: {cycles}")
lines.append(f"- Codex failures: {codex_fail}")
lines.append(f"- Claude failures: {claude_fail}")
lines.append(f"- Network-bad cycles (proxy_models not 200/401 or proxy_status != 200): {net_bad}")
lines.append(f"- Both-agent failures in same cycle: {both_fail}")
lines.append(f"- Codex failures during network-bad cycles: {codex_fail_net_bad}")
lines.append(f"- Claude failures during network-bad cycles: {claude_fail_net_bad}")
lines.append("")
if cycles > 0:
    codex_rate = codex_fail / cycles
    claude_rate = claude_fail / cycles
    lines.append(f"- Codex failure rate: {codex_rate:.3f}")
    lines.append(f"- Claude failure rate: {claude_rate:.3f}")

p=pathlib.Path(sys.argv[2])
with p.open("a", encoding="utf-8") as f:
    f.write("\n".join(lines) + "\n")
PY

log "probe completed out_dir=$OUT_DIR"
log "summary=$SUMMARY"
