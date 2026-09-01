import { callModel, loadConfig } from './model-router.js';

export const KNOWN_TOOLS = ['github', 'notion', 'slack', 'discord', 'telegram', 'linear', 'airtable', 'jira', 'webhook'];
export const KNOWN_ACTIONS = ['create_workflow', 'run_workflow', 'query', 'connect_tool', 'assign_task'];

const SYSTEM_PROMPT = `You are FASTRACK's intent parser. You convert a user's plain English request into a strict JSON object.

Respond with ONLY the JSON object. No markdown, no code fences, no explanation, no commentary before or after.

Use EXACTLY this schema:
{
  "action": "create_workflow" | "run_workflow" | "query" | "connect_tool" | "assign_task",
  "tools_needed": ["github" | "notion" | "slack" | "discord" | "telegram" | "linear" | "airtable" | "jira" | "webhook"],
  "trigger": {
    "type": "once" | "recurring" | "event",
    "schedule": string | null,
    "event": string | null
  },
  "steps": [
    { "tool": "github" | "notion" | "slack" | "discord" | "telegram" | "linear" | "airtable" | "jira" | "webhook" | "model", "action": string, "params": object }
  ],
  "assignee": null | "name or role",
  "description": "human readable summary of what this workflow does"
}

Rules:
- "tools_needed" must only contain: github, notion, slack, discord, telegram, linear, airtable, jira, webhook. Use [] if no tool is involved. Do NOT include "model" in tools_needed.
- Every entry in "steps" must have tool, action and params.
- When the request needs text generation between tool steps (summarizing, drafting, rewriting data), add a step with tool "model", action "generate_text", and params { "prompt": "instruction, may reference {{previous}}" }.
- If the user mentions a schedule like "every morning at 9am", use trigger.type "recurring" and put the schedule phrase in trigger.schedule verbatim.
- If the user says "when X happens" or "on X", use trigger.type "event" and put the event phrase in trigger.event.
- Otherwise use trigger.type "once" with schedule and event as null.
- "description" is one human readable sentence summarizing what the workflow does.
- Output valid JSON only. Any text outside the JSON is a failure.`;

const STRICT_RETRY_PROMPT = `Your previous answer was not valid JSON.

Return ONLY a single valid JSON object matching the schema below. No markdown fences, no prose, nothing before or after the JSON. Escape all quotes inside strings properly.

{
  "action": "create_workflow" | "run_workflow" | "query" | "connect_tool" | "assign_task",
  "tools_needed": ["github" | "notion" | "slack"],
  "trigger": { "type": "once" | "recurring" | "event", "schedule": string | null, "event": string | null },
  "steps": [{ "tool": "github" | "notion" | "slack", "action": string, "params": object }],
  "assignee": string | null,
  "description": string
}`;

function stripMarkdownFences(text) {
  return String(text)
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

function extractJSON(text) {
  const cleaned = stripMarkdownFences(text);
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in model response');
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

function normalizeIntent(intent) {
  const validTools = intent.tools_needed
    ? intent.tools_needed.filter((tool) => KNOWN_TOOLS.includes(tool))
    : [];

  const trigger = {
    type: ['once', 'recurring', 'event'].includes(intent.trigger?.type)
      ? intent.trigger.type
      : 'once',
    schedule: intent.trigger?.schedule ?? null,
    event: intent.trigger?.event ?? null
  };

  const steps = Array.isArray(intent.steps)
    ? intent.steps
        .filter((step) => step && (KNOWN_TOOLS.includes(step.tool) || step.tool === 'model'))
        .map((step) => ({
          tool: step.tool,
          action: step.action,
          params: step.params ?? {}
        }))
    : [];

  return {
    action: KNOWN_ACTIONS.includes(intent.action) ? intent.action : 'create_workflow',
    tools_needed: [...new Set([...validTools, ...steps.map((step) => step.tool).filter((tool) => tool !== 'model')])],
    trigger,
    steps,
    assignee: intent.assignee ?? null,
    description: intent.description ?? 'User workflow'
  };
}

export async function parseIntent(input) {
  const raw = String(input).trim();
  if (!raw) {
    throw new Error('Cannot parse an empty command');
  }

  let response;
  try {
    response = await callModel(raw, { system: SYSTEM_PROMPT, temperature: 0.1 });
  } catch (err) {
    if (err.message.startsWith('No model configured')) throw err;
    throw new Error(`Model call failed while parsing intent: ${err.message}`);
  }

  try {
    return normalizeIntent(extractJSON(response));
  } catch {
    // First parse failed — retry once with the stricter prompt
  }

  let retryResponse;
  try {
    retryResponse = await callModel(
      `Original request: ${raw}\n\n${STRICT_RETRY_PROMPT}`,
      { system: SYSTEM_PROMPT, temperature: 0 }
    );
  } catch (err) {
    throw new Error(`Intent parse retry failed. Raw response: ${response}`);
  }

  try {
    return normalizeIntent(extractJSON(retryResponse));
  } catch {
    throw new Error(
      `Could not parse model response as JSON after retry. Raw response: ${retryResponse}`
    );
  }
}

export function validateIntent(intent) {
  const config = loadConfig();
  const connected = Object.keys(config.connectors ?? {}).filter(
    (key) => config.connectors[key] && Object.keys(config.connectors[key]).length > 0
  );
  const needed = intent.tools_needed ?? [];
  const missing = needed.filter((tool) => !connected.includes(tool));
  return { valid: missing.length === 0, missing };
}
