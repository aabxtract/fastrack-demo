# FASTRACK — Hackathon Demo Script (60-90 seconds)

Run everything in a clean terminal. Required before recording: a Groq key in `.env` (or `fastrack init`), GitHub connected (`fastrack connect github`).

**Pacing:** leave ~5-10s between model commands — free tier is 8,000 tokens/min. The retry handles bursts, but don't stack three heavy commands back-to-back.

## 1. Fresh install + zero-config onboarding (10s)

```bash
npm link                      # (or npm install -g fastrack)
$env:GROQ_API_KEY="gsk_..."   # the ONLY setup step — no init needed
fastrack "what is 12 times 8?"       # direct answer — no workflow even built
```

## 2. The money shot — plain English to working workflow (15s)

```bash
fastrack "list my open PRs and summarize them in two sentences"
```

Show: Thinking... → `Workflow #N` built → `step 0: github.list_open_prs -> ok` → `step 1: model.generate_text -> ok` → real summary of real PRs.

## 3. Status report (15s)

```bash
fastrack report
```

Scroll: Executive summary → progress table with real PR/issue links → Risks → Next up.

Then the delivery moment (if email connected):

```bash
fastrack report --send email --to you@example.com
```

## 4. Meeting notes → workflows (15s)

```bash
fastrack note "Sync: ship the demo Friday. Ana records it. Sam reviews PR #4 tomorrow." -y
```

Show: Summary → Decisions → Action items table (assignees + dues) → `Created 3 workflow(s)`.

```bash
fastrack workflows list       # the 3 new workflows, success rates
```

## 5. The self-healing moment (10s)

```bash
fastrack "list my open PRs and summarize them"
```

If a 429 hits on camera: point at `[fastrack] rate limited — retrying in 12s (attempt 1/2)` — **"it hit the rate limit, backed off on its own, and still succeeded."** If no 429 hits naturally, don't force it — skip.

## 6. Scheduling (10s)

```bash
fastrack "every friday at 4pm generate a status report and send it to email"
fastrack workflows list       # Trigger: recurring
fastrack daemon               # second terminal — schedules actually fire while it runs
```

## 7. MCP + memory (10s)

```bash
fastrack mcp start            # show the Claude Code / Cursor config JSON it prints
fastrack memory show          # everything it knows: notes digests, reports, workflows
```

In Claude Code (pre-configured): call `fastrack_run` with "list recent commits" — one beat is enough.

## Closing line

"Everything local, model agnostic, works with your stack — plain English in, workflows out. FASTRACK."

## Shot list / checklist before recording

- [ ] Terminal font large (16-18pt), clean background, notifications off
- [ ] `fastrack memory clear` for a fresh DB if you want empty first-run tables (optional — history is also good material)
- [ ] Groq key in `.env`, GitHub connected, one test run of steps 2-4 done
- [ ] Screen recorder: 1920x1080, 60fps, capture terminal only
- [ ] 60-90s target: cut step 6 or 7 if over time
