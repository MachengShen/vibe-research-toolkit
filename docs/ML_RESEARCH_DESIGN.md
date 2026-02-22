# ML Research Design Guide

This document explains why `VibeResearch_toolkit` is structured the way it is for advanced ML research workflows.

## Problem framing

ML research loops are usually:
- long-running
- branch-heavy
- noisy/intermediate
- hypothesis-sensitive

A tool that only does one-shot end-to-end automation underperforms here. Researchers need to inspect intermediate state, redirect quickly, and preserve continuity.

## Design goals

1. Keep the researcher in the loop.
2. Minimize dead time between run completion and interpretation.
3. Maximize information gain per experiment.
4. Preserve continuity across sessions and agents.
5. Keep operations observable and auditable.

## Core design choices

### 1) Discord as control plane
- Start, monitor, and steer work from anywhere.
- Works for both quick checks and full experimental cycles.
- Low friction improves intervention latency.

### 2) Interactive workflow primitives
- `/plan` for pre-execution reasoning.
- `/task` for controlled execution chunks.
- `/worktree` for parallel hypothesis branches.

This keeps human judgment at each decision boundary.

### 3) Relay Callback architecture
- `job_start` + `watch` + `thenTask` enables auto-follow-up analysis.
- Decouples long-running compute from synchronous chat turns.
- Reduces forgotten/stalled post-processing.

### 4) Hypothesis-driven skill composition
Bundled skills emphasize:
- one-hypothesis-at-a-time discipline
- ablations with clear discriminative criteria
- evidence-backed iteration and handoff

## Additional features that matter for researchers

### Persistent memory and handoff
- `docs/WORKING_MEMORY.md` stores current state.
- `HANDOFF_LOG.md` stores append-only chronology.

This prevents repeated context rebuilding.

### Parallelism without branch chaos
- worktrees isolate experiments, keeping diffs scoped and mergeable.

### Observability by default
- `/status`, `/task list`, `/job list`, `/job logs` expose internal state.
- relay logs and job logs provide auditable traces.

### Reproducible environment state
- machine-state export/apply scripts keep infra portable.

### Network resilience
- proxy-aware defaults and relay hardening improve reliability in constrained networks.

## Recommended high-signal operating pattern

1. Define hypothesis and success/failure signatures.
2. Plan one discriminating experiment.
3. Run with callback when long-running.
4. Analyze with explicit comparison to baseline.
5. Update memory artifacts with evidence and next branch.

## Anti-patterns to avoid

- launching large sweeps before validating instrumentation
- mixing multiple hypotheses in one experiment without decomposition
- concluding from intermediate noise without stop criteria
- failing to capture exact paths/metrics in handoff

## Checklist for publishable research ops

- explicit hypotheses and stop criteria
- reproducible run commands
- callback-based long-job completion handling
- evidence paths in every conclusion
- continuity artifacts updated after major actions
