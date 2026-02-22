# Repository Rename and Migration Guide

Target name: `VibeResearch_toolkit`

Use this guide to migrate safely from the previous repo identity.

## 1) Rename the GitHub repository

In GitHub UI:
1. Open repository settings.
2. Rename repository to `VibeResearch_toolkit`.
3. Save and verify redirects.

Expected new URL:
- `https://github.com/MachengShen/VibeResearch_toolkit`

## 2) Update local git remote

```bash
git remote set-url origin https://github.com/MachengShen/VibeResearch_toolkit.git
git remote -v
```

## 3) Optional: rename local directory

If you want path consistency:

```bash
cd /root
mv openclaw-codex-discord-skills-kit VibeResearch_toolkit
cd /root/VibeResearch_toolkit
```

## 4) Update path-dependent settings

Review and adjust:
- `OPENCLAW_KIT_AUTOUPDATE_REPO_DIR` in env/config files
- systemd/cron references if they hardcode old repo path
- any automation scripts in external repos or shell history

## 5) Reinstall or refresh managed scripts

After rename/path updates:

```bash
sudo ./bootstrap.sh --no-global-context
```

(Use additional flags as needed for your setup.)

## 6) Verify end-to-end

```bash
bash scripts/lint_repo.sh
codex-discord-relayctl status
codex-discord-relayctl logs
```

In Discord:
- `/status`
- `/job list`
- `/task list`

## 7) Rollback (if needed)

If any path-dependent automation fails:
1. temporarily point `OPENCLAW_KIT_AUTOUPDATE_REPO_DIR` back to the old path
2. rerun bootstrap to reinstall scripts
3. fix hardcoded paths incrementally
