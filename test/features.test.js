import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { setupTestEnv, teardownTestEnv } from './helpers/setup.js';

function startCaptureServer() {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      received.push({ url: req.url, body: body ? JSON.parse(body) : null });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      server.unref();
      resolve({ server, received, url: `http://127.0.0.1:${server.address().port}/hook` });
    });
  });
}

test('new connectors: guards, connect persistence, webhook + discord live', async () => {
  const env = await setupTestEnv();
  const capture = await startCaptureServer();
  try {
    const { modelRouter } = env;
    const connectorsPath = path.join(env.homeDir, 'fastrack.config.json');
    const connected = () => JSON.parse(fs.readFileSync(connectorsPath, 'utf8')).connectors;

    // import connector modules
    const discord = await import('../connectors/discord.js');
    const telegram = await import('../connectors/telegram.js');
    const linear = await import('../connectors/linear.js');
    const airtable = await import('../connectors/airtable.js');
    const jira = await import('../connectors/jira.js');
    const webhook = await import('../connectors/webhook.js');

    // credential guards
    await assert.rejects(() => discord.sendMessage('hi'), /discord not connected/);
    await assert.rejects(() => telegram.sendMessage('hi'), /telegram not connected/);
    await assert.rejects(() => linear.listIssues(), /linear not connected/);
    await assert.rejects(() => airtable.listRecords(), /airtable not connected/);
    await assert.rejects(() => jira.getIssue('ABC-1'), /jira not connected/);
    await assert.rejects(() => webhook.send('nope', {}), /not connected/);

    // connect persists
    await discord.connect(capture.url);
    await telegram.connect('123:abc', '42');
    await linear.connect('lin_test');
    await airtable.connect('air_test', 'app123', 'Tasks');
    await jira.connect('https://test.atlassian.net', 'a@b.c', 'tok');
    await webhook.connect('default', capture.url, { 'X-Test': 'yes' });

    assert.ok(connected().discord.webhookUrl.startsWith('http://127.0.0.1'));
    assert.equal(connected().telegram.chatId, '42');
    assert.equal(connected().linear.token, 'lin_test');
    assert.equal(connected().airtable.tableName, 'Tasks');
    assert.equal(connected().jira.siteUrl, 'https://test.atlassian.net');
    assert.equal(connected().webhooks.default.headers['X-Test'], 'yes');

    // connect validation
    await assert.rejects(() => discord.connect('not-a-url'), /webhook URL/);
    await assert.rejects(() => webhook.connect('x', 'ftp://bad'), /http/);
    await assert.rejects(() => jira.connect('https://x.atlassian.net', 'e'), /requires/);

    // live: webhook send posts payload + custom headers
    const sent = await webhook.send('default', { hello: 'world' });
    assert.equal(sent.status, 200);
    await discord.sendMessage('hello discord');

    const webhookHit = capture.received.find((r) => r.body?.hello === 'world');
    const discordHit = capture.received.find((r) => r.body?.content === 'hello discord');
    assert.ok(webhookHit, 'webhook payload arrived');
    assert.ok(discordHit, 'discord payload arrived');

    // unknown named webhook gives a helpful error
    await assert.rejects(() => webhook.send('missing', {}), /not connected.*\(saved:/s);
  } finally {
    capture.server.close();
    teardownTestEnv(env);
  }
});

test('reports: generate from collectors, save context, deliver via webhook/discord', async () => {
  const env = await setupTestEnv();
  const capture = await startCaptureServer();
  try {
    const { modelRouter } = env;
    const reports = await import('../core/reports.js');
    const discord = await import('../connectors/discord.js');
    const webhook = await import('../connectors/webhook.js');
    const { getAllContext } = env.memory;

    // nothing connected -> explicit error
    await assert.rejects(
      () => reports.generateReport({ collectors: [] }),
      /No connected tools to report from/
    );

    // connect discord + webhook as delivery targets
    await discord.connect(capture.url);
    await webhook.connect('default', capture.url);

    // generate with an injected fake collector (no real network)
    const fakeCollectors = [
      { source: 'github', collect: async () => ({ open_prs: [{ number: 1, title: 'Add feature' }] }) }
    ];
    const report = await reports.generateReport({ scope: 'core features', collectors: fakeCollectors });
    assert.match(report, /FAKE REPORT/);

    // report saved to context
    const reportsInContext = getAllContext().filter((c) => c.key.startsWith('report:'));
    assert.equal(reportsInContext.length, 1);
    assert.equal(reportsInContext[0].value.scope, 'core features');

    // deliver to both offline-safe channels
    const results = await reports.sendReport(report, ['webhook', 'discord']);
    assert.equal(results.length, 2);
    assert.ok(results.every((r) => r.ok), JSON.stringify(results));
    assert.ok(capture.received.some((r) => r.body?.text?.includes('FAKE REPORT')));
    assert.ok(capture.received.some((r) => r.body?.content?.includes('FAKE REPORT')));

    // unknown channel rejected
    const bad = await reports.sendReport(report, ['pigeon']);
    assert.equal(bad[0].ok, false);
    assert.match(bad[0].error, /Unknown channel/);
  } finally {
    capture.server.close();
    teardownTestEnv(env);
  }
});

test('notes: digest, context persistence, workflow planning', async () => {
  const env = await setupTestEnv();
  try {
    const notesModule = await import('../core/notes.js');
    const { memory } = env;

    // empty input rejected
    await assert.rejects(() => notesModule.digestNotes('   '), /No notes provided/);

    // digest
    const raw = 'Meeting: launch sync. Decision: ship Friday. Ana will draft the announcement by Wednesday.';
    const digest = await notesModule.digestNotes(raw);
    assert.equal(digest.summary, 'FAKE SUMMARY: synced on launch plan.');
    assert.deepEqual(digest.decisions, ['Ship on Friday']);
    assert.equal(digest.action_items[0].assignee, 'Ana');
    assert.ok(digest.context_key.startsWith('notes:'));

    // digest persisted to context
    const saved = memory.getContext(digest.context_key);
    assert.equal(saved.summary, digest.summary);

    // plan workflows from the digest
    const plan = await notesModule.planWorkflowsFromNotes(digest);
    assert.equal(plan.workflows.length, 1);
    assert.ok(plan.workflows[0].id, 'workflow created in DB');
    assert.match(plan.workflows[0].description, /launch announcement/);
    assert.equal(env.engine.listWorkflows().length, 1);

    // digests listed from context
    const listed = notesModule.listDigests();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].key, digest.context_key);
  } finally {
    teardownTestEnv(env);
  }
});
