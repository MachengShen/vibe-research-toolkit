---
name: ml-ablation-five-step-loop
description: "Use when running multi-phase ML ablation studies with monitor-gated intermediate decisions (sanity check, phase ablations, reflection summary) and adaptive redesign between phases. Best for overnight or long-running investigations where sample efficiency or hyperparameter sensitivity is the target."
---

# ML Ablation Five-Step Monitor Loop

Use this skill for structured ablation campaigns where runs must be monitored continuously and the next phase redesigned based on intermediate results.

## Philosophy (MARR)
- **Monitor**: log intermediate checkpoints while jobs run.
- **Assess**: test whether metrics are internally consistent and meaningful.
- **Reflect**: interpret whether patterns make algorithmic sense.
- **Redesign**: adjust the next phase only when evidence justifies it.

## When to Apply
- User asks for long runs with intermediate decisions.
- Need to test hyperparameters under a fixed compute budget.
- Need multi-phase ablation with safeguards against script/config mistakes.

## Standard 5-Step Protocol
1. **Sanity gate**: short run; verify required metric columns exist in logs before committing to longer runs.
2. **Phase A**: first ablation dimension (e.g. cadence, batch size, learning rate schedule).
3. **Phase B**: second ablation dimension around the best Phase-A setting.
4. **Phase C**: third ablation dimension (e.g. a key algorithm hyperparameter) under the chosen Phase-A/B settings.
5. **Reflection summary**: rank all runs by the primary success metric; preserve artifacts and write conclusions.

## Launch
Use the project's background launcher (adapt path to project):
```bash
nohup bash /path/to/project/scripts/overnight_driver.sh \
  > /path/to/runs/five_step_$(date +%Y%m%d-%H%M%S).log 2>&1 &
echo "Driver PID: $!"
```

## Monitor During Run
Poll the driver log for phase transitions and metric summaries:
```bash
tail -f /path/to/runs/five_step_<timestamp>.log
```

Check metric integrity on a completed run directory:
```bash
# Verify expected CSV columns exist
head -1 /path/to/run/metrics.csv
```

## Guardrails
- **Stop if sanity columns are missing** — indicates a config mismatch or misimplementation.
- **Flag non-monotonic metrics** (e.g. short-horizon success > long-horizon success) as a diagnostic warning requiring investigation before proceeding.
- Keep one source-of-truth summary file (e.g. `five_step_summary.csv`) in the run root; update it after each phase.

## Output Style
1. Report phase, current run, and key metrics first.
2. State decision (`proceed to next phase`, `rerun`, `stop`) and why.
3. Give exact next command or config change.
4. Keep summaries compact; only include deltas since last checkpoint.
