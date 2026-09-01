import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv, teardownTestEnv } from './helpers/setup.js';

test('model-router: groq provider + GROQ_API_KEY onboarding', async () => {
  const env = await setupTestEnv();
  const originalKey = process.env.GROQ_API_KEY;
  const originalModel = process.env.FASTRACK_MODEL;
  try {
    // groq with explicit baseUrl routes through the OpenAI-compatible path
    const entry = env.modelRouter.addModel('groq', 'gsk_test', 'fake-groq', { baseUrl: env.baseUrl });
    assert.equal(entry.baseUrl, env.baseUrl);
    const text = await env.modelRouter.callModel('groq ping', { provider: 'groq' });
    assert.match(text, /FAKE OUTPUT: groq ping/);

    // groq without baseUrl gets the real Groq endpoint as default
    const defaulted = env.modelRouter.addModel('groq', 'gsk_test', 'llama-3.3-70b-versatile');
    assert.equal(defaulted.baseUrl, 'https://api.groq.com/openai/v1');

    // env fallback: no configured models + GROQ_API_KEY -> instant groq model
    delete process.env.GROQ_API_KEY;
    env.modelRouter.saveConfig({ ...env.modelRouter.loadConfig(), models: [], activeModel: null });
    assert.throws(() => env.modelRouter.getActiveModel(), /GROQ_API_KEY/);

    process.env.GROQ_API_KEY = 'gsk_env_test';
    const active = env.modelRouter.getActiveModel();
    assert.equal(active.provider, 'groq');
    assert.equal(active.model, 'llama-3.3-70b-versatile');
    assert.equal(active.baseUrl, 'https://api.groq.com/openai/v1');

    // FASTRACK_MODEL overrides the env model name
    process.env.FASTRACK_MODEL = 'llama-3.1-8b-instant';
    assert.equal(env.modelRouter.getActiveModel().model, 'llama-3.1-8b-instant');
    delete process.env.FASTRACK_MODEL;

    // env-derived model is never persisted to disk
    assert.equal(env.modelRouter.loadConfig().models.length, 0);
  } finally {
    if (originalKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.FASTRACK_MODEL;
    else process.env.FASTRACK_MODEL = originalModel;
    teardownTestEnv(env);
  }
});

test('model-router: config, validation, selection, live calls', async () => {
  const env = await setupTestEnv();
  try {
    const { modelRouter } = env;

    // (re)register — a previous test may have wiped the shared config
    modelRouter.addModel('custom', 'test-key-123', 'fake-model', { baseUrl: env.baseUrl });
    modelRouter.setActiveModel('custom');

    // task type detection
    assert.equal(modelRouter.detectTaskType('summarize this article'), 'simple');
    assert.equal(modelRouter.detectTaskType('format this list'), 'simple');
    assert.equal(modelRouter.detectTaskType('build a workflow for PR triage'), 'complex');
    assert.equal(modelRouter.detectTaskType('debug the failing test'), 'complex');
    assert.equal(modelRouter.estimateTokens('a'.repeat(400)), 100);

    // config validation
    assert.throws(() => modelRouter.addModel('custom', 'k', 'm'), /baseUrl/, 'custom requires baseUrl');
    assert.throws(() => modelRouter.addModel('nope', 'k', 'm'), /Unknown provider/);
    assert.throws(() => modelRouter.addModel('openai', 'k', ''), /requires/);

    // active model + listing (setup registered custom/fake-model)
    const active = modelRouter.getActiveModel();
    assert.equal(active.provider, 'custom');
    assert.equal(active.model, 'fake-model');
    assert.ok(active.baseUrl.startsWith('http://127.0.0.1:'), 'baseUrl preserved');
    assert.equal(modelRouter.listModels().length, 1);
    assert.throws(() => modelRouter.setActiveModel('anthropic'), /No anthropic model/);

    // auto selection returns a valid configured model + task metadata
    const simple = modelRouter.autoSelectModel('summarize this');
    assert.equal(simple.taskType, 'simple');
    assert.equal(simple.provider, 'custom');
    const complex = modelRouter.autoSelectModel('build a workflow to triage bugs');
    assert.equal(complex.taskType, 'complex');

    // live call against the fake OpenAI-compatible endpoint
    const text = await modelRouter.callModel('ping the fake model');
    assert.match(text, /^FAKE OUTPUT: ping the fake model/);

    // error surfaces from provider
    await assert.rejects(
      () => modelRouter.callModel('FORCE_FAIL now'),
      /Request failed with status code 500/
    );

    // compare across all configured models
    const results = await modelRouter.compareModels('compare me');
    assert.equal(results.length, 1);
    assert.equal(results[0].provider, 'custom');
    assert.ok(results[0].duration >= 0);
    assert.match(results[0].response, /^FAKE OUTPUT: compare me/);

    // no-model error
    modelRouter.saveConfig({ ...modelRouter.loadConfig(), models: [], activeModel: null });
    assert.throws(() => modelRouter.getActiveModel(), /No model configured\. Run: fastrack init/);
    await assert.rejects(() => modelRouter.callModel('x'), /No model configured/);
  } finally {
    teardownTestEnv(env);
  }
});
