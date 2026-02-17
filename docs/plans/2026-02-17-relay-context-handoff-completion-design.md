# Relay Context Handoff Completion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete and verify the Discord relay context/workdir upgrades from handoff, and fix any implementation gaps that block acceptance criteria.

**Architecture:** Keep current relay structure and patch only correctness gaps. Validate with static checks plus focused runtime smoke checks using existing multi-instance tooling. Preserve backward compatibility for single-file context config.

**Tech Stack:** Node.js (discord.js relay), Bash install/bootstrap scripts, env-file configuration.

---

### Task 1: Audit current implementation vs spec

**Files:**
- Read: `codex-discord-relay/relay.js`
- Read: `codex-discord-relay/README.md`
- Read: `config/setup.env.example`
- Read: `scripts/install_codex_discord_relay.sh`
- Read: `scripts/init_repo_memory.sh`

**Steps:**
1. Map each acceptance criterion to existing code.
2. Identify concrete mismatches/bugs only.
3. Record root-cause notes in handoff log.

### Task 2: Patch relay correctness gaps

**Files:**
- Modify: `codex-discord-relay/relay.js`

**Steps:**
1. Fix context truncation semantics for `tail:` and `headtail:` so tail keeps newest content and markers fit budget.
2. Keep `RELAY_CONTEXT_MAX_CHARS` + `RELAY_CONTEXT_MAX_CHARS_PER_FILE` hard limits.
3. Preserve backward compatibility for old single absolute `RELAY_CONTEXT_FILE` values.

### Task 3: Validate docs/template alignment

**Files:**
- Modify if needed: `codex-discord-relay/README.md`
- Modify if needed: `config/setup.env.example`
- Modify if needed: `scripts/install_codex_discord_relay.sh`

**Steps:**
1. Ensure docs and default env values match final runtime behavior.
2. Ensure `/context` and `/context reload` are documented.

### Task 4: Verify and summarize

**Files:**
- Verify: `codex-discord-relay/relay.js`
- Verify: `scripts/init_repo_memory.sh`

**Steps:**
1. Run `node --check codex-discord-relay/relay.js`.
2. Run `bash -n scripts/install_codex_discord_relay.sh` and `bash -n scripts/init_repo_memory.sh`.
3. Run a small functional smoke check for context modes with controlled env/spec values if feasible.
4. Append major-action + task-end entries in `HANDOFF_SUMMARY_FOR_NEXT_CODEX.txt`.
