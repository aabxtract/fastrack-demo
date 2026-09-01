import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv, teardownTestEnv } from './helpers/setup.js';

test('memory layer: workflows CRUD, context, history, success rate', async () => {
  const env = await setupTestEnv();
  try {
    const { memory } = env;

    // workflow create + read
    const wf = memory.saveWorkflow({
      name: 'Test WF',
      description: 'A test workflow',
      steps: [{ tool: 'model', action: 'generate_text', params: { prompt: 'hi' } }],
      trigger_type: 'recurring',
      trigger_config: { schedule: '0 9 * * *' }
    });
    assert.ok(Number.isInteger(wf.id), 'workflow gets an id');
    assert.equal(wf.status, 'active');
    assert.deepEqual(wf.steps[0], { tool: 'model', action: 'generate_text', params: { prompt: 'hi' } });
    assert.deepEqual(wf.trigger_config, { schedule: '0 9 * * *' });

    // update
    const updated = memory.saveWorkflow({ ...wf, status: 'paused', run_count: 2 });
    assert.equal(updated.status, 'paused');
    assert.equal(updated.run_count, 2);
    assert.equal(updated.id, wf.id, 'update does not create a new row');

    // read paths
    assert.equal(memory.getWorkflow(wf.id).name, 'Test WF');
    assert.equal(memory.getWorkflowByName('Test WF').id, wf.id);
    assert.equal(memory.getWorkflowByName('nope'), null);
    assert.equal(memory.getWorkflows().length, 1);

    // context
    memory.saveContext('team', 'platform');
    memory.saveContext('count', 3);
    memory.saveContext('team', 'core'); // upsert
    assert.equal(memory.getContext('team'), 'core');
    assert.equal(memory.getContext('count'), 3);
    assert.equal(memory.getContext('missing'), null);
    const all = memory.getAllContext();
    assert.equal(all.length, 2);
    assert.equal(all.find((c) => c.key === 'count').value, 3);

    // history + success rate
    memory.logHistory({ workflow_id: wf.id, input: 'x', output: 'ok', success: true, duration: 10 });
    memory.logHistory({ workflow_id: wf.id, input: 'y', success: false, error: 'boom', duration: 5 });
    const history = memory.getHistory(wf.id, 10);
    assert.equal(history.length, 2);
    assert.equal(history[0].success, false, 'history is newest first');
    assert.equal(memory.getSuccessRate(wf.id), 50);
    assert.equal(memory.getSuccessRate(99999), 0);
    assert.equal(memory.getWorkflow(wf.id).success_rate, 50, 'success rate denormalized onto workflow');

    // wipe
    memory.wipeDatabase();
    assert.equal(memory.getWorkflows().length, 0);
    assert.equal(memory.getAllContext().length, 0);
    assert.equal(memory.getHistory(wf.id, 10).length, 0);
  } finally {
    teardownTestEnv(env);
  }
});
