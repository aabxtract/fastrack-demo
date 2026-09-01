import * as cronNS from 'node-cron';
import chalk from 'chalk';
import { callModel } from './model-router.js';
import { getWorkflows, getWorkflow } from './memory.js';
import { runWorkflow } from './workflow-engine.js';
import * as github from '../connectors/github.js';
import * as notion from '../connectors/notion.js';

const cron = cronNS.default ?? cronNS;

const activeSchedules = new Map();

const SCHEDULE_SYSTEM_PROMPT = `You convert natural language schedule phrases into a 5-field cron expression (minute hour day-of-month month day-of-week), assuming the user's local timezone.

Respond with ONLY the cron expression. No prose, no markdown, no seconds field.

Examples:
- "every morning at 9am" -> 0 9 * * *
- "every hour" -> 0 * * * *
- "every 30 minutes" -> */30 * * * *
- "every monday at 8:30am" -> 30 8 * * 1
- "daily at 6pm" -> 0 18 * * *
- "weekdays at noon" -> 0 12 * * 1-5`;

function parseCron(expression) {
  const cleaned = String(expression).trim().replace(/^['"`]|['"`]$/g, '');
  if (!cron.validate(cleaned)) {
    throw new Error(`"${cleaned}" is not a valid cron expression`);
  }
  return cleaned;
}

export function scheduleWorkflow(workflowId, cronExpression) {
  const workflow = getWorkflow(workflowId);
  if (!workflow) {
    throw new Error(`Workflow ${workflowId} not found`);
  }
  const expression = parseCron(cronExpression);

  cancelSchedule(workflowId);

  const task = cron.schedule(expression, async () => {
    const startedAt = Date.now();
    try {
      const result = await runWorkflow(workflowId, '', {
        interactive: false,
        autoImprove: false
      });
      console.log(
        chalk.green(`[fastrack] ran "${workflow.name}" in ${Date.now() - startedAt}ms`)
      );
      return result;
    } catch (err) {
      console.log(
        chalk.red(`[fastrack] scheduled run of "${workflow.name}" failed: ${err.message}`)
      );
    }
  });

  activeSchedules.set(workflowId, { task, cronExpression: expression });
  return { workflowId, name: workflow.name, cronExpression: expression };
}

export async function parseSchedule(naturalLanguage) {
  const raw = String(naturalLanguage).trim();
  if (!raw) throw new Error('Cannot parse an empty schedule');

  let response = await callModel(raw, {
    system: SCHEDULE_SYSTEM_PROMPT,
    temperature: 0
  });

  let expression = String(response).trim().split('\n')[0];
  if (cron.validate(expression)) return expression;

  response = await callModel(
    `Convert this schedule phrase into a 5-field cron expression. Reply with ONLY the cron expression, nothing else.\n\nPhrase: ${raw}`,
    { system: SCHEDULE_SYSTEM_PROMPT, temperature: 0 }
  );
  expression = String(response).trim().split('\n')[0];

  if (!cron.validate(expression)) {
    throw new Error(
      `Could not convert "${naturalLanguage}" to a cron expression. Model returned: ${expression}`
    );
  }
  return expression;
}

export function cancelSchedule(workflowId) {
  const entry = activeSchedules.get(workflowId);
  if (!entry) return false;
  entry.task.stop();
  activeSchedules.delete(workflowId);
  return true;
}

export function listScheduled() {
  return [...activeSchedules.entries()].map(([workflowId, entry]) => {
    const workflow = getWorkflow(workflowId);
    return {
      workflowId,
      name: workflow?.name ?? `workflow ${workflowId}`,
      cronExpression: entry.cronExpression
    };
  });
}

export async function startAll() {
  const recurring = getWorkflows().filter(
    (workflow) => workflow.trigger_type === 'recurring' && workflow.status === 'active'
  );

  const started = [];
  for (const workflow of recurring) {
    try {
      let expression = workflow.trigger_config?.schedule;
      if (!expression || !cron.validate(String(expression).trim())) {
        const phrase = workflow.trigger_config?.schedule ?? workflow.trigger_config?.scheduleRaw;
        expression = phrase ? await convertScheduleSafe(phrase) : null;
      }
      if (!expression) {
        console.log(
          chalk.yellow(
            `[fastrack] could not schedule "${workflow.name}": no valid schedule configured`
          )
        );
        continue;
      }
      started.push(scheduleWorkflow(workflow.id, expression));
    } catch (err) {
      console.log(
        chalk.yellow(
          `[fastrack] could not schedule "${workflow.name}": ${err.message}`
        )
      );
    }
  }
  return started;
}

async function convertScheduleSafe(phrase) {
  if (!phrase) return null;
  try {
    return await parseSchedule(phrase);
  } catch {
    return null;
  }
}

function isOverdue(isoDate, days = 7) {
  if (!isoDate) return false;
  const created = new Date(isoDate);
  if (Number.isNaN(created.getTime())) return false;
  return Date.now() - created.getTime() > days * 24 * 60 * 60 * 1000;
}

export async function checkDeadlines() {
  const warnings = [];

  try {
    const issues = await github.listIssues({ state: 'open' });
    for (const issue of issues.filter((issue) => isOverdue(issue.created_at))) {
      warnings.push(`GitHub issue #${issue.number} open for 7+ days: "${issue.title}"`);
    }
  } catch {
    // github not connected — skip
  }

  try {
    const pages = await notion.queryDatabase();
    for (const page of pages.filter((page) => isOverdue(page.created_at))) {
      warnings.push(`Notion page open for 7+ days: "${page.title || page.id}"`);
    }
  } catch {
    // notion not connected — skip
  }

  for (const warning of warnings) {
    console.log(chalk.yellow(`[fastrack] overdue: ${warning}`));
  }

  return warnings;
}

export function stopAll() {
  for (const [workflowId] of activeSchedules) {
    cancelSchedule(workflowId);
  }
}
