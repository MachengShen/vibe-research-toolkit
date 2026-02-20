# System Context Files

## Global Files

- Working memory: `/root/SYSTEM_SETUP_WORKING_MEMORY.md`
- Global handoff: `/root/HANDOFF_LOG.md`
- Global agent rules: `/root/AGENTS.md`

## Repo Files (when working inside a repository)

- Repo handoff: `<repo-root>/HANDOFF_LOG.md`
- Repo AGENTS instructions: `<repo-root>/AGENTS.md`

## Update Rules

1. Handoff logs are append-only. Do not rewrite prior handoff entries.
2. Working-memory files are living snapshots; compact/rewrite to keep only current high-signal state.
3. Include absolute timestamp with timezone.
4. Include exact file/run/log paths.
5. Separate observed facts from inferences.
6. For Discord STT-like text ambiguity, ask one short clarification if needed before risky actions.
