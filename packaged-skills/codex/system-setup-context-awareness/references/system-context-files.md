# System Context Files

## Global Files

- Working memory: `/root/SYSTEM_SETUP_WORKING_MEMORY.md`
- Global handoff: `/root/HANDOFF_SUMMARY_FOR_NEXT_CODEX.txt`
- Global agent rules: `/root/AGENTS.md`

## Repo Files (when working inside a repository)

- Repo handoff: `<repo-root>/HANDOFF_SUMMARY_FOR_NEXT_CODEX.txt`
- Repo AGENTS instructions: `<repo-root>/AGENTS.md`

## Update Rules

1. Append only. Do not rewrite prior entries.
2. Include absolute timestamp with timezone.
3. Include exact file/run/log paths.
4. Separate observed facts from inferences.
5. For Discord STT-like text ambiguity, ask one short clarification if needed before risky actions.
