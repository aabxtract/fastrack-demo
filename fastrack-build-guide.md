# FASTRACK — GLM-5.3 Flash Build Guide

## What you're building
FASTRACK is a Node.js CLI tool + MCP server. Plain English in the terminal.
Plug in any model. Connect your tools. Describe what you want.
FASTRACK builds the workflow, runs it, fixes it, improves it.
Memory lives locally in SQLite. Exposes all commands as MCP tools.

## Rules for every GLM session
- Always output complete, runnable code. No placeholders. No "add your logic here."
- Every file must be complete top to bottom.
- Use Node.js ESM (import/export). No CommonJS.
- Never hardcode API keys. Always read from fastrack.config.json or throw an explicit error if missing.
- After each prompt, confirm what was built and what comes next.

---

## ENVIRONMENT NOTES (Windows)

- Run shell snippets (like the pre-commit hook below) in Git Bash, NOT PowerShell — heredocs and `chmod` don't work in PowerShell.
- better-sqlite3 uses native prebuilds: if `npm install` fails on it, confirm your Node version is >=18 and matches a supported release, then reinstall before reaching for build tools.
- Resolve `~` in Node with `os.homedir()` — never hardcode `C:\Users\...`.

---

## PROJECT STRUCTURE

```
fastrack/
├── bin/
│   └── fastrack.js
├── core/
│   ├── parser.js
│   ├── workflow-engine.js
│   ├── model-router.js
│   ├── memory.js
│   └── scheduler.js
├── connectors/
│   ├── github.js
│   ├── notion.js
│   └── slack.js
├── mcp/
│   └── server.js
├── .gitignore
└── package.json
```

> **State lives OUTSIDE the repo.** Config: `~/.fastrack/fastrack.config.json`. Database: `~/.fastrack/fastrack.db`. No API keys ever belong inside the project folder.

---

## SESSION 1 — Project scaffold + package.json

Paste this exactly into GLM:

```
You are building FASTRACK — a Node.js CLI tool and MCP server.
Plain English input. Model agnostic. Local SQLite memory. Tool integrations.

Build the following right now, complete and runnable:

1. package.json
- name: fastrack
- version: 0.1.0
- type: module
- bin: { "fastrack": "./bin/fastrack.js" }
- dependencies: commander, better-sqlite3, chalk, ora, inquirer, dotenv, axios, node-cron, zod, @modelcontextprotocol/sdk (latest 1.x — pin the exact version number)
- engines: node >=18

2. .gitignore
- node_modules/
- .env
- *.log
- *.db

3. ~/.fastrack/fastrack.config.json — in the user's HOME directory, NOT in the repo
Create the ~/.fastrack/ directory if it doesn't exist.
{
  "models": [],
  "activeModel": null,
  "connectors": {},
  "preferences": {
    "autoSelect": true,
    "simpleModelThreshold": 500
  }
}

4. bin/fastrack.js
- First line MUST be the shebang: #!/usr/bin/env node
- Entry point using Commander.js
- Known subcommands: init, connect, workflows, model, memory, daemon, mcp
- Plain English fallback: use program.argument('[input...]') with program.parseAsync(), and in the action handler check whether the raw input matches a known subcommand — if it doesn't, pipe the full text to the workflow engine's runOnce()
- Show a clean ASCII banner on start: FASTRACK
- Use chalk for colored output
- Use ora for loading spinners

Output all four files completely. No placeholders.
```

---

## SESSION 2 — Memory layer (SQLite)

```
Continue building FASTRACK. Build core/memory.js completely.

Use better-sqlite3 (synchronous SQLite).
Database file lives at: ~/.fastrack/fastrack.db
Create it if it doesn't exist.

Three tables:

1. workflows
- id INTEGER PRIMARY KEY AUTOINCREMENT
- name TEXT
- description TEXT
- steps TEXT (JSON stringified array)
- status TEXT (active/paused/failed)
- trigger_type TEXT (once/recurring/event)
- trigger_config TEXT (JSON)
- created_at DATETIME
- last_run DATETIME
- run_count INTEGER DEFAULT 0
- success_rate REAL DEFAULT 0

2. context
- id INTEGER PRIMARY KEY AUTOINCREMENT
- key TEXT UNIQUE
- value TEXT
- updated_at DATETIME

3. history
- id INTEGER PRIMARY KEY AUTOINCREMENT
- workflow_id INTEGER
- input TEXT
- output TEXT
- model_used TEXT
- duration INTEGER (ms)
- success INTEGER (0/1)
- error TEXT
- timestamp DATETIME

Export these functions:
- initDB() — creates tables if not exist
- saveWorkflow(workflow) — insert or update
- getWorkflow(id) — get by id
- getWorkflows() — get all
- deleteWorkflow(id)
- saveContext(key, value)
- getContext(key)
- getAllContext()
- logHistory(entry)
- getHistory(workflowId, limit)
- getSuccessRate(workflowId) — returns % from history

All functions must be complete and working.
```

---

## SESSION 3 — Model router

```
Continue building FASTRACK. Build core/model-router.js completely.

This is the model agnostic layer. It routes requests to whichever model the user configured.

Support these providers:
- openai (gpt-4o, gpt-4o-mini)
- anthropic (claude-sonnet-4-6)
- google (gemini-2.5-pro, gemini-2.5-flash)
- custom (any OpenAI-compatible endpoint)

Read config from ~/.fastrack/fastrack.config.json

Auto-selection logic:
- Estimate prompt tokens WITHOUT a tokenizer library: Math.ceil(prompt.length / 4)
- If estimated tokens < 500 AND task type is "simple" → use fastest/cheapest model available
- If task type is "complex" OR tokens >= 500 → use smartest model available
- Task types: simple (summarize, format, draft), complex (build workflow, debug, analyze, compare)

Export these functions:
- addModel(provider, apiKey, modelName) — saves to config
- setActiveModel(provider) — saves to config
- getActiveModel() — returns current model config
- callModel(prompt, options) — routes to correct provider, returns response text
- compareModels(prompt) — runs same prompt on ALL configured models, returns array of {provider, model, response, duration}
- detectTaskType(prompt) — returns "simple" or "complex"
- autoSelectModel(prompt) — picks best model based on task type

Never hardcode API keys. Read from config file.
If no model is configured, throw: Error("No model configured. Run: fastrack init")
All functions complete and working.
```

---

## SESSION 4 — Plain English parser

```
Continue building FASTRACK. Build core/parser.js completely.

This takes a plain English input string and extracts structured intent.

It calls the active model via model-router.js with a system prompt that extracts:

{
  "action": "create_workflow" | "run_workflow" | "query" | "connect_tool" | "assign_task",
  "tools_needed": ["github", "notion", "slack"],
  "trigger": {
    "type": "once" | "recurring" | "event",
    "schedule": "every morning at 9am" | null,
    "event": "on PR opened" | null
  },
  "steps": [
    { "tool": "github", "action": "list_open_prs", "params": {} },
    { "tool": "notion", "action": "create_page", "params": { "title": "PR Summary" } }
  ],
  "assignee": null | "name or role",
  "description": "human readable summary of what this workflow does"
}

Export:
- parseIntent(input) — returns structured intent object
- validateIntent(intent) — checks all required tools are connected, returns { valid: boolean, missing: [] }

Use the model to do the heavy lifting. Your job is to craft the system prompt perfectly so the model always returns valid JSON.
Strip any markdown backticks from model response before parsing.
If JSON parse fails, retry once with a stricter prompt.
If the retry also fails, throw an Error that includes the raw model response so failures are debuggable — never fail silently.
All functions complete and working.
```

---

## SESSION 5 — Connectors

```
Continue building FASTRACK. Build all three connectors completely.

Each connector reads its credentials from ~/.fastrack/fastrack.config.json
under connectors.{name}.

connectors/github.js
Credentials: { token, owner, repo }
Export:
- connect(token, owner, repo) — saves to config
- listOpenPRs() — returns array of { number, title, author, created_at, url }
- listIssues(options) — returns array of { number, title, assignee, labels, url }
- assignIssue(issueNumber, assignee)
- createComment(issueNumber, body)
- getRecentCommits(limit) — returns last N commits

connectors/notion.js
Credentials: { token, databaseId }
Export:
- connect(token, databaseId)
- createPage(title, content) — creates a new page in the database
- updatePage(pageId, content)
- queryDatabase(filter) — returns array of pages
- appendBlock(pageId, content)

connectors/slack.js
Credentials: { token, defaultChannel }
Export:
- connect(token, defaultChannel)
- sendMessage(channel, message)
- listChannels()
- getRecentMessages(channel, limit)

All functions must use axios for HTTP calls.
All functions complete and working.
If credentials missing for a connector, throw: Error("{name} not connected. Run: fastrack connect {name}")
```

---

## SESSION 6 — Workflow engine

```
Continue building FASTRACK. Build core/workflow-engine.js — the heart of the system.

This takes a parsed intent from parser.js and:
1. Builds a workflow (saves to SQLite via memory.js)
2. Executes it step by step using the right connectors
3. Verifies the output makes sense
4. Fixes itself if a step fails (retries with adjusted params, max 3 attempts)
5. Logs everything to history
6. After 3+ successful runs, analyzes history and suggests optimizations

Import: memory.js, model-router.js, all connectors

Export:
- buildWorkflow(intent) — creates workflow record, returns workflow object
- runWorkflow(workflowId, input) — executes all steps, returns result
- fixWorkflow(workflowId, error) — diagnoses failure using model, adjusts steps, retries
- improveWorkflow(workflowId) — reads history, uses model to suggest better steps, updates workflow
- runOnce(input) — parse → build → run in one call for ad-hoc commands
- listWorkflows() — returns all workflows from memory
- shareWorkflow(workflowId) — exports as JSON file to current directory
- importWorkflow(filePath) — imports from JSON file

The fix loop:
- On step failure, call model with: the failed step, the error, the full workflow context
- Model returns adjusted step params
- Retry the step with new params
- If 3 attempts all fail, mark workflow as failed and notify user

The improve loop (runs after every 3rd successful execution):
- Read last 10 history entries for this workflow
- Call model with history + current workflow steps
- Model returns optimized steps
- Ask user: "I found a way to make this faster. Apply? (y/n)"
- If yes, update workflow in SQLite
- CLI ONLY: never prompt interactively when invoked from the MCP server — interactive prompts hang MCP tool calls. From MCP, print the suggestion as part of the result instead, and let the user apply it later from the CLI.

All functions complete and working.
```

---

## SESSION 7 — Scheduler

```
Continue building FASTRACK. Build core/scheduler.js completely.

Handles recurring workflows and deadline awareness.

Use node-cron for scheduling (already in package.json dependencies).

CRITICAL lifecycle rule: node-cron timers die the instant the Node process exits.
A one-shot CLI call like `fastrack "some command"` can NOT keep schedules alive.
Recurring workflows only fire while a long-running process is alive:
- `fastrack daemon` — dedicated long-running scheduler process (see Session 9)
- `fastrack mcp start` — the MCP server also runs schedules in the background
startAll() must ONLY be called from these two long-running commands, never from one-shot CLI commands.

Export:
- scheduleWorkflow(workflowId, cronExpression) — starts recurring execution
- parseSchedule(naturalLanguage) — converts "every morning at 9am" → cron expression using model
- cancelSchedule(workflowId)
- listScheduled() — returns all active schedules
- startAll() — on FASTRACK startup, restart all active recurring workflows from SQLite
- checkDeadlines() — reads all workflows with deadline context, warns if anything is overdue

Deadline awareness:
- On every run, if workflow has Notion or GitHub connector, check for overdue items
- Overdue = created_at older than 7 days with status still open
- Log warning to terminal with chalk.yellow

All functions complete and working.
```

---

## SESSION 8 — MCP Server

```
Continue building FASTRACK. Build mcp/server.js completely.

This starts a local MCP server that exposes all FASTRACK commands as tools.
Use @modelcontextprotocol/sdk (the exact version pinned in package.json).
Use the modern McpServer class with registerTool() and zod schemas for tool inputs.
Do NOT use the legacy Server + CallToolRequestSchema pattern.
Server runs on stdio (standard MCP pattern for local tools).

Expose these MCP tools:

1. fastrack_run
   description: "Run any FASTRACK command in plain English"
   input: { command: string }
   handler: calls workflow-engine runOnce(command)

2. fastrack_workflow_list
   description: "List all saved FASTRACK workflows"
   input: {}
   handler: calls workflow-engine listWorkflows()

3. fastrack_workflow_run
   description: "Run a specific workflow by name or ID"
   input: { identifier: string }
   handler: finds workflow by name or ID, runs it

4. fastrack_workflow_share
   description: "Export a workflow as a shareable file"
   input: { identifier: string }
   handler: calls workflow-engine shareWorkflow()

5. fastrack_memory_show
   description: "Show everything FASTRACK knows about your context"
   input: {}
   handler: calls memory getAllContext() + getWorkflows()

6. fastrack_model_compare
   description: "Run a prompt on all configured models and compare outputs"
   input: { prompt: string }
   handler: calls model-router compareModels()

7. fastrack_connect
   description: "Connect a new tool to FASTRACK"
   input: { tool: string, credentials: object }
   handler: routes to correct connector's connect() function

Export:
- startMCPServer() — initializes and starts the server

On startup, the MCP server must also call scheduler startAll() so recurring workflows keep firing while the server is running.
All tools complete and working. Server must handle errors gracefully and return them as MCP error responses.
```

---

## SESSION 9 — CLI commands wiring

```
Continue building FASTRACK. Now wire everything together in bin/fastrack.js.

Implement all commands completely:

fastrack init
- Interactive setup using inquirer
- Ask: which model provider? paste API key? model name?
- Call model-router addModel() and setActiveModel()
- Ask: connect any tools now? (github/notion/slack/skip)
- For each selected tool, ask for credentials and call connector.connect()
- Show success summary
- Save everything to config

fastrack connect <tool>
- Interactive credential collection for the named tool
- Call correct connector.connect()

fastrack "plain english command"
- If input is not a known subcommand, treat as plain English
- Show spinner: "Thinking..."
- Call workflow-engine runOnce(input)
- Show result cleanly with chalk

fastrack workflows list
- Show table of all workflows: name, status, last run, success rate

fastrack workflows run <identifier>
- Resolve identifier: exact workflow ID if numeric, otherwise first exact name match
- If no match, list available workflow names and exit
- Run workflow, show result

fastrack workflows share <identifier>
- Resolve identifier same as above, export workflow, show file path

fastrack workflows import <file>
- Import workflow from file

fastrack model add
- Interactive: provider, key, model name

fastrack model use <provider>
- Set active model

fastrack model compare "<prompt>"
- Run on all models, show comparison table with duration

fastrack memory show
- Pretty print all context and workflows

fastrack memory clear
- Confirm then wipe database

fastrack daemon
- Start a dedicated long-running scheduler process:
  - Call initDB(), then scheduler startAll()
  - Print every scheduled workflow with its next run time
  - Stay alive and keep firing recurring workflows until Ctrl+C
- This is the ONLY way recurring workflows keep running after the terminal command finishes (besides fastrack mcp start)

fastrack mcp start
- Start MCP server (which also calls scheduler startAll()), show: "FASTRACK MCP server running. Add to your coding agent config."
- Show the MCP config JSON they need to paste into Claude Code / Cursor

On startup (one-shot commands like plain English, workflows, model, memory):
- Call initDB() to ensure database exists
- Do NOT call scheduler startAll() — schedules die when the process exits anyway

All commands complete and working. Clean terminal output throughout.

After building, verify from the repo root:
- Run `npm link`, then `fastrack --help` must print all commands and exit cleanly
- `fastrack "hello world test"` must reach the workflow engine — with no model configured it must fail with the explicit "No model configured. Run: fastrack init" error, not a crash or a silent hang
```

---

## SESSION 10 — README + Demo script

```
Continue building FASTRACK. Write two final files:

1. README.md
Complete documentation:
- What FASTRACK is (one paragraph)
- Install: npm install -g fastrack-cli (for development: clone the repo and run `npm link`)
- Quick start: fastrack init
- All commands with examples
- MCP setup instructions for Claude Code and Cursor
- How model agnostic works
- How memory works
- How workflow self-healing works
- How to share workflows

2. DEMO.md
Step by step demo script for the hackathon submission:
- Fresh install
- fastrack init (paste OpenAI key, connect GitHub + Notion)
- Run: fastrack "every morning summarize open PRs and add to Notion"
- Show workflow being built
- Show it scheduled
- Run: fastrack daemon (in a second terminal) to show the recurring workflow actually firing
- Run: fastrack model compare "summarize this PR list"
- Show comparison table
- Run: fastrack mcp start
- Show MCP config
- Run from Claude Code using fastrack_run tool
- Show memory: fastrack memory show

Make the README and demo script feel polished and professional.
```

---

## PRE-COMMIT GUARD

Before any session where you deploy or push. Run this in Git Bash on Windows (NOT PowerShell — heredocs and `chmod` don't work there):

```bash
cat > .git/hooks/pre-commit << 'EOF'
#!/bin/sh
if git diff --cached | grep -qE '0x[0-9a-fA-F]{64}'; then
  echo "ERROR: Possible private key detected in staged changes. Commit aborted."
  exit 1
fi
if git diff --cached | grep -qE 'sk-[a-zA-Z0-9]{20,}'; then
  echo "ERROR: Possible API key detected in staged changes. Commit aborted."
  exit 1
fi
EOF
chmod +x .git/hooks/pre-commit
```

---

## AFTER EACH SESSION

Check GLM's output against these rules:
- [ ] No hardcoded API keys anywhere
- [ ] No `|| 'fallback_value'` patterns for keys — must throw explicit errors
- [ ] All imports use ESM syntax
- [ ] All files are complete top to bottom
- [ ] No placeholder comments

If GLM outputs incomplete code, paste this:
```
The code is incomplete. Output the full file from top to bottom.
No placeholders. No "// add logic here". Complete and runnable.
```

---

## SUBMISSION CHECKLIST

- [ ] All 10 sessions complete
- [ ] npm install works clean
- [ ] fastrack init runs without errors
- [ ] fastrack "test command" works end to end
- [ ] fastrack mcp start runs
- [ ] README complete
- [ ] Demo video recorded (terminal, 60-90 seconds)
- [ ] Submitted at: cerebralvalley.ai/e/glm-5-3-flash-lightning-hackathon/hackathon/submit
- [ ] X post with demo video — tag @CerebralValley, mention GLM-5.3 Flash built this
