---
name: delegate-coding-tasks
description: Delegates coding tasks and tool design to a specialized coding agent (e.g., Codex) to leverage their capabilities and optimize token usage for the main agent.
version: 1.0
---

# Delegate Coding Tasks

You are designed to orchestrate, not to hand-code complex solutions or design tools yourself. When a user asks you to write code, implement a script, design a customized tool, debug existing code, refactor existing code, or perform any task that primarily involves code generation, modification, or architectural design for software components:

**ALWAYS delegate this task to a specialized coding agent.**

## How to Delegate

1.  **Identify the target directory:** Determine the most appropriate working directory for the coding task. If it's a new project or scratch work, consider creating a temporary directory and initializing a git repo if the coding agent (like Codex) requires it. If no specific directory is provided, consider `/tmp/coding_task_<timestamp>` or a relevant project subdirectory.
2.  **Formulate a clear prompt:** Describe the coding task precisely for the coding agent. Include all requirements, constraints, and expected outputs.
3.  **Spawn a `coding-agent` session:** Use the `sessions_spawn` tool to start a new sub-agent session with the `coding-agent`.

    *   **Crucial parameters for `sessions_spawn`:**
        *   `agentId: "coding-agent"` (This is the name of the skill that wraps various coding agents. OpenClaw will route to an available coding tool.)
        *   `task:` Construct a `bash` command that includes `pty:true`, an appropriate `workdir`, and the `codex exec` (or equivalent for other agents) command with your detailed prompt.
        *   **Crucially, append the `openclaw system event` command** to the coding agent's prompt to ensure you receive an immediate notification upon its completion.
        *   `model: "google/gemini-2.5-flash"` (or a specific coding-optimized model if configured for the `coding-agent` itself).
        *   `cleanup: "delete"` (unless the output needs to be reviewed manually later)
        *   `label: "coding-task-<short-description>"` (for easy identification in session lists)

## Example Delegation:

If a user asks: "Write a Python script to fetch data from a public API and save it to a JSON file."

You would respond by delegating, with a tool call similar to this (adjusting `workdir` and the `codex exec` command as needed):

```python
print(default_api.sessions_spawn(
    agentId="coding-agent",
    task='''exec bash pty:true workdir:./new_project command:"codex exec 'Write a Python script named `fetch_api_data.py` that fetches data from `https://api.example.com/data` and saves it to `data.json`. Include error handling and proper Python conventions.\n\nWhen completely finished, run: openclaw system event --text \'Done: Python script to fetch and save API data created.\' --mode now\'"''',
    label="fetch-api-script",
    cleanup="delete" # Or "keep" if you want to review the session after
))
```

## Self-Correction / Avoidance:

*   If a user asks for code, do **NOT** attempt to write the code directly in your response.
*   Do **NOT** use `exec` directly to run `python`, `node`, `git`, etc., to generate code for the user as part of the primary response to a coding task, unless it's for internal setup/testing that's not part of the *solution* to the user's coding request. Your primary role for coding tasks is orchestration via delegation.
*   Refer to this skill whenever a coding-related trigger is identified.
