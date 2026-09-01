import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFakeModelServer } from './fake-model.js';

// One env per test process: core modules freeze their config/DB paths at import
// time, so recreating temp dirs per test would silently split state.
let cachedEnv = null;
const originalCwd = process.cwd();

export async function setupTestEnv() {
  if (cachedEnv) return cachedEnv;

  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fastrack-test-'));
  process.env.FASTRACK_HOME = homeDir;

  const { server, port } = await createFakeModelServer();
  const baseUrl = `http://127.0.0.1:${port}/v1`;

  const memory = await import('../../core/memory.js');
  const modelRouter = await import('../../core/model-router.js');
  const parser = await import('../../core/parser.js');
  const engine = await import('../../core/workflow-engine.js');
  const scheduler = await import('../../core/scheduler.js');

  modelRouter.addModel('custom', 'test-key-123', 'fake-model', { baseUrl });
  modelRouter.setActiveModel('custom');

  cachedEnv = { homeDir, baseUrl, server, memory, modelRouter, parser, engine, scheduler };

  process.on('exit', () => {
    try {
      cachedEnv.memory.closeDB();
    } catch {
      // db already closed
    }
    try {
      fs.rmSync(cachedEnv.homeDir, { recursive: true, force: true });
    } catch {
      // Windows may hold the dir briefly — leftover temp dir is harmless
    }
  });

  return cachedEnv;
}

export function teardownTestEnv(env) {
  // Restore cwd (engine tests chdir into the temp home) but keep the env alive;
  // cleanup happens once at process exit.
  try {
    if (process.cwd() !== originalCwd) process.chdir(originalCwd);
  } catch {
    // cwd already gone
  }
}
