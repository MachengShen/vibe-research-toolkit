#!/usr/bin/env bash
set -euo pipefail

# Serialize GPU jobs with a shared lock file and per-job timeout.
# Usage:
#   scripts/gpu_gate.sh [-n job_name] [-t 5h] [--lock /tmp/codex_gpu0.lock] -- <command...>

LOCK_PATH="/tmp/codex_gpu0.lock"
TIME_LIMIT="5h"
JOB_NAME="gpu_job"
LOG_DIR="${GPU_GATE_LOG_DIR:-/root/gpu-queue-logs}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -n|--name)
      JOB_NAME="$2"
      shift 2
      ;;
    -t|--timeout)
      TIME_LIMIT="$2"
      shift 2
      ;;
    --lock)
      LOCK_PATH="$2"
      shift 2
      ;;
    --log-dir)
      LOG_DIR="$2"
      shift 2
      ;;
    --)
      shift
      break
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ $# -eq 0 ]]; then
  echo "missing command. usage: gpu_gate.sh [opts] -- <command...>" >&2
  exit 2
fi

mkdir -p "$(dirname "$LOCK_PATH")" "$LOG_DIR"
ts="$(date +%Y%m%d-%H%M%S)"
safe_name="$(echo "$JOB_NAME" | tr -cs 'A-Za-z0-9._-' '_')"
log_path="$LOG_DIR/${ts}_${safe_name}.log"

echo "job_name=$JOB_NAME"
echo "lock=$LOCK_PATH"
echo "timeout=$TIME_LIMIT"
echo "log=$log_path"
echo "waiting_for_lock=1"

exec 9>"$LOCK_PATH"
flock -x 9

echo "lock_acquired=1"
echo "start_time=$(date -Iseconds)"

set +e
timeout --signal=TERM --kill-after=60s "$TIME_LIMIT" "$@" >>"$log_path" 2>&1
rc=$?
set -e

echo "end_time=$(date -Iseconds)"
echo "exit_code=$rc"

if [[ $rc -eq 124 || $rc -eq 137 ]]; then
  echo "status=timeout_or_killed"
else
  echo "status=finished"
fi

echo "log=$log_path"
exit "$rc"
