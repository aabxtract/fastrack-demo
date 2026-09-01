import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { initDB, getAllContext, getWorkflows } from '../core/memory.js';
import { compareModels } from '../core/model-router.js';
import { generateReport, sendReport } from '../core/reports.js';
import { digestNotes, planWorkflowsFromNotes } from '../core/notes.js';
import * as email from '../connectors/email.js';
import { runOnce, listWorkflows, resolveWorkflow, runWorkflow, shareWorkflow } from '../core/workflow-engine.js';
import { startAll } from '../core/scheduler.js';
import * as github from '../connectors/github.js';
import * as notion from '../connectors/notion.js';
import * as slack from '../connectors/slack.js';
import * as discord from '../connectors/discord.js';
import * as telegram from '../connectors/telegram.js';
import * as linear from '../connectors/linear.js';
import * as airtable from '../connectors/airtable.js';
import * as jira from '../connectors/jira.js';
import * as webhookTool from '../connectors/webhook.js';

// Everything except MCP protocol frames must go to stderr — stray stdout output corrupts stdio transport.
console.log = (...args) => console.error(...args);

const VERSION = '0.1.0';

function textResult(text, isError = false) {
  return {
    content: [{ type: 'text', text }],
    ...(isError ? { isError: true } : {})
  };
}

function jsonResult(data) {
  return textResult(JSON.stringify(data, null, 2));
}

async function safeHandler(name, handler) {
  try {
    return await handler();
  } catch (err) {
    return textResult(`fastrack ${name} failed: ${err.message}`, true);
  }
}

export function createServer() {
  const server = new McpServer({ name: 'fastrack', version: VERSION });

  server.registerTool(
    'fastrack_run',
    {
      title: 'Run FASTRACK command',
      description: 'Run any FASTRACK command in plain English',
      inputSchema: { command: z.string().describe('Plain English command, e.g. "list open PRs and summarize them"') }
    },
    async ({ command }) =>
      safeHandler('run', async () => {
        const result = await runOnce(command, { interactive: false });
        const header = result.workflow
          ? `Workflow #${result.workflow.id}: ${result.workflow.name}`
          : 'Answer';
        return textResult([header, result.output || '(no output)'].join('\n\n'));
      })
  );

  server.registerTool(
    'fastrack_workflow_list',
    {
      title: 'List workflows',
      description: 'List all saved FASTRACK workflows',
      inputSchema: {}
    },
    async () =>
      safeHandler('workflow_list', async () => {
        const workflows = listWorkflows();
        return jsonResult(
          workflows.map((w) => ({
            id: w.id,
            name: w.name,
            status: w.status,
            trigger_type: w.trigger_type,
            last_run: w.last_run,
            run_count: w.run_count,
            success_rate: w.success_rate
          }))
        );
      })
  );

  server.registerTool(
    'fastrack_workflow_run',
    {
      title: 'Run workflow',
      description: 'Run a specific workflow by name or ID',
      inputSchema: { identifier: z.string().describe('Workflow ID (numeric) or exact name') }
    },
    async ({ identifier }) =>
      safeHandler('workflow_run', async () => {
        const workflow = resolveWorkflow(identifier);
        const result = await runWorkflow(workflow.id, '', { interactive: false });
        return textResult(result.output || '(no output)');
      })
  );

  server.registerTool(
    'fastrack_workflow_share',
    {
      title: 'Share workflow',
      description: 'Export a workflow as a shareable file',
      inputSchema: { identifier: z.string().describe('Workflow ID (numeric) or exact name') }
    },
    async ({ identifier }) =>
      safeHandler('workflow_share', async () => {
        const result = shareWorkflow(identifier);
        return textResult(`Workflow exported to: ${result.path}`);
      })
  );

  server.registerTool(
    'fastrack_memory_show',
    {
      title: 'Show memory',
      description: 'Show everything FASTRACK knows about your context',
      inputSchema: {}
    },
    async () =>
      safeHandler('memory_show', async () => {
        const context = getAllContext();
        const workflows = getWorkflows().map((w) => ({
          id: w.id,
          name: w.name,
          status: w.status,
          run_count: w.run_count,
          success_rate: w.success_rate
        }));
        return jsonResult({ context, workflows });
      })
  );

  server.registerTool(
    'fastrack_model_compare',
    {
      title: 'Compare models',
      description: 'Run a prompt on all configured models and compare outputs',
      inputSchema: { prompt: z.string().describe('The prompt to send to every configured model') }
    },
    async ({ prompt }) =>
      safeHandler('model_compare', async () => {
        const results = await compareModels(prompt);
        return jsonResult(results);
      })
  );

  server.registerTool(
    'fastrack_connect',
    {
      title: 'Connect tool',
      description: 'Connect a tool to FASTRACK (github, notion, slack, discord, telegram, linear, airtable, jira, webhook, email)',
      inputSchema: {
        tool: z.enum(['github', 'notion', 'slack', 'discord', 'telegram', 'linear', 'airtable', 'jira', 'webhook', 'email']),
        credentials: z
          .record(z.string(), z.string())
          .describe('github: {token, owner, repo} | notion: {token, databaseId} | slack: {token, defaultChannel?} | discord: {webhookUrl} | telegram: {botToken, chatId} | linear: {token} | airtable: {token, baseId, tableName} | jira: {siteUrl, email, apiToken} | email: {apiKey, fromEmail, defaultTo?}')
      }
    },
    async ({ tool, credentials }) =>
      safeHandler('connect', async () => {
        switch (tool) {
          case 'github':
            return jsonResult(await github.connect(credentials.token, credentials.owner, credentials.repo));
          case 'notion':
            return jsonResult(await notion.connect(credentials.token, credentials.databaseId));
          case 'slack':
            return jsonResult(await slack.connect(credentials.token, credentials.defaultChannel ?? null));
          case 'discord':
            return jsonResult(await discord.connect(credentials.webhookUrl));
          case 'telegram':
            return jsonResult(await telegram.connect(credentials.botToken, credentials.chatId));
          case 'linear':
            return jsonResult(await linear.connect(credentials.token));
          case 'airtable':
            return jsonResult(await airtable.connect(credentials.token, credentials.baseId, credentials.tableName));
          case 'jira':
            return jsonResult(await jira.connect(credentials.siteUrl, credentials.email, credentials.apiToken));
          case 'webhook':
            return jsonResult(await webhookTool.connect(credentials.name, credentials.url));
          case 'email':
            if (credentials.provider === 'smtp') {
              return jsonResult(await email.connectSmtp({
                user: credentials.user,
                appPassword: credentials.appPassword,
                from: credentials.from ?? credentials.user,
                defaultTo: credentials.defaultTo ?? null
              }));
            }
            return jsonResult(await email.connect(credentials.apiKey, credentials.fromEmail, credentials.defaultTo ?? null));
          default:
            throw new Error(`Unsupported tool: ${tool}`);
        }
      })
  );

  server.registerTool(
    'fastrack_report',
    {
      title: 'Status report',
      description: 'Generate a status report from connected tools (GitHub, Notion, Linear, Jira, Airtable) and optionally send it to channels',
      inputSchema: {
        scope: z.string().optional().describe('Optional focus area, e.g. "GTM progress"'),
        send_to: z
          .array(z.enum(['slack', 'discord', 'telegram', 'notion', 'webhook', 'email']))
          .optional()
          .describe('Channels to deliver the report to')
      }
    },
    async ({ scope, send_to }) =>
      safeHandler('report', async () => {
        const report = await generateReport(scope ? { scope } : {});
        if (send_to && send_to.length > 0) {
          const results = await sendReport(report, send_to);
          const summary = results.map((r) => `${r.channel}: ${r.ok ? 'sent' : r.error}`).join('\n');
          return textResult(`${report}\n\n--- Delivery ---\n${summary}`);
        }
        return textResult(report);
      })
  );

  server.registerTool(
    'fastrack_note',
    {
      title: 'Meeting notes digest',
      description: 'Digest meeting notes into summary, decisions, action items, and optionally plan workflows from them',
      inputSchema: {
        notes: z.string().describe('Raw meeting notes text'),
        create_workflows: z.boolean().optional().describe('Also create FASTRACK workflows from the action items')
      }
    },
    async ({ notes, create_workflows }) =>
      safeHandler('note', async () => {
        if (create_workflows) {
          const { digest, workflows } = await planWorkflowsFromNotes(notes);
          return jsonResult({
            digest,
            workflows: workflows.map((w) =>
              w.id ? { id: w.id, name: w.name, description: w.description } : { error: w.error }
            )
          });
        }
        const digest = await digestNotes(notes);
        return jsonResult(digest);
      })
  );

  return server;
}

export async function startMCPServer() {
  initDB();

  // Restart recurring workflows inside this long-running process (stderr logging only)
  startAll().catch((err) => {
    console.error(`[fastrack] scheduler startup failed: ${err.message}`);
  });

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`[fastrack] MCP server v${VERSION} running on stdio`);
  return server;
}

// Allow `node mcp/server.js` directly
const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;
if (isMain) {
  startMCPServer().catch((err) => {
    console.error(`[fastrack] fatal: ${err.message}`);
    process.exit(1);
  });
}
