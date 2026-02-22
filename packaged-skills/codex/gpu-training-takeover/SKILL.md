---
name: gpu-training-takeover
description: "Use when inheriting an in-flight GPU training experiment stream: snapshot state, validate launch assumptions, monitor with appropriate cadence, make one-hypothesis-at-a-time decisions, and log concise handoff updates."
version: 1.0
---

# GPU Training Takeover

## Overview
Follow this skill when taking over ongoing ML training work mid-stream. Avoids common launch/monitoring mistakes and keeps handoff logs concise but complete.

## Takeover Workflow
1. **Snapshot state.**
   - Check GPU utilization, active training processes, queued jobs, git status, and latest epoch metrics.
   - Record exact log paths and queue output paths before making any decisions.
2. **Validate launch assumptions.**
   - Ensure any `resume_from` checkpoint exists before launching.
   - Confirm working directory and config paths (absolute vs. relative) are correct for this project.
3. **Launch through the project's queue gate.**
   - Use whatever job queue/lock wrapper the project provides with an explicit job name and timeout.
   - In this toolkit, prefer `scripts/gpu_gate.sh -n <job_name> -t <timeout> -- <command...>`.
   - Use absolute config and Python paths.
4. **Monitor with cadence matched to run length.**
   - Startup/resume: check every 5–20 epochs.
   - Very long runs (≥1000 epochs): check every 100 epochs unless instability appears.
5. **Decide using one explicit hypothesis at a time.**
   - Keep one active run and at least one queued follow-up when the user wants non-idle GPU.
6. **Log concise handoff updates.**
   - Append one compact block per major action (launch, failure, stop/go decision, commit).

## GPU Quick Status
```bash
nvidia-smi --query-gpu=index,utilization.gpu,memory.used,memory.total \
  --format=csv,noheader,nounits
pgrep -af 'train|queue' || true
```

## Output Style
1. Start with latest epoch / loss / acc / key metrics and run state.
2. State decision (`continue`, `stop`, `branch`) and why.
3. Give exact next command, config path, or log path.
4. Keep updates short; include only changes since last checkpoint.
