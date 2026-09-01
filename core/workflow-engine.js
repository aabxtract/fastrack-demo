import path from 'node:path';
import fs from 'node:fs';
import {
  saveWorkflow,
  getWorkflow,
  getWorkflowByName,
  getWorkflows,
  getHistory,
  logHistory
} from './memory.js';
import { callModel, getActiveModel } from './model-router.js';
import { parseIntent, validateIntent } from './parser.js';
import * as github from '../connectors/github.js';
import * as notion from '../connectors/notion.js';
import * as slack from '../connectors/slack.js';
import * as discord from '../connectors/discord.js';
import * as telegram from '../connectors/telegram.js';
import * as linear from '../connectors/linear.js';
import * as airtable from '../connectors/airtable.js';
import * as jira from '../connectors/jira.js';
import * as webhook from '../connectors/webhook.js';
import * as email from '../connectors/email.js';

const MAX_FIX_ATTEMPTS = 3;

// Synonym aliases for action names LLMs commonly invent (normalized form -> canonical)
const ACTION_ALIASES = {
  listpullrequests: 'list_open_prs',
  listprs: 'list_open_prs',
  getpullrequests: 'list_open_prs',
  getopenprs: 'list_open_prs',
  fetchpullrequests: 'list_open_prs',
  getissues: 'list_issues',
  fetchissues: 'list_issues',
  listopenissues: 'list_issues',
  listcommits: 'get_recent_commits',
  getcommits: 'get_recent_commits',
  listrecentcommits: 'get_recent_commits',
  createcomment: 'create_comment',
  addcomment: 'add_comment',
  createnewpage: 'create_page',
  addpage: 'create_page',
  generate: 'generate_text',
  generatetext: 'generate_text',
  generateresponse: 'generate_text',
  summarize: 'generate_text',
  draft: 'generate_text',
  searchissues: 'search',
  sendnotification: 'send_message',
  sendmessage: 'send_message'
};

function normalizeAction(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function resolveStepHandler(tool, action) {
  const handlers = STEP_HANDLERS[tool];
  if (!handlers) return null;
  if (handlers[action]) return action;

  const normalized = normalizeAction(action);
  const alias = ACTION_ALIASES[normalized];
  if (alias && handlers[alias]) return alias;

  for (const name of Object.keys(handlers)) {
    if (normalizeAction(name) === normalized) return name;
  }
  return null;
}

const STEP_HANDLERS = {
  github: {
    list_open_prs: (p) => github.listOpenPRs(),
    list_issues: (p) => github.listIssues(p),
    assign_issue: (p) => github.assignIssue(p.issueNumber, p.assignee),
    create_comment: (p) => github.createComment(p.issueNumber, p.body),
    get_recent_commits: (p) => github.getRecentCommits(p.limit)
  },
  notion: {
    create_page: (p) => notion.createPage(p.title, p.content),
    update_page: (p) => notion.updatePage(p.pageId, p.content),
    query_database: (p) => notion.queryDatabase(p.filter),
    append_block: (p) => notion.appendBlock(p.pageId, p.content)
  },
  slack: {
    send_message: (p) => slack.sendMessage(p.channel, p.message),
    list_channels: (p) => slack.listChannels(),
    get_recent_messages: (p) => slack.getRecentMessages(p.channel, p.limit)
  },
  discord: {
    send_message: (p) => discord.sendMessage(p.message ?? p.text)
  },
  telegram: {
    send_message: (p) => telegram.sendMessage(p.message ?? p.text, p.chatId)
  },
  linear: {
    create_issue: (p) => linear.createIssue(p),
    list_issues: (p) => linear.listIssues(p.limit),
    list_teams: (p) => linear.listTeams(),
    update_issue_state: (p) => linear.updateIssueState(p.issueId, p.stateId),
    add_comment: (p) => linear.addComment(p.issueId, p.body)
  },
  airtable: {
    create_record: (p) => airtable.createRecord(p.fields ?? p),
    list_records: (p) => airtable.listRecords(p),
    update_record: (p) => airtable.updateRecord(p.recordId, p.fields)
  },
  jira: {
    create_issue: (p) => jira.createIssue(p),
    get_issue: (p) => jira.getIssue(p.key),
    search: (p) => jira.search(p.jql, p.limit),
    add_comment: (p) => jira.addComment(p.key, p.body),
    transition_issue: (p) => jira.transitionIssue(p.key, p.transitionId)
  },
  webhook: {
    send: (p) => webhook.send(p.target ?? p.name ?? p.url, p.payload ?? { text: p.message ?? p.text ?? '' })
  },
  email: {
    send_email: (p) => email.sendEmail(p.to, p.subject, p.body, p.html ? { html: true } : {})
  },
  model: {
    generate_text: (p) =>
      callModel(p.prompt ?? 'Summarize the following data:', { system: 'You are FASTRACK, a workflow execution engine. Be concise, factual and useful.' })
  }
};

function currentModelLabel() {
  try {
    const model = getActiveModel();
    return `${model.provider}/${model.model}`;
  } catch {
    return 'unknown';
  }
}

function stringifyResult(result) {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

function substituteTemplates(value, context) {
  if (typeof value === 'string') {
    return value
      .replace(/\{\{\s*(previous|prev|output)\s*\}\}/gi, context.previousOutput)
      .replace(/\{\{\s*input\s*\}\}/gi, context.input ?? '')
      .replace(/\{\{\s*step(\d+)\s*\}\}/gi, (_, index) => context.results[Number(index)]?.output ?? '');
  }
  if (Array.isArray(value)) return value.map((item) => substituteTemplates(item, context));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, substituteTemplates(item, context)])
    );
  }
  return value;
}

export function buildWorkflow(intent) {
  const name =
    (intent.description ?? 'Untitled workflow')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .slice(0, 8)
      .join(' ')
      .slice(0, 60);

  return saveWorkflow({
    name,
    description: intent.description ?? 'Untitled workflow',
    steps: intent.steps ?? [],
    status: 'active',
    trigger_type: intent.trigger?.type ?? 'once',
    trigger_config: intent.trigger ?? {}
  });
}

async function executeStep(step, context) {
  const canonical = resolveStepHandler(step.tool, step.action);
  if (!canonical) {
    throw new Error(
      `Unknown step "${step.tool}.${step.action}". Available: ${Object.entries(STEP_HANDLERS)
        .map(([tool, actions]) => `${tool}: ${Object.keys(actions).join(', ')}`)
        .join(' | ')}`
    );
  }
  step.action = canonical; // persist the canonical name for retries and future runs
  const handler = STEP_HANDLERS[step.tool][canonical];
  const params = substituteTemplates(step.params ?? {}, context);
  return handler(params);
}

async function fixStepParams(step, error, context) {
  const prompt = `A workflow step failed. Diagnose the error and return corrected parameters.

Workflow input: ${context.input ?? '(none)'}
Previous step output (truncated): ${String(context.previousOutput).slice(0, 2000)}

Failed step:
${JSON.stringify(step, null, 2)}

Error:
${error.message}

Respond with ONLY valid JSON, no markdown fences:
{
  "explanation": "one sentence on what went wrong",
  "action": "corrected action name, only if the action itself is invalid — otherwise omit",
  "params": { corrected parameter object for this step, same parameter names }
}`;

  const response = await callModel(prompt, {
    system: "You are FASTRACK's workflow fixer. Return ONLY the JSON object. No markdown, no prose.",
    temperature: 0.1
  });

  const cleaned = String(response)
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const parsed = JSON.parse(cleaned.slice(start, end + 1));
  if (!parsed.params || typeof parsed.params !== 'object') {
    throw new Error('Fixer did not return a params object');
  }
  return parsed;
}

export async function runWorkflow(workflowId, input = '', options = {}) {
  const workflow = getWorkflow(workflowId);
  if (!workflow) {
    throw new Error(`Workflow ${workflowId} not found`);
  }

  const startedAt = Date.now();
  const context = {
    input,
    previousOutput: '',
    results: []
  };

  for (let index = 0; index < workflow.steps.length; index++) {
    const step = workflow.steps[index];
    let attempt = 0;
    let lastError = null;

    while (attempt < MAX_FIX_ATTEMPTS) {
      attempt += 1;
      try {
        const output = await executeStep(step, context);
        context.results.push({ step: index, tool: step.tool, action: step.action, output });
        context.previousOutput = stringifyResult(output);
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        if (attempt >= MAX_FIX_ATTEMPTS) break;

        try {
          const fix = await fixStepParams(step, err, context);
          if (fix.action) step.action = fix.action;
          step.params = { ...step.params, ...fix.params };
          if (options.verbose) {
            console.log(`  fix attempt ${attempt}: ${fix.explanation ?? 'adjusted params'}`);
          }
        } catch (fixErr) {
          // Could not produce a fix — the next loop iteration retries the step as-is
          if (options.verbose) {
            console.log(`  fix attempt ${attempt} failed to produce params: ${fixErr.message}`);
          }
        }
      }
    }

    if (lastError) {
      const failed = saveWorkflow({
        ...workflow,
        steps: workflow.steps,
        status: 'failed',
        last_run: new Date().toISOString()
      });
      logHistory({
        workflow_id: workflowId,
        input,
        output: null,
        model_used: currentModelLabel(),
        duration: Date.now() - startedAt,
        success: false,
        error: `Step ${index} (${step.tool}.${step.action}) failed after ${MAX_FIX_ATTEMPTS} attempts: ${lastError.message}`
      });
      throw new Error(
        `Workflow "${failed.name}" failed at step ${index} (${step.tool}.${step.action}) after ${MAX_FIX_ATTEMPTS} attempts: ${lastError.message}`
      );
    }
  }

  const finished = saveWorkflow({
    ...workflow,
    steps: workflow.steps,
    status: 'active',
    last_run: new Date().toISOString(),
    run_count: (workflow.run_count ?? 0) + 1
  });

  logHistory({
    workflow_id: workflowId,
    input,
    output: context.previousOutput,
    model_used: currentModelLabel(),
    duration: Date.now() - startedAt,
    success: true,
    error: null
  });

  const shouldImprove =
    options.autoImprove !== false &&
    finished.run_count > 0 &&
    finished.run_count % 3 === 0;

  let suggestion = null;
  if (shouldImprove) {
    suggestion = await improveWorkflow(workflowId, { interactive: options.interactive ?? false });
  }

  return {
    workflow: finished,
    results: context.results,
    output: context.previousOutput,
    suggestion
  };
}

export async function fixWorkflow(workflowId, error) {
  const workflow = getWorkflow(workflowId);
  if (!workflow) {
    throw new Error(`Workflow ${workflowId} not found`);
  }

  const prompt = `A workflow failed to run. Diagnose the root cause and return corrected step definitions.

Workflow:
${JSON.stringify({ name: workflow.name, description: workflow.description, steps: workflow.steps, trigger: workflow.trigger_config }, null, 2)}

Error:
${error}

Respond with ONLY valid JSON, no markdown fences:
{
  "explanation": "one sentence on what went wrong",
  "steps": [ { "tool": "github|notion|slack|model", "action": string, "params": object } ]
}`;

  const response = await callModel(prompt, {
    system: "You are FASTRACK's workflow fixer. Return ONLY the JSON object. No markdown, no prose.",
    temperature: 0.1
  });

  const cleaned = String(response)
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const parsed = JSON.parse(cleaned.slice(start, end + 1));

  if (!Array.isArray(parsed.steps)) {
    throw new Error('Fixer did not return a steps array');
  }

  return saveWorkflow({
    ...workflow,
    steps: parsed.steps,
    status: 'active'
  });
}

export async function improveWorkflow(workflowId, options = {}) {
  const interactive = options.interactive ?? false;
  const workflow = getWorkflow(workflowId);
  if (!workflow) {
    throw new Error(`Workflow ${workflowId} not found`);
  }

  const history = getHistory(workflowId, 10);
  const prompt = `Analyze this workflow's recent run history and suggest optimized steps.

Current workflow:
${JSON.stringify({ name: workflow.name, description: workflow.description, steps: workflow.steps }, null, 2)}

Recent history (${history.length} runs):
${JSON.stringify(history.map((h) => ({ input: h.input, duration_ms: h.duration, success: h.success, error: h.error })), null, 2)}

Respond with ONLY valid JSON, no markdown fences:
{
  "observation": "one sentence describing the improvement you found",
  "steps": [ { "tool": "github|notion|slack|model", "action": string, "params": object } ]
}

Only change steps when the change is a genuine improvement (faster, fewer steps, more reliable).`;

  const response = await callModel(prompt, {
    system: "You are FASTRACK's workflow optimizer. Return ONLY the JSON object. No markdown, no prose.",
    temperature: 0.2
  });

  const cleaned = String(response)
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const parsed = JSON.parse(cleaned.slice(start, end + 1));

  if (!Array.isArray(parsed.steps)) {
    throw new Error('Optimizer did not return a steps array');
  }

  if (!interactive) {
    return { observation: parsed.observation ?? null, steps: parsed.steps, applied: false };
  }

  const { default: inquirer } = await import('inquirer');
  const { apply } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'apply',
      message: `I found a way to make "${workflow.name}" better: ${parsed.observation ?? 'optimized steps'}. Apply?`,
      default: false
    }
  ]);

  if (apply) {
    saveWorkflow({ ...workflow, steps: parsed.steps });
    return { observation: parsed.observation ?? null, steps: parsed.steps, applied: true };
  }
  return { observation: parsed.observation ?? null, steps: parsed.steps, applied: false };
}

export async function runOnce(input, options = {}) {
  const intent = await parseIntent(input);

  const validation = validateIntent(intent);
  if (!validation.valid) {
    throw new Error(
      `Missing tool connections: ${validation.missing.join(', ')}. Run: fastrack connect ${validation.missing[0]}`
    );
  }

  // Direct answer: plain questions and one-shot requests need no workflow
  if (intent.action === 'query' && intent.steps.length === 0) {
    const answer = await callModel(input, {
      system: 'You are FASTRACK. Answer directly. Be concise, factual and useful.',
      temperature: 0.4
    });
    return { intent, workflow: null, results: [], output: answer, direct_answer: true };
  }

  const workflow = buildWorkflow(intent);
  const result = await runWorkflow(workflow.id, input, {
    interactive: options.interactive ?? false,
    verbose: options.verbose ?? false
  });

  return { intent, workflow, ...result };
}

export function listWorkflows() {
  return getWorkflows();
}

export function resolveWorkflow(identifier) {
  if (identifier == null || String(identifier).trim() === '') {
    throw new Error('Workflow identifier is required');
  }
  const asText = String(identifier).trim();
  if (/^\d+$/.test(asText)) {
    const byId = getWorkflow(Number(asText));
    if (byId) return byId;
  }
  const byName = getWorkflowByName(asText);
  if (byName) return byName;

  const available = getWorkflows().map((w) => w.name);
  throw new Error(`No workflow matches "${identifier}". Available: ${available.join(', ') || '(none)'}`);
}

export function shareWorkflow(workflowId) {
  const workflow = resolveWorkflow(workflowId);
  const fileName = `fastrack-workflow-${workflow.id}.json`;
  const filePath = path.join(process.cwd(), fileName);
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        name: workflow.name,
        description: workflow.description,
        steps: workflow.steps,
        trigger_type: workflow.trigger_type,
        trigger_config: workflow.trigger_config,
        shared_from: 'fastrack v0.1.0',
        exported_at: new Date().toISOString()
      },
      null,
      2
    ),
    'utf8'
  );
  return { path: filePath, workflow };
}

export function importWorkflow(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (err) {
    throw new Error(`Invalid workflow file (${resolved}): ${err.message}`);
  }

  if (!Array.isArray(data.steps)) {
    throw new Error(`Invalid workflow file (${resolved}): missing "steps" array`);
  }

  return saveWorkflow({
    name: data.name ?? path.basename(resolved, '.json'),
    description: data.description ?? 'Imported workflow',
    steps: data.steps,
    status: 'active',
    trigger_type: data.trigger_type ?? 'once',
    trigger_config: data.trigger_config ?? {}
  });
}
