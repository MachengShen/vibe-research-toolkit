---
name: system-setup-context-awareness
description: "Use when the task changes machine-level setup, relay/runtime behavior, bootstrap scripts, cron/systemd jobs, or cross-repo environment conventions. Read and update the system working-memory file and handoff logs, and treat Discord speech-to-text user messages as potentially noisy text that must be interpreted from exact context."
---

# System Setup Context Awareness

## Overview

Keep machine-level work consistent across sessions and agents by using the same memory files, logging discipline, and message-interpretation rules.

## Mandatory Context Files

Before making system-level changes, read:

- `/root/SYSTEM_SETUP_WORKING_MEMORY.md`
- `/root/HANDOFF_LOG.md`

If working in a repo, also read that repo's `HANDOFF_LOG.md`.

After major actions, update both:

- `/root/SYSTEM_SETUP_WORKING_MEMORY.md`
- relevant handoff log(s)

## Discord Speech-To-Text Rule

User messages may be produced via speech-to-text and can contain wording drift.

When wording seems similar but intent could differ:

- Ground interpretation in the exact latest text plus surrounding turns.
- Prefer concrete file/state evidence over assumptions.
- Ask one concise clarification when ambiguity materially affects actions.

## Required Logging Pattern

Use concise timestamped entries with:

- absolute timestamp with timezone
- objective and actions
- exact run/log paths
- current run state

Memory role reminder:
- handoff logs are append-only history
- working-memory files are living snapshots and may be compacted/re-written

## References

See `references/system-context-files.md` for path-level conventions.
