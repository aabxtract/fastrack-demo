import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv, teardownTestEnv } from './helpers/setup.js';
test('scheduler: parse, schedule, list, cancel, startAll, deadlines', async () => {
  const env = await setupTestEnv();
  try {
    const { scheduler, memory } = env;

    // natural language -> cron via model
    const cron = await scheduler.parseSchedule('every morning at 9am');
    assert.equal(cron, '0 9 * * *');

    // schedule / list / cancel lifecycle
    const wf = memory.saveWorkflow({
      name: 'Morning PRs',
      description: 'daily summary',
      steps: [{ tool: 'model', action: 'generate_text', params: { prompt: 'Echo: {{input}}' } }],
      trigger_type: 'recurring',
      trigger_config: { schedule: '0 9 * * *' }
    });

    // invalid cron rejected
    assert.throws(() => scheduler.scheduleWorkflow(wf.id, 'not-a-cron'), /not a valid cron/);
    assert.throws(() => scheduler.scheduleWorkflow(99999, '0 9 * * *'), /not found/);

    const scheduled = scheduler.scheduleWorkflow(wf.id, '0 9 * * *');
    assert.equal(scheduled.cronExpression, '0 9 * * *');

    const listed = scheduler.listScheduled();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].workflowId, wf.id);
    assert.equal(listed[0].name, 'Morning PRs');

    assert.equal(scheduler.cancelSchedule(wf.id), true);
    assert.equal(scheduler.cancelSchedule(wf.id), false, 'second cancel is a no-op');
    assert.equal(scheduler.listScheduled().length, 0);

    // startAll picks up recurring workflows from SQLite
    const started = await scheduler.startAll();
    assert.equal(started.length, 1);
    assert.equal(started[0].workflowId, wf.id);
    assert.equal(scheduler.listScheduled().length, 1);
    scheduler.stopAll();
    assert.equal(scheduler.listScheduled().length, 0);

    // paused workflows are not auto-started; un-schedulable ones are skipped with a warning
    memory.saveWorkflow({ ...wf, status: 'paused' });
    memory.saveWorkflow({
      name: 'No Schedule',
      description: 'broken trigger',
      steps: [],
      trigger_type: 'recurring',
      trigger_config: {}
    });
    const startedPartial = await scheduler.startAll();
    assert.equal(startedPartial.length, 0, 'paused/un-schedulable workflows are skipped with a warning');
    assert.equal(scheduler.listScheduled().length, 0);

    // deadline check with no connectors configured -> empty, no crash
    const warnings = await scheduler.checkDeadlines();
    assert.deepEqual(warnings, []);
  } finally {
    env.scheduler.stopAll(); // never leave a live cron timer behind
    teardownTestEnv(env);
  }
});
