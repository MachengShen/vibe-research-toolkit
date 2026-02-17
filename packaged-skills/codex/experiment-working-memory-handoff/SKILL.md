---
name: experiment-working-memory-handoff
description: Use when running iterative experiments or investigations where continuity matters across turns/sessions; maintain a persistent working-memory document plus handoff log, and update both with evidence-backed findings after every meaningful step.
---

# Experiment Working Memory + Handoff

## Purpose
Keep investigation continuity high and avoid repeated mistakes by maintaining two artifacts:
- A focused **working-memory document** for current hypothesis tracking.
- A chronological **handoff log** for cross-agent/session continuity.

## When to Use
- Multi-turn debugging, ablations, or training investigations.
- Any workflow where the user may ask follow-up questions hours or days later.
- Any case with repeated confusion about prior evidence or conclusions.

## Standard Artifacts
- Working memory: `docs/WORKING_MEMORY.md` (create at repo root if missing)
- Handoff log: `HANDOFF_LOG.md` (create at repo root if missing)

If the project already has equivalent files under different names, use those instead and note the paths clearly.

## Required Workflow Per Turn
1. Read existing working memory and the last 20 lines of the handoff log first.
2. Extract: current hypothesis, known evidence, unresolved items.
3. Execute the requested checks/experiments.
4. **Update working memory** with a new timestamped block (append only — never overwrite).
5. **Append** a concise timestamped entry to the handoff log.

## Working Memory Block Template
```markdown
## YYYY-MM-DD HH:MM TZ
### User question
- ...

### Evidence inspected
- path/to/file: what you found
- metric/artifact: value or observation

### Conclusions
- ...

### Open items
- ...
```

## Handoff Log Entry Template
```markdown
## YYYY-MM-DD HH:MM TZ
- **Changed**: ...
- **Evidence**: path/to/file or metric
- **Next step**: what the next agent/session should do
```

## Evidence Rules
- Prefer file-based evidence over memory.
- Include exact paths and (when useful) line references.
- Separate observed fact from inference explicitly.
- If metric granularity limits interpretation, state denominator/sample count.

## Guardrails
- Never claim improvement without a fresh metric or check.
- Never overwrite prior entries; append only.
- If repository context is ambiguous, state which project path you are using.
