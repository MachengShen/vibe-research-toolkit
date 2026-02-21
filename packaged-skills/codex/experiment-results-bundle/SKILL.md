---
name: experiment-results-bundle
description: Use when an experiment cycle is complete and you need to package all results for GPT Pro (or any external reviewer) review. Reads WORKING_MEMORY + HANDOFF_LOG, collects artifacts, writes a self-contained technical summary, commits to a dated branch, pushes to remote, builds a zip, and uploads it to Discord.
version: 1.0
---

# Experiment Results Bundle

Produce a **self-contained zip bundle** for external review (GPT Pro, collaborators, future agents) after one or more experiments complete. Works with any repo that follows the standard `docs/WORKING_MEMORY.md` + `HANDOFF_LOG.md` pattern.

## When to Use

- "Package the results for GPT Pro"
- "Make a zip of everything from this experiment"
- "Prepare a handoff bundle for external review"
- "Summarize results and push to a branch"
- Any variant of "bundle / zip / package / export the results"

## Outputs (in order)

1. `GPT_PRO_HANDOFF_<YYYYMMDD>.md` — comprehensive markdown report written to repo root
2. `analysis/results-<YYYYMMDD>` git branch with the report committed and pushed to remote
3. `gpt_pro_bundle_<YYYYMMDD>.zip` — 88–200KB zip uploaded to Discord

---

## Execution Protocol

### Step 0 — Read project state

Before writing anything:

```
1. Read docs/WORKING_MEMORY.md in full.
2. Read the last 3 entries in HANDOFF_LOG.md.
3. Note: repo root, branch, latest commit, active hypotheses, key artifact paths.
```

### Step 1 — Collect artifacts

From the WORKING_MEMORY "Key Artifact Pointers" section, resolve every path that exists on disk. Also auto-scan:

- `runs/analysis/*/ablation_grid_results.csv` — ablation grid results (latest by mtime)
- `runs/analysis/swap_matrix/*/swap_matrix_results.csv` — swap matrix results (latest)
- `runs/analysis/*/*_summary.json` — any summary JSON files
- `scripts/*.py` — all experiment runner scripts (not probe scripts > 50KB unless requested)
- `research_finding*.{txt,md}` — paper notes
- `docs/WORKING_MEMORY.md`
- `HANDOFF_LOG.md`

Do NOT include: checkpoints (`.pt`, `.pth`), raw `.npz` trajectory files (too large), `__pycache__/`, `.venv*/`.

### Step 2 — Write the handoff summary

Write `GPT_PRO_HANDOFF_<YYYYMMDD>.md` to the repo root. The document MUST include these sections (adapt to project):

```markdown
# GPT Pro Handoff: <Project Name> — Experiment Results & Next Steps

**Date:** YYYY-MM-DD
**Branch:** analysis/results-YYYYMMDD
**Repo:** <GitHub URL>

## 1. Project Overview
<2-3 paragraph description of what is being built and what questions are being answered>

## 2. Key Scripts
| Purpose | Script |
...
### Required environment
<env vars, Python path, etc.>

## 3. Experiment N: <Name>
### Design
### How to run (copy-paste ready)
### Artifacts
- Run dir: ...
- Results CSV: ...
### Results (table)
### Key findings

... (one section per major experiment completed) ...

## N+1. Open Questions (ranked)
| Priority | Question | Blocking? | Resolves with |

## N+2. Recommended Next Experiments
### PRIORITY 1: <name>
<copy-paste ready bash command>

## N+3. Implementation Notes for GPT Pro
- What NOT to change
- File layout
- Architecture brief
```

**Accuracy rules:**
- All numbers must come from actual artifact files — do not paraphrase from memory.
- Every result table must be recomputed from the CSV/JSON on disk, not from WORKING_MEMORY prose.
- Mark speculative interpretations explicitly with "Hypothesis:" prefix.

### Step 3 — Commit and push to branch

```bash
# Create dated branch off current HEAD
git checkout -b analysis/results-$(date +%Y-%m-%d)

# Stage only: the handoff doc + WORKING_MEMORY + HANDOFF_LOG
git add GPT_PRO_HANDOFF_$(date +%Y%m%d).md docs/WORKING_MEMORY.md HANDOFF_LOG.md

git commit -m "docs: add GPT Pro handoff bundle $(date +%Y-%m-%d)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"

git push -u origin analysis/results-$(date +%Y-%m-%d)

# Return to original branch
git checkout -
```

If push fails (no remote, auth error), skip and note in Discord message.

### Step 4 — Build zip

Use Python stdlib (zip may not be installed):

```python
import zipfile, os, glob, datetime

date_str = datetime.date.today().strftime('%Y%m%d')
bundle_dir = f'/tmp/gpt_pro_bundle_{date_str}'
zip_path = f'gpt_pro_bundle_{date_str}.zip'

os.makedirs(bundle_dir, exist_ok=True)

# Copy all collected artifacts into bundle_dir preserving structure
# (scripts/ subdir, results/ subdir, docs at root)

with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
    for fpath in glob.glob(bundle_dir + '/**/*', recursive=True):
        if os.path.isfile(fpath):
            zf.write(fpath, fpath[len(bundle_dir)+1:])
```

Target bundle size: < 5MB. If over limit, exclude large scripts (> 100KB).

### Step 5 — Upload to Discord and update logs

In your reply:
1. Include `[[upload:gpt_pro_bundle_<YYYYMMDD>.zip]]` to attach the zip.
2. Post a short results table (3–6 rows max) directly in Discord.
3. State the remote branch URL.
4. Append one entry to `HANDOFF_LOG.md` recording the branch and bundle path.

---

## Artifact Discovery Helpers

### Find latest swap matrix CSV
```bash
python3 -c "
import glob, os
files = sorted(glob.glob('runs/analysis/swap_matrix/*/swap_matrix_results.csv'), key=os.path.getmtime)
print(files[-1] if files else 'not found')
"
```

### Find latest ablation grid CSV
```bash
python3 -c "
import glob, os
files = sorted(glob.glob('runs/analysis/ablation_grid/*/ablation_grid_results.csv'), key=os.path.getmtime)
print(files[-1] if files else 'not found')
"
```

### Compute swap matrix aggregated stats
```python
import csv, numpy as np
from collections import defaultdict

rows = list(csv.DictReader(open('<path>/swap_matrix_results.csv')))
phase2 = [r for r in rows if r['phase'] == 'learning' and r.get('success_at_256')]
agg = defaultdict(list)
for r in phase2:
    agg[(r['mode'], r['collector'], r['learner'])].append(float(r['success_at_256']))

for k, vals in sorted(agg.items(), key=lambda x: -np.mean(x[1])):
    print(f'{k[0]:10s} {k[1]:15s}→{k[2]:15s}: {np.mean(vals):.4f} ± {np.std(vals):.4f}')
```

---

## Error Handling

| Situation | Action |
|---|---|
| WORKING_MEMORY not found | Scan repo for `*.md` files, ask user to confirm project root |
| Result CSV not found | Note "artifact missing" in report; do not fabricate numbers |
| git push fails | Skip branch push; still build and upload zip |
| Bundle > 5MB | Exclude large scripts; list excluded files in report |
| zip not installed | Use Python `zipfile` stdlib (always available) |

---

## Ready-to-Use Task Text (for user)

```text
Use skill experiment-results-bundle.
Working dir: <repo root>.
1. Read docs/WORKING_MEMORY.md and last 3 HANDOFF_LOG entries to understand current state.
2. Collect all result artifacts (CSVs, JSON summaries, key scripts, paper notes).
3. Write GPT_PRO_HANDOFF_<today>.md to repo root with full experiment summaries and next-step commands.
4. Commit to branch analysis/results-<today> and push to remote.
5. Build gpt_pro_bundle_<today>.zip (<5MB) and upload to Discord.
6. Append one HANDOFF_LOG entry with branch URL and bundle path.
End with [[task:done]].
```
