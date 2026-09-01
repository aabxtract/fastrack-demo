# FASTRACK

**Plain English in the terminal. Workflows out.**

FASTRACK is a Node.js CLI tool + MCP server. Describe what you want in plain English — FASTRACK parses your intent, builds a workflow from it, runs it against your connected tools, fixes itself when steps fail, and suggests improvements after a few successful runs.

- **Model agnostic** — Groq, OpenAI, Anthropic, Google, or any OpenAI-compatible endpoint
- **Local memory** — everything lives in SQLite at `~/.fastrack/fastrack.db`. Nothing leaves your machine except the API calls you ask for
- **Tool connectors** — GitHub, Notion, Slack, Discord, Telegram, Linear, Airtable, Jira, Email (Resend), generic Webhooks
- **Status reports** — `fastrack report` pulls activity from your tools and delivers a formatted report anywhere
- **Meeting notes → workflows** — `fastrack note` digests notes into decisions and action items, then builds workflows from them
- **Schedules** — "every morning at 9am" becomes a real cron job
- **MCP server** — all commands exposed as tools for Claude Code, Cursor, or any MCP client

## Install

```bash
npm install -g fastrack
```

For development: clone this repo and run `npm link`.

Requires Node.js >= 22.

## Quick start

**Fastest path — zero config.** Grab a free key at [console.groq.com](https://console.groq.com), then:

```bash
export GROQ_API_KEY=gsk_...        # PowerShell: $env:GROQ_API_KEY="gsk_..."
fastrack "summarize my open PRs"   # works immediately
```

Or run the interactive setup:

```bash
fastrack init
```

The interactive setup walks you through:

1. Picking a model provider and pasting your API key
2. (Optionally) connecting GitHub, Notion, or Slack

Then just talk to it:

```bash
fastrack "summarize my open PRs and add the summary to Notion"
fastrack "every morning at 9am summarize open PRs and add to Notion"
fastrack "what are the recent commits in my repo?"
```

## Commands

| Command | What it does |
| --- | --- |
| `fastrack init` | Interactive setup (model + tools) |
| `fastrack connect <tool>` | Connect `github`, `notion`, `slack`, `discord`, `telegram`, `linear`, `airtable`, `jira`, `email`, or `webhook` |
| `fastrack "..."` | Any plain English command |
| `fastrack report` | Status report from your tools (`--scope "GTM"`, `--send slack,email,notion`, `--to you@x.com`) |
| `fastrack note` | Digest meeting notes (`fastrack note "..."`, `--file notes.md`, or pipe stdin; `--yes` to auto-create workflows) |
| `fastrack workflows list` | Table of all saved workflows |
| `fastrack workflows run <id\|name>` | Run a saved workflow |
| `fastrack workflows delete <id\|name>` | Delete a saved workflow (and its history) |
| `fastrack workflows share <id\|name>` | Export a workflow as JSON |
| `fastrack workflows import <file>` | Import a workflow from JSON |
| `fastrack model add` | Add another model |
| `fastrack model use <provider>` | Switch active model |
| `fastrack model compare "<prompt>"` | Run a prompt on every configured model |
| `fastrack model list` | Show configured models |
| `fastrack memory show` | Everything FASTRACK knows |
| `fastrack memory clear` | Wipe the local database |
| `fastrack daemon` | Keep recurring workflows firing (long-running) |
| `fastrack mcp start` | Start the MCP server (stdio) |

## How model agnostic works

All model configs live in `~/.fastrack/fastrack.config.json` — never in the repo, never hardcoded. You can register multiple models and FASTRACK routes each request:

- **Groq** is first-class: pick it in `fastrack init`, or just set `GROQ_API_KEY` — no setup at all (defaults to `llama-3.3-70b-versatile`, override with `FASTRACK_MODEL`)
- **Short + simple** tasks (summarize, format, draft) go to the fastest/cheapest configured model
- **Complex** tasks (build workflow, debug, analyze) go to the smartest configured model
- `fastrack model compare "..."` runs the same prompt on all of them side by side

Custom provider? Any OpenAI-compatible endpoint works:

```bash
fastrack model add   # pick "custom", paste base URL + key + model name
```

**No model account at all?** Use the managed relay (deployed on Vercel by the project owner). It speaks the OpenAI protocol, so it plugs in as a `custom` provider:

```bash
fastrack model add
# provider: custom
# base URL: https://fastrack-relay.vercel.app/v1
# API key:  <client token issued by the owner>
# model:    openai/gpt-oss-120b
```

The relay holds the real Groq key server-side, so users never need their own provider account. See `relay/README.md` for deployment.

## How memory works

- **workflows** — every workflow you create, its steps, trigger, run count and success rate
- **context** — facts FASTRACK picks up along the way
- **history** — every run: input, output, model used, duration, errors

The database lives at `~/.fastrack/fastrack.db`. `fastrack memory clear` wipes it. That's the whole surface.

## How workflow self-healing works

When a step fails, FASTRACK:

1. Sends the failed step, the error, and the workflow context to the model
2. Gets back corrected parameters (or corrected steps)
3. Retries — up to 3 attempts
4. If all attempts fail, the workflow is marked `failed` and you see exactly which step broke

After every 3rd successful run, FASTRACK analyzes the last 10 runs and offers an optimization. On the CLI it asks `Apply? (y/n)`; over MCP it includes the suggestion in the response instead of blocking on a prompt.

## Schedules

Recurring workflows need a **long-running process** — cron timers die when a process exits:

```bash
fastrack daemon     # dedicated scheduler process
fastrack mcp start  # the MCP server also runs schedules in the background
```

A one-shot CLI call parses and runs, but it cannot keep schedules alive by itself.

## How to share workflows

```bash
fastrack workflows share 3        # writes fastrack-workflow-3.json to the current directory
fastrack workflows import fastrack-workflow-3.json
```

Shared files contain the workflow definition only — never your credentials.

## MCP setup

Add to your Claude Code / Cursor MCP config:

```json
{
  "mcpServers": {
    "fastrack": {
      "command": "fastrack",
      "args": ["mcp", "start"]
    }
  }
}
```

You then get these tools: `fastrack_run`, `fastrack_workflow_list`, `fastrack_workflow_run`, `fastrack_workflow_share`, `fastrack_memory_show`, `fastrack_model_compare`, `fastrack_connect`, `fastrack_report`, `fastrack_note`.

## Configuration

Everything lives in `~/.fastrack/fastrack.config.json`:

```json
{
  "models": [{ "provider": "openai", "apiKey": "...", "model": "gpt-4o-mini" }],
  "activeModel": "openai",
  "connectors": { "github": { "token": "...", "owner": "...", "repo": "..." } },
  "preferences": { "autoSelect": true, "simpleModelThreshold": 500 }
}
```

This file holds API keys — it lives in your home directory, outside any git repo. `fastrack.config.json` is never created inside the project.

## Testing

```bash
npm test
```

The suite runs fully offline: a fake OpenAI-compatible model server (`test/helpers/fake-model.js`) stands in for the LLM, and `FASTRACK_HOME` redirects all state (config + SQLite) to a temp directory, so your real `~/.fastrack` is never touched.

## License

MIT
