# Contributing

Thanks for contributing to `vibe-research-toolkit`.

## Development setup

1. Clone the repository and enter it:

```bash
git clone https://github.com/MachengShen/vibe-research-toolkit.git
cd vibe-research-toolkit
```

2. Run the repository lint checks:

```bash
bash scripts/lint_repo.sh
```

3. For relay-only local development (no root required):

```bash
cd codex-discord-relay
npm install
node relay.js
```

4. For full machine bootstrap (requires root):

```bash
sudo ./bootstrap.sh
```

## Pull request guidelines

- Keep changes focused and scoped to one concern.
- Add/update docs when behavior or defaults change.
- Run `bash scripts/lint_repo.sh` before opening a PR.
- Include verification evidence in the PR description.

## Adding or updating packaged skills

Packaged skills live in `packaged-skills/codex/<skill-name>/SKILL.md`.

Requirements for each skill:
- YAML frontmatter delimited by `---` on separate lines
- required fields: `name`, `description`, `version`
- clear, executable instructions

After changes, run:

```bash
bash scripts/lint_repo.sh
```

## Commit style

- Prefer imperative subject lines (example: `docs: add release troubleshooting notes`).
- Keep unrelated cleanup in separate commits.
