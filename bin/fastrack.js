#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { initDB, wipeDatabase, getAllContext, getWorkflows, deleteWorkflow } from '../core/memory.js';
import {
  addModel,
  setActiveModel,
  compareModels,
  listModels
} from '../core/model-router.js';
import {
  runOnce,
  listWorkflows,
  resolveWorkflow,
  runWorkflow,
  shareWorkflow,
  importWorkflow
} from '../core/workflow-engine.js';
import { startAll, listScheduled, stopAll, checkDeadlines } from '../core/scheduler.js';
import { generateReport, sendReport } from '../core/reports.js';
import { digestNotes, planWorkflowsFromNotes } from '../core/notes.js';
import * as github from '../connectors/github.js';
import * as notion from '../connectors/notion.js';
import * as slack from '../connectors/slack.js';
import * as discord from '../connectors/discord.js';
import * as telegram from '../connectors/telegram.js';
import * as linear from '../connectors/linear.js';
import * as airtable from '../connectors/airtable.js';
import * as jira from '../connectors/jira.js';
import * as webhookTool from '../connectors/webhook.js';
import * as emailTool from '../connectors/email.js';

const program = new Command();

const CONNECTORS = {
  github: {
    guide: () => {
      console.log(chalk.gray('\nGitHub setup:'));
      console.log(chalk.gray('  1. github.com -> Settings -> Developer settings -> Personal access tokens -> Fine-grained'));
      console.log(chalk.gray('  2. Select your repo; permissions: Contents (read), Pull requests (read), Issues (read/write)\n'));
    },
    connect: (answers) => github.connect(answers.token, answers.owner, answers.repo),
    prompts: [
      { type: 'password', name: 'token', message: 'GitHub token:', mask: '*' },
      { type: 'input', name: 'owner', message: 'GitHub owner (user or org):' },
      { type: 'input', name: 'repo', message: 'GitHub repo:' }
    ]
  },
  notion: {
    guide: () => {
      console.log(chalk.gray('\nNotion setup:'));
      console.log(chalk.gray('  1. notion.so/my-integrations -> New integration -> copy the secret (ntn_...)'));
      console.log(chalk.gray('  2. IMPORTANT: open your database -> ... menu -> Connections -> add your integration'));
      console.log(chalk.gray('  3. Database ID: the 32-char hex in the database URL before ?v=\n'));
    },
    connect: (answers) => notion.connect(answers.token, answers.databaseId),
    prompts: [
      { type: 'password', name: 'token', message: 'Notion internal integration secret (ntn_...):', mask: '*' },
      { type: 'input', name: 'databaseId', message: 'Database ID:' }
    ]
  },
  slack: {
    guide: () => {
      console.log(chalk.gray('\nSlack setup:'));
      console.log(chalk.gray('  1. https://api.slack.com/apps -> Create New App -> From scratch'));
      console.log(chalk.gray('  2. OAuth & Permissions -> Bot Token Scopes: chat:write, channels:read, channels:history'));
      console.log(chalk.gray('  3. Install to Workspace -> copy the Bot User OAuth Token (xoxb-...)\n'));
    },
    connect: (answers) => slack.connect(answers.token, answers.defaultChannel ?? null),
    prompts: [
      { type: 'password', name: 'token', message: 'Slack bot token (xoxb-...):', mask: '*' },
      { type: 'input', name: 'defaultChannel', message: 'Default channel ID or name (optional):' }
    ]
  },
  discord: {
    guide: () => {
      console.log(chalk.gray('\nDiscord setup:'));
      console.log(chalk.gray('  Server Settings -> Integrations -> Webhooks -> New Webhook -> copy URL\n'));
    },
    connect: (answers) => discord.connect(answers.webhookUrl),
    prompts: [
      { type: 'password', name: 'webhookUrl', message: 'Discord webhook URL:', mask: '*' }
    ]
  },
  telegram: {
    guide: () => {
      console.log(chalk.gray('\nTelegram setup:'));
      console.log(chalk.gray('  1. Message @BotFather -> /newbot -> copy the bot token'));
      console.log(chalk.gray('  2. Message your bot once, then get your chat id from https://api.telegram.org/bot<token>/getUpdates\n'));
    },
    connect: (answers) => telegram.connect(answers.botToken, answers.chatId),
    prompts: [
      { type: 'password', name: 'botToken', message: 'Telegram bot token:', mask: '*' },
      { type: 'input', name: 'chatId', message: 'Chat ID to send to:' }
    ]
  },
  linear: {
    guide: () => {
      console.log(chalk.gray('\nLinear setup:'));
      console.log(chalk.gray('  Linear -> Settings -> API -> Personal API keys -> create, copy token\n'));
    },
    connect: (answers) => linear.connect(answers.token),
    prompts: [
      { type: 'password', name: 'token', message: 'Linear API token:', mask: '*' }
    ]
  },
  airtable: {
    guide: () => {
      console.log(chalk.gray('\nAirtable setup:'));
      console.log(chalk.gray('  1. https://airtable.com/create/tokens -> add scopes: data.records:read, data.records:write'));
      console.log(chalk.gray('  2. Base ID: open the base -> the app... string in the API docs URL (airtable.com/appXXXX/...)\n'));
    },
    connect: (answers) => airtable.connect(answers.token, answers.baseId, answers.tableName),
    prompts: [
      { type: 'password', name: 'token', message: 'Airtable personal access token:', mask: '*' },
      { type: 'input', name: 'baseId', message: 'Base ID (app...):' },
      { type: 'input', name: 'tableName', message: 'Table name:' }
    ]
  },
  jira: {
    guide: () => {
      console.log(chalk.gray('\nJira setup:'));
      console.log(chalk.gray('  1. Token: id.atlassian.com -> Security -> API tokens -> Create'));
      console.log(chalk.gray('  2. Site URL is https://yourcompany.atlassian.net\n'));
    },
    connect: (answers) => jira.connect(answers.siteUrl, answers.email, answers.apiToken),
    prompts: [
      { type: 'input', name: 'siteUrl', message: 'Jira site URL (https://yourcompany.atlassian.net):' },
      { type: 'input', name: 'email', message: 'Atlassian account email:' },
      { type: 'password', name: 'apiToken', message: 'API token:', mask: '*' }
    ]
  },
  webhook: {
    connect: (answers) => webhookTool.connect(answers.name, answers.url, parseHeaders(answers.headersJson)),
    prompts: [
      { type: 'input', name: 'name', message: 'Webhook name (e.g. "deploy", "alerts"):' },
      { type: 'password', name: 'url', message: 'Webhook URL:', mask: '*' },
      { type: 'input', name: 'headersJson', message: 'Extra headers as JSON (optional, e.g. {"Authorization":"Bearer x"}):' }
    ]
  },
  email: {
    guide: () => {
      console.log(chalk.gray('\nEmail has two modes:'));
      console.log(chalk.gray('  Gmail SMTP (recommended): send from YOUR Gmail to anyone. Needs 2FA + an App Password'));
      console.log(chalk.gray('    (myaccount.google.com -> Security -> 2-Step Verification -> App passwords)'));
      console.log(chalk.gray('  Resend (API): free tier at resend.com, but onboarding@resend.dev can only email YOUR own inbox\n'));
    },
    connect: (answers) =>
      answers.mode === 'smtp'
        ? emailTool.connectSmtp({
            user: answers.user,
            appPassword: answers.appPassword,
            defaultTo: answers.defaultTo ?? null
          })
        : emailTool.connect(answers.apiKey, answers.fromEmail, answers.defaultTo ?? null),
    prompts: async () => {
      const { mode } = await inquirer.prompt([
        {
          type: 'list',
          name: 'mode',
          message: 'Email mode:',
          choices: [
            { name: 'Gmail SMTP - send from your Gmail to anyone (needs App Password)', value: 'smtp' },
            { name: 'Resend - API key, free tier (only emails yourself)', value: 'resend' }
          ]
        }
      ]);
      if (mode === 'smtp') {
        return inquirer.prompt([
          { type: 'input', name: 'user', message: 'Your Gmail address:' },
          { type: 'password', name: 'appPassword', message: 'Gmail App Password (16 chars):', mask: '*' },
          { type: 'input', name: 'defaultTo', message: 'Default recipient (your email):' }
        ]);
      }
      return inquirer.prompt([
        { type: 'password', name: 'apiKey', message: 'Resend API key (re_...):', mask: '*' },
        {
          type: 'input',
          name: 'fromEmail',
          message: 'From address:',
          default: 'onboarding@resend.dev'
        },
        { type: 'input', name: 'defaultTo', message: 'Default recipient (your email):' }
      ]);
    }
  }
};

function parseHeaders(json) {
  if (!json) return {};
  try {
    return JSON.parse(json);
  } catch {
    throw new Error('Headers must be valid JSON, e.g. {"Authorization":"Bearer x"}');
  }
}

const PROVIDER_CHOICES = [
  { name: 'groq (recommended - free & fast, key: console.groq.com)', value: 'groq' },
  { name: 'openai', value: 'openai' },
  { name: 'anthropic', value: 'anthropic' },
  { name: 'google', value: 'google' },
  { name: 'custom (any OpenAI-compatible endpoint)', value: 'custom' }
];

const MODEL_SUGGESTIONS = {
  groq: 'openai/gpt-oss-120b',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-sonnet-4-6',
  google: 'gemini-2.5-flash',
  custom: 'your-model-name'
};

const KEY_MESSAGE = {
  groq: 'Paste your Groq API key (free at console.groq.com):'
};

function banner() {
  console.log(
    chalk.cyan.bold(`
  \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
  \u2551  F A S T R A C K          \u2551
  \u2551  plain english \u2192 done     \u2551
  \u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D
`)
  );
}

function fail(err) {
  console.log(chalk.red(`\nError: ${err.message}`));
  process.exitCode = 1;
}

async function connectTool(tool) {
  const spec = CONNECTORS[tool];
  if (!spec) {
    throw new Error(`Unknown tool "${tool}". Available: ${Object.keys(CONNECTORS).join(', ')}`);
  }
  if (spec.guide) spec.guide();
  const answers = await (typeof spec.prompts === 'function' ? spec.prompts() : inquirer.prompt(spec.prompts));
  const result = await spec.connect(answers);
  console.log(chalk.green(`Connected ${tool}`));
  return result;
}

function resultToText(result) {
  if (result.direct_answer) {
    return result.output || '(no output)';
  }
  const lines = [];
  lines.push(chalk.bold(`Workflow #${result.workflow.id}: ${result.workflow.name}`));
  for (const step of result.results) {
    lines.push(chalk.gray(`  step ${step.step}: ${step.tool}.${step.action} -> ok`));
  }
  lines.push('');
  lines.push(result.output || '(no output)');
  return lines.join('\n');
}

program
  .name('fastrack')
  .description('Plain English workflows. Model agnostic. Local memory. MCP ready.')
  .version('0.1.0');

program
  .command('init')
  .description('Interactive setup: add a model and optionally connect tools')
  .action(async () => {
    try {
      banner();
      const { provider } = await inquirer.prompt([
        {
          type: 'list',
          name: 'provider',
          message: 'Which model provider?',
          choices: PROVIDER_CHOICES
        }
      ]);

      const questions = [
        {
          type: 'password',
          name: 'apiKey',
          message: KEY_MESSAGE[provider] ?? `Paste your ${provider} API key:`,
          mask: '*'
        },
        {
          type: 'input',
          name: 'modelName',
          message: 'Model name:',
          default: MODEL_SUGGESTIONS[provider]
        }
      ];
      if (provider === 'custom') {
        questions.push({
          type: 'input',
          name: 'baseUrl',
          message: 'Base URL of the OpenAI-compatible endpoint:'
        });
      }
      const { apiKey, modelName, baseUrl } = await inquirer.prompt(questions);

      addModel(provider, apiKey, modelName, baseUrl ? { baseUrl } : {});
      setActiveModel(provider);
      console.log(chalk.green(`Model configured: ${provider}/${modelName}`));

      const { tools } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'tools',
          message: 'Connect any tools now?',
          choices: ['github', 'notion', 'slack', 'discord', 'telegram', 'linear', 'airtable', 'jira', 'webhook']
        }
      ]);

      for (const tool of tools) {
        try {
          await connectTool(tool);
        } catch (err) {
          console.log(chalk.yellow(`Skipped ${tool}: ${err.message}`));
        }
      }

      console.log(chalk.green.bold('\nFASTRACK is ready. Try: fastrack "list open PRs and summarize them"\n'));
    } catch (err) {
      fail(err);
    }
  });

program
  .command('connect')
  .description('Connect a tool: github | notion | slack')
  .argument('<tool>', 'tool name')
  .action(async (tool) => {
    try {
      await connectTool(tool);
    } catch (err) {
      fail(err);
    }
  });

program
  .command('workflows')
  .description('Manage workflows')
  .addCommand(
    new Command('list')
      .description('List all saved workflows')
      .action(async () => {
        try {
          const workflows = listWorkflows();
          if (workflows.length === 0) {
            console.log(chalk.gray('No workflows yet. Try: fastrack "summarize open PRs every morning"'));
            return;
          }
          console.table(
            workflows.map((w) => ({
              ID: w.id,
              Name: w.name,
              Status: w.status,
              Trigger: w.trigger_type,
              'Last run': w.last_run ?? 'never',
              Runs: w.run_count,
              'Success %': w.success_rate
            }))
          );
        } catch (err) {
          fail(err);
        }
      })
  )
  .addCommand(
    new Command('run')
      .description('Run a workflow by ID or name')
      .argument('<identifier>')
      .action(async (identifier) => {
        const spinner = ora('Running workflow...').start();
        try {
          const workflow = resolveWorkflow(identifier);
          spinner.text = `Running "${workflow.name}"...`;
          const result = await runWorkflow(workflow.id, '', { interactive: true });
          spinner.succeed(`Done in ${result.workflow.last_run}`);
          console.log(resultToText(result));
          if (result.suggestion) {
            console.log(
              chalk.yellow(
                `\nSuggestion (${result.suggestion.applied ? 'applied' : 'not applied'}): ${result.suggestion.observation}`
              )
            );
          }
        } catch (err) {
          spinner.fail('Run failed');
          fail(err);
        }
      })
  )
  .addCommand(
    new Command('delete')
      .description('Delete a workflow by ID or name')
      .argument('<identifier>')
      .option('-y, --yes', 'Skip confirmation')
      .action(async (identifier, options) => {
        try {
          const workflow = resolveWorkflow(identifier);
          if (!options.yes) {
            const { confirm } = await inquirer.prompt([
              {
                type: 'confirm',
                name: 'confirm',
                message: `Delete workflow #${workflow.id} "${workflow.name}" and its history?`,
                default: false
              }
            ]);
            if (!confirm) {
              console.log(chalk.gray('Aborted.'));
              return;
            }
          }
          deleteWorkflow(workflow.id);
          console.log(chalk.green(`Deleted workflow #${workflow.id}: ${workflow.name}`));
        } catch (err) {
          fail(err);
        }
      })
  )
  .addCommand(
    new Command('share')
      .description('Export a workflow as a shareable JSON file')
      .argument('<identifier>')
      .action(async (identifier) => {
        try {
          const result = shareWorkflow(identifier);
          console.log(chalk.green(`Exported to: ${result.path}`));
        } catch (err) {
          fail(err);
        }
      })
  )
  .addCommand(
    new Command('import')
      .description('Import a workflow from a JSON file')
      .argument('<file>')
      .action(async (file) => {
        try {
          const workflow = importWorkflow(file);
          console.log(chalk.green(`Imported workflow #${workflow.id}: ${workflow.name}`));
        } catch (err) {
          fail(err);
        }
      })
  );

program
  .command('model')
  .description('Manage models')
  .addCommand(
    new Command('add')
      .description('Add a model interactively')
      .action(async () => {
        try {
          const { provider } = await inquirer.prompt([
            {
              type: 'list',
              name: 'provider',
              message: 'Provider:',
              choices: PROVIDER_CHOICES
            }
          ]);
          const questions = [
            {
              type: 'password',
              name: 'apiKey',
              message: KEY_MESSAGE[provider] ?? 'API key:',
              mask: '*'
            },
            {
              type: 'input',
              name: 'modelName',
              message: 'Model name:',
              default: MODEL_SUGGESTIONS[provider]
            }
          ];
          if (provider === 'custom') {
            questions.push({ type: 'input', name: 'baseUrl', message: 'Base URL:' });
          }
          const { apiKey, modelName, baseUrl } = await inquirer.prompt(questions);
          addModel(provider, apiKey, modelName, baseUrl ? { baseUrl } : {});
          console.log(chalk.green(`Added ${provider}/${modelName}`));
        } catch (err) {
          fail(err);
        }
      })
  )
  .addCommand(
    new Command('use')
      .description('Set the active model by provider')
      .argument('<provider>')
      .action(async (provider) => {
        try {
          const model = setActiveModel(provider);
          console.log(chalk.green(`Active model: ${model.provider}/${model.model}`));
        } catch (err) {
          fail(err);
        }
      })
  )
  .addCommand(
    new Command('compare')
      .description('Run a prompt on all configured models and compare')
      .argument('<prompt>')
      .action(async (prompt) => {
        const spinner = ora('Asking every model...').start();
        try {
          const results = await compareModels(prompt);
          spinner.succeed('Comparison complete');
          console.table(
            results.map((r) => ({
              Provider: r.provider,
              Model: r.model,
              'Duration (ms)': r.duration,
              Response: (r.response ?? r.error ?? '').replace(/\s+/g, ' ').slice(0, 80)
            }))
          );
        } catch (err) {
          spinner.fail('Comparison failed');
          fail(err);
        }
      })
  )
  .addCommand(
    new Command('list')
      .description('List configured models')
      .action(async () => {
        const models = listModels();
        if (models.length === 0) {
          console.log(chalk.gray('No models configured. Run: fastrack init'));
          return;
        }
        console.table(models.map((m) => ({ Provider: m.provider, Model: m.model, BaseURL: m.baseUrl ?? '-' })));
      })
  );

program
  .command('memory')
  .description('Inspect or clear local memory')
  .addCommand(
    new Command('show')
      .description('Show everything FASTRACK knows')
      .action(async () => {
        try {
          const context = getAllContext();
          const workflows = getWorkflows();
          if (context.length === 0 && workflows.length === 0) {
            console.log(chalk.gray('Memory is empty.'));
            return;
          }
          if (context.length > 0) {
            console.log(chalk.bold.underline('Context'));
            console.table(context.map((c) => {
              const value = JSON.stringify(c.value);
              return { Key: c.key, Value: value.length > 90 ? value.slice(0, 90) + '…' : value, Updated: c.updated_at };
            }));
          }
          if (workflows.length > 0) {
            console.log(chalk.bold.underline('Workflows'));
            console.table(
              workflows.map((w) => ({
                ID: w.id,
                Name: w.name,
                Status: w.status,
                Runs: w.run_count,
                'Success %': w.success_rate
              }))
            );
          }
        } catch (err) {
          fail(err);
        }
      })
  )
  .addCommand(
    new Command('clear')
      .description('Wipe the local database (workflows, context, history)')
      .action(async () => {
        try {
          const { confirm } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'confirm',
              message: 'This deletes ALL workflows, context and history. Continue?',
              default: false
            }
          ]);
          if (!confirm) {
            console.log(chalk.gray('Aborted.'));
            return;
          }
          wipeDatabase();
          console.log(chalk.green('Memory wiped.'));
        } catch (err) {
          fail(err);
        }
      })
  );

program
  .command('report')
  .description('Generate (and optionally send) a status report from your connected tools')
  .option('--send <channels>', 'Comma-separated channels: slack,discord,telegram,notion,webhook,email')
  .option('--scope <text>', 'Focus the report on a specific area')
  .option('--to <email>', 'Recipient for the email channel')
  .action(async (options) => {
    const spinner = ora('Pulling activity from your tools...').start();
    try {
      const report = await generateReport({ scope: options.scope });
      spinner.succeed('Report ready');
      console.log('\n' + report + '\n');

      if (options.send) {
        const channels = options.send.split(',').map((c) => c.trim()).filter(Boolean);
        const sending = ora(`Sending to: ${channels.join(', ')}...`).start();
        const results = await sendReport(report, channels, options.to ? { emailTo: options.to } : {});
        sending.succeed('Delivery results:');
        for (const r of results) {
          if (r.ok) console.log(chalk.green(`  ${r.channel}: sent`));
          else console.log(chalk.red(`  ${r.channel}: ${r.error}`));
        }
      }
    } catch (err) {
      spinner.fail('Report failed');
      fail(err);
    }
  });

program
  .command('note')
  .description('Digest meeting notes into decisions, action items and workflows')
  .argument('[notes...]', 'Meeting notes text')
  .option('-f, --file <path>', 'Read notes from a file')
  .option('-y, --yes', 'Create workflows without confirming')
  .action(async (notesArgs, options) => {
    try {
      let notes = (notesArgs ?? []).join(' ').trim();
      if (options.file) {
        notes = fs.readFileSync(path.resolve(options.file), 'utf8');
      }
      if (!notes && !process.stdin.isTTY) {
        try {
          notes = fs.readFileSync(0, 'utf8').trim();
        } catch {
          // no piped input
        }
      }
      if (!notes) {
        throw new Error(
          'No notes provided. Usage: fastrack note "..." | fastrack note --file notes.md | cat notes.md | fastrack note'
        );
      }

      const spinner = ora('Digesting notes...').start();
      const digest = await digestNotes(notes);
      spinner.succeed('Notes digested');

      console.log(chalk.bold('\nSummary'));
      console.log(digest.summary);

      if (digest.decisions.length > 0) {
        console.log(chalk.bold('\nDecisions'));
        digest.decisions.forEach((d) => console.log(`  - ${d}`));
      }
      if (digest.action_items.length > 0) {
        console.log(chalk.bold('\nAction items'));
        console.table(
          digest.action_items.map((a, i) => ({
            '#': i + 1,
            Task: a.task,
            Assignee: a.assignee ?? '-',
            Due: a.due ?? '-'
          }))
        );
      }
      if (digest.risks.length > 0) {
        console.log(chalk.yellow.bold('\nRisks'));
        digest.risks.forEach((r) => console.log(chalk.yellow(`  ! ${r}`)));
      }

      let shouldPlan = options.yes;
      if (!shouldPlan && digest.action_items.length > 0) {
        ({ shouldPlan } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'shouldPlan',
            message: 'Create workflows from these action items?',
            default: false
          }
        ]));
      }

      if (shouldPlan) {
        const planning = ora('Planning workflows...').start();
        const plan = await planWorkflowsFromNotes(digest);
        planning.succeed(
          plan.workflows.length > 0
            ? `Created ${plan.workflows.length} workflow(s)`
            : 'No workflows needed'
        );
        for (const wf of plan.workflows) {
          if (wf.id) console.log(chalk.green(`  Workflow #${wf.id}: ${wf.name}`));
          else console.log(chalk.red(`  Failed: ${wf.error}`));
        }
      }
    } catch (err) {
      fail(err);
    }
  });

program
  .command('daemon')
  .description('Keep recurring workflows running (long-running scheduler process)')
  .action(async () => {
    try {
      banner();
      initDB();
      const started = await startAll();

      if (started.length === 0) {
        console.log(chalk.gray('No recurring workflows to run. Create one first, e.g.:'));
        console.log(chalk.gray('  fastrack "every morning summarize open PRs and add to Notion"'));
      } else {
        console.log(chalk.bold('Scheduled workflows:'));
        for (const entry of listScheduled()) {
          console.log(chalk.green(`  "${entry.name}" -> ${entry.cronExpression}`));
        }
      }

      const deadlineTimer = setInterval(() => {
        checkDeadlines().catch(() => {});
      }, 60 * 60 * 1000);
      deadlineTimer.unref();

      // Keep the event loop alive even when no schedules are active
      setInterval(() => {}, 1 << 30);

      const shutdown = () => {
        console.log(chalk.gray('\nStopping schedules...'));
        stopAll();
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      console.log(chalk.cyan('\nFASTRACK daemon running. Press Ctrl+C to stop.'));
    } catch (err) {
      fail(err);
    }
  });

program
  .command('mcp')
  .description('MCP server')
  .addCommand(
    new Command('start')
      .description('Start the FASTRACK MCP server on stdio')
      .action(async () => {
        try {
          const { startMCPServer } = await import('../mcp/server.js');
          await startMCPServer();
          console.error(chalk.cyan('FASTRACK MCP server running. Add to your coding agent config:'));
          console.error(
            chalk.gray(
              JSON.stringify(
                {
                  mcpServers: {
                    fastrack: {
                      command: process.execPath,
                      args: ['<path-to-fastrack>/bin/fastrack.js', 'mcp', 'start']
                    }
                  }
                },
                null,
                2
              )
            )
          );
          // Keep the process alive while the stdio transport is open
          setInterval(() => {}, 1 << 30);
        } catch (err) {
          fail(err);
        }
      })
  );

// Plain English fallback: any input that is not a known subcommand goes to the workflow engine
program
  .argument('[input...]', 'plain English command')
  .action(async (input) => {
    try {
      const text = (input ?? []).join(' ').trim();
      if (!text) {
        banner();
        program.help();
        return;
      }
      banner();
      const spinner = ora('Thinking...').start();
      const result = await runOnce(text, { interactive: true });
      spinner.succeed(result.workflow ? `Done (${result.workflow.trigger_type})` : 'Done');
      console.log('\n' + resultToText(result));
      if (result.suggestion) {
        console.log(
          chalk.yellow(
            `\nSuggestion (${result.suggestion.applied ? 'applied' : 'not applied'}): ${result.suggestion.observation}`
          )
        );
      }
    } catch (err) {
      console.log('');
      fail(err);
    }
  });

initDB();

program.parseAsync(process.argv).catch((err) => fail(err));
