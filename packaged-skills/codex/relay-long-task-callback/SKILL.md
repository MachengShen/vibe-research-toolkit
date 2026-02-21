---
name: relay-long-task-callback
description: Use when a task needs unattended background execution; must emit one valid [[relay-actions]] job_start block with watch.everySec/tailLines/thenTask/runTasks=true so follow-up analysis auto-runs.
---

# Relay Long Task Callback

Use this skill for long tasks that should continue without manual monitoring and come back with analysis later.

## Goal

Produce one valid relay-action block that starts a background job and configures automatic watch plus follow-up task.

## Required Output Contract

When replying inside a `/task run` step:

1. Emit exactly one `[[relay-actions]] ... [[/relay-actions]]` block.
2. JSON must be valid and contain exactly one action of type `job_start`.
3. Include `watch.everySec`, `watch.tailLines`, `watch.thenTask`, and `watch.runTasks=true`.
4. End with `[[task:done]]` unless blocked.

If required information is missing, do not guess critical paths or commands. Return `[[task:blocked]]` and list what is missing.

## Canonical JSON Template

```text
[[relay-actions]]
{"actions":[{"type":"job_start","command":"<non-interactive shell command>","watch":{"everySec":120,"tailLines":80,"thenTask":"Analyze final log and summarize metrics, failures, and next actions.","runTasks":true}}]}
[[/relay-actions]]
```

## Practical Rules

- Keep JSON on one line and do not include comments or trailing commas.
- Prefer launching a wrapper script, then start it with `bash /tmp/<name>.sh` or a repo-local script path.
- Ensure the command writes logs deterministically so follow-up analysis can inspect them.
- In `thenTask`, include exact log paths, run ids, and metrics to extract.
- Keep surrounding prose short to avoid drowning the action block.

## Ready-To-Use Task Text

```text
Use skill relay-long-task-callback.
Launch training in background and output exactly one [[relay-actions]] JSON block using job_start.
Set watch.everySec=120 and tailLines=80.
Set thenTask="Analyze the final training log at <LOG_PATH>, report key metrics/trends/failures, and propose next steps.".
Set runTasks=true.
End with [[task:done]].
```
