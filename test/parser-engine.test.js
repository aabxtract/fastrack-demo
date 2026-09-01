import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupTestEnv, teardownTestEnv } from './helpers/setup.js';

test('parser: intent extraction and tool validation', async () => {
  const env = await setupTestEnv();
  try {
    const { parser } = env;

    // model-only intent (no connectors needed) — tools_needed must NOT contain "model"
    const echo = await parser.parseIntent('echo hello');
    assert.equal(echo.action, 'create_workflow');
    assert.deepEqual(echo.tools_needed, []);
    assert.equal(echo.steps[0].tool, 'model');
    assert.equal(echo.steps[0].params.prompt, 'Echo: {{input}}');
    assert.deepEqual(echo.trigger, { type: 'once', schedule: null, event: null });

    // tool workflow intent
    const prs = await parser.parseIntent('every morning summarize open PRs and add to Notion');
    assert.deepEqual(prs.tools_needed.sort(), ['github', 'notion']);
    assert.equal(prs.trigger.type, 'recurring');
    assert.equal(prs.trigger.schedule, 'every morning at 9am');
    assert.equal(prs.steps.length, 3);

    // validation against (empty) connectors
    const validation = parser.validateIntent(prs);
    assert.equal(validation.valid, false);
    assert.deepEqual(validation.missing.sort(), ['github', 'notion']);

    const echoValidation = parser.validateIntent(echo);
    assert.equal(echoValidation.valid, true);
    assert.deepEqual(echoValidation.missing, []);

    // empty input
    await assert.rejects(() => parser.parseIntent('   '), /empty/i);
  } finally {
    teardownTestEnv(env);
  }
});

test('workflow engine: build, run, templates, failure, self-heal path', async () => {
  const env = await setupTestEnv();
  try {
    const { engine, memory } = env;
    process.chdir(env.homeDir); // keep any exported files inside the temp home

    // build
    const wf = engine.buildWorkflow({
      description: 'Echo machine workflow',
      steps: [{ tool: 'model', action: 'generate_text', params: { prompt: 'Echo: {{input}}' } }],
      trigger: { type: 'once', schedule: null, event: null }
    });
    assert.ok(wf.id);
    assert.match(wf.name, /Echo machine/);

    // run with input + template substitution
    const result = await engine.runWorkflow(wf.id, 'hello world');
    assert.match(result.output, /FAKE OUTPUT: Echo: hello world/);
    assert.equal(result.workflow.run_count, 1);
    assert.equal(result.workflow.status, 'active');
    assert.equal(memory.getSuccessRate(wf.id), 100);

    // chained steps share context via {{previous}}
    const chained = engine.buildWorkflow({
      description: 'Chained steps',
      steps: [
        { tool: 'model', action: 'generate_text', params: { prompt: 'One: {{input}}' } },
        { tool: 'model', action: 'generate_text', params: { prompt: 'Two: {{previous}}' } }
      ]
    });
    const chainResult = await engine.runWorkflow(chained.id, 'go');
    assert.match(chainResult.results[0].output, /One: go/);
    assert.match(chainResult.results[1].output, /Two: FAKE OUTPUT: One: go/);
    assert.equal(chainResult.results.length, 2);

    // failure path: unknown action -> 3 attempts -> failed status + history logged
    const broken = engine.buildWorkflow({
      description: 'Broken workflow',
      steps: [{ tool: 'github', action: 'bogus_action', params: {} }]
    });
    await assert.rejects(
      () => engine.runWorkflow(broken.id, 'x'),
      /failed at step 0.*after 3 attempts/i
    );
    assert.equal(memory.getWorkflow(broken.id).status, 'failed');
    const history = memory.getHistory(broken.id, 1);
    assert.equal(history[0].success, false);
    assert.match(history[0].error, /bogus_action/);
    assert.equal(memory.getSuccessRate(broken.id), 0);

    // improve loop (non-interactive -> suggestion only)
    const suggestion = await engine.improveWorkflow(wf.id, { interactive: false });
    assert.equal(suggestion.applied, false);
    assert.equal(suggestion.observation, 'steps look fine');

    // share + import round trip
    const shared = engine.shareWorkflow(wf.id);
    assert.ok(fs.existsSync(shared.path));
    const onDisk = JSON.parse(fs.readFileSync(shared.path, 'utf8'));
    assert.equal(onDisk.name, wf.name);
    assert.ok(!('apiKey' in onDisk), 'shared file contains no credentials');
    const imported = engine.importWorkflow(shared.path);
    assert.equal(imported.name, wf.name);
    assert.equal(imported.trigger_type, 'once');

    // identifier resolution
    assert.equal(engine.resolveWorkflow(String(wf.id)).id, wf.id);
    assert.equal(engine.resolveWorkflow('Echo machine workflow').id, wf.id);
    assert.throws(() => engine.resolveWorkflow('does-not-exist'), /Available:/);

    // runOnce end to end: parse -> validate -> build -> run
    const e2e = await engine.runOnce('echo inline e2e');
    assert.match(e2e.output, /FAKE OUTPUT: Echo: echo inline e2e/);
    assert.ok(e2e.workflow.id);

    // listWorkflows
    assert.ok(engine.listWorkflows().length >= 3);
  } finally {
    teardownTestEnv(env);
  }
});
