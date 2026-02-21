---
name: tavily-search
description: "Use Tavily Search API for web lookups with citations and concise summaries."
metadata: {"openclaw":{"requires":{"env":["TAVILY_API_KEY"],"bins":["python3"]},"primaryEnv":"TAVILY_API_KEY"}}
---

# Tavily Search

Use this skill when the user asks for web search, fresh information, or source-backed answers.

This skill does not use OpenClaw's built-in `web_search` tool.
Do not call `web_search` for Tavily requests.
Always run the Tavily script via `exec`.

## Command

```bash
python3 {baseDir}/scripts/tavily_search.py --query "<query>" --max-results 5
```

## Examples

```bash
python3 {baseDir}/scripts/tavily_search.py --query "latest Gemini 2.5 pricing" --max-results 5
python3 {baseDir}/scripts/tavily_search.py --query "Discord bot token intents message content" --max-results 8 --search-depth advanced
```

## Output

- Returns JSON with:
  - `answer`: Tavily synthesized answer when available
  - `results`: list of source entries (`title`, `url`, `content`, `score`)
  - `response_time`: Tavily response latency

## Required Behavior

- For Tavily searches:
  - run the command above with `exec`
  - parse returned JSON
  - cite URLs from `results[*].url`
- If the command fails:
  - report the exact stderr briefly
  - do not claim Brave or built-in `web_search` errors unless the script itself reports them

## Notes

- Requires `TAVILY_API_KEY` in skill config.
- Uses standard network env vars automatically (`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`).
