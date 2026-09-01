import { callModel } from './model-router.js';
import { saveContext } from './memory.js';
import * as github from '../connectors/github.js';
import * as notion from '../connectors/notion.js';
import * as linear from '../connectors/linear.js';
import * as jira from '../connectors/jira.js';
import * as airtable from '../connectors/airtable.js';
import * as slack from '../connectors/slack.js';
import * as discord from '../connectors/discord.js';
import * as telegram from '../connectors/telegram.js';
import * as webhook from '../connectors/webhook.js';
import * as email from '../connectors/email.js';

// Each collector pulls from one connected tool; failures (not connected,
// bad token, network) skip that source instead of failing the report.
const DATA_COLLECTORS = [
  {
    source: 'github',
    collect: async () => ({
      open_prs: await github.listOpenPRs(),
      open_issues: await github.listIssues({ state: 'open' }),
      recent_commits: await github.getRecentCommits(10)
    })
  },
  {
    source: 'notion',
    collect: async () => ({ pages: await notion.queryDatabase() })
  },
  {
    source: 'linear',
    collect: async () => ({ issues: await linear.listIssues(15) })
  },
  {
    source: 'jira',
    collect: async () => ({ issues: await jira.search('ORDER BY updated DESC', 15) })
  },
  {
    source: 'airtable',
    collect: async () => ({ records: await airtable.listRecords({ maxRecords: 20 }) })
  }
];

export async function collectData(collectors = DATA_COLLECTORS) {
  const sections = [];
  for (const collector of collectors) {
    try {
      const data = await collector.collect();
      if (data && Object.values(data).some((v) => (Array.isArray(v) ? v.length > 0 : v != null))) {
        sections.push({ source: collector.source, data });
      }
    } catch {
      // tool not connected or unreachable — skip silently
    }
  }
  return sections;
}

export async function generateReport(options = {}) {
  const collectors = options.collectors ?? DATA_COLLECTORS;
  const sections = await collectData(collectors);

  if (sections.length === 0) {
    throw new Error('No connected tools to report from. Connect at least one: fastrack connect github');
  }

  const scope = options.scope ? `Focus scope from the user: ${options.scope}\n\n` : '';
  const prompt = `${scope}Activity data pulled from connected tools:

${sections.map((s) => `## ${s.source}\n${JSON.stringify(s.data).slice(0, 6000)}`).join('\n\n')}`;

  const report = await callModel(prompt, {
    system: `You are FASTRACK's status report writer. Write a comprehensive, easy-to-read status report in markdown.

Structure it with these sections (skip any with nothing to say):
1. **Executive summary** — 2-3 sentences on where things stand
2. **Development progress** — PRs merged/open, commits, issues moved
3. **Milestones** — progress against anything that looks like a milestone or launch
4. **Risks & blockers** — stale items, overdue work, unresolved blockers
5. **Next up** — what the data suggests should happen next

Be specific: reference actual PR/issue titles, numbers and owners. No filler.`,
    temperature: 0.3
  });

  saveContext(`report:${new Date().toISOString()}`, { scope: options.scope ?? null, report });
  return report;
}

export async function sendReport(report, channels = [], options = {}) {
  const results = [];

  for (const channel of channels) {
    try {
      let result;
      switch (channel) {
        case 'slack':
          result = await slack.sendMessage(options.slackChannel ?? null, report);
          break;
        case 'discord':
          result = await discord.sendMessage(report);
          break;
        case 'telegram':
          result = await telegram.sendMessage(report);
          break;
        case 'notion':
          result = await notion.createPage(
            `Status Report - ${new Date().toISOString().slice(0, 10)}`,
            report
          );
          break;
        case 'webhook':
          result = await webhook.send(options.webhookName ?? 'default', { text: report, content: report });
          break;
        case 'email':
          result = await email.sendEmail(
            options.emailTo ?? null,
            `FASTRACK Status Report - ${new Date().toISOString().slice(0, 10)}`,
            report
          );
          break;
        default:
          throw new Error(`Unknown channel "${channel}". Available: slack, discord, telegram, notion, webhook, email`);
      }
      results.push({ channel, ok: true, result });
    } catch (err) {
      results.push({ channel, ok: false, error: err.message });
    }
  }

  return results;
}
