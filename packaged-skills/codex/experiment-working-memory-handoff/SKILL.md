---
name: experiment-working-memory-handoff
description: Use for iterative experiments/investigations where continuity matters across turns/sessions. Maintain a compact living WORKING_MEMORY snapshot plus an append-only HANDOFF_LOG, updated with evidence-backed results and runnable next steps after every meaningful change.
version: 2.2
---

# Experiment Working Memory + Handoff

## Purpose

Maintain **two artifacts with distinct roles**:

| File | Role | Write mode |
|---|---|---|
| `docs/WORKING_MEMORY.md` | **Living snapshot** of current state (dashboard) | **Overwrite / compact** |
| `HANDOFF_LOG.md` | **Audit trail** for continuity across agents/sessions | **Append only** |

**Never duplicate narrative blocks between them.**
- WORKING_MEMORY answers: "What is true right now, what should we do next, and where is the evidence?"
- HANDOFF_LOG answers: "What happened, in what order, with what commands, producing which artifacts?"

## When to Use
- Multi-turn ablations/sweeps/training investigations.
- Any workflow likely to resume hours/days later (different agent or same).
- Any investigation where evidence gets re-litigated, or where "what did we run?" keeps coming up.

## Standard Artifacts
Default locations:
- Working memory: `docs/WORKING_MEMORY.md` (repo root; create if missing)
- Handoff log: `HANDOFF_LOG.md` (repo root; create if missing)

If the project already uses different canonical files, use those paths and record the mapping in WORKING_MEMORY.

---

## Core Invariants

1) **WORKING_MEMORY is NOT append-only.** It is a compact snapshot.
2) **HANDOFF_LOG is append-only.** Never rewrite prior entries.
3) **Reproducibility beats prose.**
   - Every experiment entry includes runnable commands (code fences), expected outputs, and artifact paths.
4) **Separate observed results vs interpretation.**
5) **Stable IDs link everything**:
   - `run_id` (experiment run), `job_id` (relay /job), `task_id` (relay /task), `commit` (git) where applicable.

---

## Required Workflow (every meaningful step)

1) **Read first**
   - Read WORKING_MEMORY (full).
   - Read the last ~50 lines of HANDOFF_LOG (or the last 1–2 entries).

2) **Extract the current state**
   - Active hypothesis/hypotheses.
   - Current best-known result and its evidence.
   - Next experiment (runnable command + expected outputs).
   - Any running jobs (job_id) or pending tasks (task queue).

3) **Do the work**
   - Run checks/experiments, gather evidence, and locate output artifacts.

4) **Append HANDOFF_LOG entry (always)**
   - One new timestamped entry following the template below.
   - Include command(s) run and artifact paths.
   - Include run_id / job_id / task_id if available.

5) **Rewrite WORKING_MEMORY (always)**
   - Update it **in place** to reflect the new current state.
   - Keep it compact (target ≤150 lines; hard cap ≤200).
   - Move superseded details to HANDOFF_LOG (one-line reference is enough).

6) **Sync check**
   - WORKING_MEMORY must not contain a trail of timestamped "log blocks".
   - If it does, migrate those blocks into HANDOFF_LOG (as a single condensed entry) and remove them from WORKING_MEMORY.

---

## WORKING_MEMORY Required Sections (schema)

> Goal: a new agent should understand the project in <2 minutes.

```markdown
# <Project Name> Working Memory (living snapshot)

Last updated: 2026-02-20T20:13:48+08:00
Repo: /abs/path/to/repo
Branch: master
Commit: b9cdd15  (dirty: no)   # dirty = git status --porcelain non-empty
Owner: <optional human/team>

## Objective
- One paragraph. What are we trying to prove/build?

## Active Hypotheses (max 3)
- H1 (active): <one falsifiable sentence>
  - Status: untested | inconclusive | supported | weakened | falsified
  - Evidence FOR: <metric + n + condition> — <artifact path>
  - Evidence AGAINST: <metric + n + condition> — <artifact path>
  - Next discriminating test (one line): <what would change status?>

## Required Environment (minimal, no secrets)
- Runbook: scripts/env.sh  (preferred)
```bash
source scripts/env.sh
PYTHON=.venv/bin/python
# Only include overrides here; keep boilerplate in runbook.
```

## Current Best Result (non-smoke only)
- Metric: <name>=<value> ± <std>  (n=<seeds/trials>, condition=<eval setup>)
- Artifact: <path to metrics.csv/json/plot>
- Commit: <hash>
- Notes: <one line>

## Running / Active Jobs (if any)
- job_id: j-... — run_id: r-... — started: <ISO> — log: <path> — watch: on/off

## Next Experiment (runnable)
```bash
# One-line intent: what this tests
$PYTHON path/to/script.py --flags ...
```
Expected outputs:
- <path 1>
- <path 2>

Quick verification:
```bash
# fast check that the run succeeded
ls -lh <expected file> && jq '.primary_metric' <metrics.json>
```

## Open Questions (ranked by blocking priority)
1. <question> — blocking: yes/no — resolves with: <script/metric>

## Key Artifact Pointers (optional but recommended)
- BEST_RUN_PATH: exp/results/BEST_RUN_PATH.txt
- LAST_RUN_PATH: exp/results/LAST_RUN_PATH.txt
- Registry: exp/registry.jsonl
- Report: writing/REPORT.md
```

**Rules**
- WORKING_MEMORY may reference HANDOFF_LOG entries by timestamp/run_id, but must not copy full entries.
- Keep hypotheses short and falsifiable.
- "Current Best Result" must include `n` and evaluation condition, and must not be a smoke test.

---

## HANDOFF_LOG Entry Template (append-only)

### Timestamp format
Canonical for new entries:
- `YYYY-MM-DDTHH:MM:SS±HH:MM` (explicit offset, no milliseconds)

If you encounter `Z` or milliseconds in older entries:
- do **not** rewrite history; only ensure new entries follow the canonical format.
- if generating a new timestamp from a `Z` source, normalize `Z` → `+00:00` and drop ms.

### Template

```markdown
## 2026-02-20T20:13:48+08:00
<!-- meta: {"type":"experiment","run_id":"r-20260220-001","job_id":"j-abc123","task_id":"t-0007","commit":"b9cdd15","dirty":false} -->

### Scope
One line: what changed / what was attempted.

### Repo state
- Path: /abs/path/to/repo
- Branch: master
- Commit: b9cdd15 (dirty: no)

### Hypothesis tested
- H1: <exact falsifiable sentence>   # or "N/A — infra/code"

### Exact command(s) run
```bash
source scripts/env.sh
$PYTHON path/to/script.py --flags ...
```

### Output artifacts
- exp/results/r-20260220-001/metrics.json
- exp/results/r-20260220-001/stdout.log
- exp/results/r-20260220-001/plot.png

### Results (observed)
- primary_metric (n=5, condition=...): 0.42 ± 0.03
- secondary: ...

### Interpretation
- What the results suggest (and what they do NOT prove).

### Decision
- What we will do next and why (ties back to hypotheses).

### Next step (runnable)
```bash
$PYTHON path/to/next_script.py --flags ...
```

### Notes / caveats (optional)
- smoke only — not for paper use
- metric caveat: ...
```

**Rules**
- Commands must be inside code fences.
- Always include `n` and evaluation condition for numeric results.
- Keep "Interpretation" separate from "Results (observed)".
- If no commands were run, omit that section and explain why.

---

## Evidence Rules (non-negotiable)
- Prefer file-based evidence over memory.
- Provide exact paths (and line refs where useful).
- Never claim improvement without a fresh metric or check.
- Always state denominator/sample count when interpreting metrics.
- Mark preliminary results explicitly ("smoke only").

---

## Guardrails & Caveats
- **Concurrency**: If multiple agents may update these files, only the designated manager/writer should write WORKING_MEMORY/HANDOFF_LOG. Others should propose changes in chat.
- **Overwriting WORKING_MEMORY** can lose nuance. Always append HANDOFF_LOG first; optionally archive old WM to `memory/archive/` before compaction.
- **Secrets**: Never write tokens/keys into either file. Keep env blocks minimal and non-sensitive.
- **Artifact rot**: Prefer stable pointers (`BEST_RUN_PATH.txt`, `LAST_RUN_PATH.txt`) so evidence links don't break.

---

## Sync Check (run before writing)
Before finishing a turn, confirm:
- WORKING_MEMORY is ≤200 lines and contains no timestamped log blocks.
- WORKING_MEMORY has: Active hypotheses, Best result, Next experiment (runnable).
- HANDOFF_LOG got exactly one new entry for this step.
- New HANDOFF_LOG entry includes artifact paths and reproducible commands (if any).
- If a commit happened, it is recorded and WORKING_MEMORY header updated.
