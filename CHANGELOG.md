# Changelog

All notable changes to `VibeResearch_toolkit` are documented in this file.

## [1.0.0] - 2026-02-22

### Added
- Stable researcher-facing documentation set:
  - `README.md` reworked for ML research adoption
  - `docs/USER_MANUAL.md` operational manual
  - `docs/ML_RESEARCH_DESIGN.md` design rationale
  - `docs/REPO_RENAME_AND_MIGRATION.md` migration playbook
- CI lint workflow at `.github/workflows/ci.yml`.
- Repository lint gate improvements in `scripts/lint_repo.sh`:
  - shell syntax checks across repository scripts
  - shebang/strict-mode invariants
  - CRLF checks for `.sh`/`.js`
  - packaged skill metadata checks

### Changed
- Rebrand direction from `openclaw-codex-discord-skills-kit` to `VibeResearch_toolkit`.
- Path defaults/templates now prefer `/root/VibeResearch_toolkit` with legacy fallback support.
- `bootstrap.sh` and `scripts/apply_local_state.sh` now allow `--help` without root.

### Research-focused highlights
- Worktree-based parallel ablations.
- Persistent research memory + append-only handoff.
- Observability via `/status`, `/task`, `/job`.
- Reproducible machine-state export/apply.
- Proxy-aware operation and reliability hardening.

### Notes
- OpenClaw optional install may fail under Node 24 in some environments due native dependency build constraints; relay and toolkit workflows remain operational.
