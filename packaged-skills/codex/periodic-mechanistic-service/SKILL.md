---
name: periodic-mechanistic-service
description: "Use when the user wants recurring mechanistic tasks (updates, sync, cleanup, checks) to run automatically; implement a systemd timer/service with logs, safety checks, and verification."
---

# Periodic Mechanistic Service

## When To Use
- User asks for a recurring background task (daily, weekly, every few days).
- User wants server-side automation for routine, deterministic operations.
- User asks for a service/timer instead of manual runs.

## Required Inputs
- Job name (unit basename): e.g. `repo-sync`, `nightly-healthcheck`
- Executable script path for the task (absolute path)
- Schedule (`OnCalendar`): e.g. `daily`

## Recommended Inputs
- Log path (default `/var/log/<name>.log`)
- Jitter (`RandomizedDelaySec`)
- `Persistent=true` for missed-run catch-up after reboot
- Optional proxy/env file to source (for GFW or API env)

## Preferred Workflow
1. Ensure the job script is idempotent and safe to re-run.
2. Use the bundled installer script:

```bash
bash /root/.codex/skills/periodic-mechanistic-service/scripts/install_periodic_systemd_timer.sh \
  --name my-job \
  --script /usr/local/bin/my-job.sh \
  --calendar daily \
  --randomized-delay 30m \
  --persistent true \
  --log-file /var/log/my-job.log \
  --env-file /root/.openclaw/proxy.env
```

3. Verify:

```bash
systemctl status my-job.timer --no-pager
systemctl list-timers --all | rg my-job
tail -n 120 /var/log/my-job.log
```

4. Share rollback commands:

```bash
systemctl disable --now my-job.timer
rm -f /etc/systemd/system/my-job.service /etc/systemd/system/my-job.timer
systemctl daemon-reload
```

## Fallback
- If systemd is unavailable, use cron with lock + logging.
- Keep schedule and command explicit; avoid hidden behavior.

## Safety
- Do not install destructive jobs by default.
- Use lock files in the job script for overlap protection.
- Avoid printing secrets in logs.

