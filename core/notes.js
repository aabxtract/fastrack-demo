import { callModel } from './model-router.js';
import { saveContext, getContext, getAllContext } from './memory.js';
import { buildWorkflow } from './workflow-engine.js';

function extractJSON(text) {
  const cleaned = String(text)
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in model response');
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

const DIGEST_SYSTEM_PROMPT = `You are FASTRACK's meeting notes digester. You read raw meeting notes and return a strict JSON digest.

Respond with ONLY the JSON object. No markdown, no code fences, no commentary.

Schema:
{
  "summary": "2-3 sentence summary of the meeting",
  "decisions": ["decision 1", "decision 2"],
  "action_items": [{ "task": "what needs doing", "assignee": "name or null", "due": "date phrase or null" }],
  "topics": ["topic 1", "topic 2"],
  "risks": ["risk or blocker mentioned"]
}

Rules:
- Extract only what is actually in the notes. Never invent action items.
- Action items must be concrete and actionable.
- If the notes contain no action items, return an empty array.`;

const PLAN_SYSTEM_PROMPT = `You are FASTRACK's workflow planner. You convert a meeting digest's action items into FASTRACK workflow definitions.

Respond with ONLY a JSON object. No markdown, no code fences.

Schema:
{
  "workflows": [
    {
      "action": "create_workflow",
      "tools_needed": ["github" | "notion" | "slack" | "discord" | "telegram" | "linear" | "airtable" | "jira" | "webhook"],
      "trigger": { "type": "once" | "recurring" | "event", "schedule": string | null, "event": string | null },
      "steps": [{ "tool": "github" | "notion" | "slack" | "discord" | "telegram" | "linear" | "airtable" | "jira" | "webhook" | "model", "action": string, "params": object }],
      "assignee": string | null,
      "description": "one sentence: what this workflow does"
    }
  ]
}

Rules:
- Only create workflows for CONCRETE, actionable items. Pure discussion topics get no workflow.
- Only reference tools the action item actually needs. Use the "model" tool (action "generate_text") for drafting/summarizing steps.
- Prefer fewer, well-scoped workflows over one giant one.
- If nothing is actionable, return { "workflows": [] }.`;

export async function digestNotes(rawNotes) {
  const notes = String(rawNotes ?? '').trim();
  if (!notes) {
    throw new Error('No notes provided. Usage: fastrack note "paste your notes" or fastrack note --file notes.md');
  }

  const response = await callModel(notes, {
    system: DIGEST_SYSTEM_PROMPT,
    temperature: 0.2
  });

  const digest = extractJSON(response);
  digest.summary = digest.summary ?? '';
  digest.decisions = Array.isArray(digest.decisions) ? digest.decisions : [];
  digest.action_items = Array.isArray(digest.action_items) ? digest.action_items : [];
  digest.topics = Array.isArray(digest.topics) ? digest.topics : [];
  digest.risks = Array.isArray(digest.risks) ? digest.risks : [];

  const key = `notes:${new Date().toISOString()}`;
  saveContext(key, digest);
  return { ...digest, context_key: key };
}

export async function planWorkflowsFromNotes(notesOrDigest) {
  const digest = notesOrDigest?.action_items
    ? notesOrDigest
    : await digestNotes(notesOrDigest);

  const response = await callModel(JSON.stringify(digest, null, 2), {
    system: PLAN_SYSTEM_PROMPT,
    temperature: 0.2
  });

  const plan = extractJSON(response);
  const intents = Array.isArray(plan.workflows) ? plan.workflows : [];

  const created = [];
  for (const intent of intents) {
    try {
      created.push(buildWorkflow(intent));
    } catch (err) {
      created.push({ error: err.message, intent });
    }
  }

  return { digest, workflows: created };
}

export function listDigests() {
  return getAllContext()
    .filter((entry) => entry.key.startsWith('notes:'))
    .map((entry) => ({ key: entry.key, summary: entry.value?.summary ?? '', action_items: entry.value?.action_items ?? [] }));
}

export function getDigest(key) {
  return getContext(key);
}
