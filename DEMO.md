# FASTRACK — Hackathon Demo Script (60-90 seconds)

Run everything in a clean terminal. Have a GitHub repo with open PRs, a Notion database, and an OpenAI API key ready before recording.

## 1. Fresh install (5s)

```bash
npm install -g fastrack   # or: npm link (dev)
fastrack --help
```

## 2. Setup (15s)

```bash
fastrack init
```

- Model provider: `groq` (recommended - free & fast)
- Paste Groq API key (mask on) — get one free at console.groq.com
- Model name: `llama-3.3-70b-versatile` (default)
- Connect tools: `github` + `notion`
- Paste GitHub token, owner, repo
- Paste Notion token + database ID

> Alternative onboarding to mention: "or just set GROQ_API_KEY and skip init entirely."

## 3. The money shot — plain English to working workflow (20s)

```bash
fastrack "every morning summarize open PRs and add to Notion"
```

Show:

- Spinner: "Thinking..."
- The parsed workflow being built (name, steps: `github.list_open_prs` → `model.generate_text` → `notion.create_page`)
- The result printed

## 4. Show it's scheduled (10s)

```bash
fastrack workflows list
```

Point at `Trigger: recurring` and the schedule.

Open a **second terminal**:

```bash
fastrack daemon
```

Show the scheduled workflow with its cron expression. Explain: recurring workflows run while the daemon (or MCP server) is alive.

## 5. Model comparison (15s)

```bash
fastrack model add          # add a second model, e.g. google/gemini-2.5-flash
fastrack model compare "summarize this PR list"
```

Show the comparison table: provider, model, duration, response preview.

## 6. MCP — give it to Claude Code (15s)

```bash
fastrack mcp start
```

Show the config JSON it prints, then paste it into Claude Code / Cursor config:

```json
{
  "mcpServers": {
    "fastrack": { "command": "fastrack", "args": ["mcp", "start"] }
  }
}
```

In Claude Code, call the `fastrack_run` tool with: `"list recent commits and post them to slack #dev"`.

## 7. Memory (5s)

```bash
fastrack memory show
```

Show stored context + the workflow with its success rate.

## Closing line

"Everything local, model agnostic, MCP native. FASTRACK — plain English in, workflows out."
