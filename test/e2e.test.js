import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupTestEnv, teardownTestEnv } from './helpers/setup.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runChild(args, env, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const stdoutLines = [];
    const stderrLines = [];
    let buffer = '';

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`child timed out after ${timeoutMs}ms. stderr: ${stderrLines.join('\n')}`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        stdoutLines.push(buffer.slice(0, index).trim());
        buffer = buffer.slice(index + 1);
      }
    });
    child.stderr.on('data', (chunk) => stderrLines.push(chunk.toString()));

    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stdoutLines, stderr: stderrLines.join('') });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

test('MCP server: full stdio session incl. tool calls end to end', async () => {
  const env = await setupTestEnv();
  try {
    const childEnv = { FASTRACK_HOME: env.homeDir };
    const child = spawn(process.execPath, [path.join(ROOT, 'mcp', 'server.js')], {
      cwd: ROOT,
      env: { ...process.env, ...childEnv },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const responses = new Map();
    let buffer = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id != null) responses.set(msg.id, msg);
        } catch {
          // ignore non-JSON noise
        }
      }
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()));

    const send = (obj) => child.stdin.write(JSON.stringify(obj) + '\n');

    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '0.0.0' }
      }
    });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });

    // fastrack_run — full pipeline through the fake model
    send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'fastrack_run', arguments: { command: 'echo via mcp' } }
    });

    // fastrack_memory_show
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fastrack_memory_show', arguments: {} } });

    const deadline = Date.now() + 20000;
    while (responses.size < 3 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    child.kill();

    assert.ok(responses.has(1), 'initialize responded');
    assert.equal(responses.get(1).result.serverInfo.name, 'fastrack');

    assert.ok(responses.has(2), 'fastrack_run responded');
    const runText = responses.get(2).result.content[0].text;
    assert.match(runText, /FAKE OUTPUT: Echo: echo via mcp/);
    assert.match(runText, /Workflow #\d+/);
    assert.notEqual(responses.get(2).result.isError, true);

    assert.ok(responses.has(3), 'fastrack_memory_show responded');
    const memoryJson = JSON.parse(responses.get(3).result.content[0].text);
    assert.ok(Array.isArray(memoryJson.context));
    assert.ok(Array.isArray(memoryJson.workflows));
  } finally {
    teardownTestEnv(env);
  }
});

test('CLI: plain english command runs end to end (exit 0, output printed)', async () => {
  const env = await setupTestEnv();
  try {
    const { code, stdoutLines, stderr } = await runChild(
      [path.join(ROOT, 'bin', 'fastrack.js'), 'echo hello cli'],
      { FASTRACK_HOME: env.homeDir }
    );

    const stdout = stdoutLines.join('\n');
    assert.equal(code, 0, `exit code should be 0. stderr: ${stderr}. stdout: ${stdout}`);
    assert.match(stdout, /FAKE OUTPUT: Echo: echo hello cli/);
    assert.match(stdout, /F A S T R A C K/, 'banner shown');
    assert.match(stdout, /Workflow #\d+/);
  } finally {
    teardownTestEnv(env);
  }
});

test('CLI: missing model gives explicit error, not a crash', async () => {
  const env = await setupTestEnv();
  try {
    // wipe models from config, keep env
    env.modelRouter.saveConfig({ ...env.modelRouter.loadConfig(), models: [], activeModel: null });

    const { code, stdoutLines } = await runChild(
      [path.join(ROOT, 'bin', 'fastrack.js'), 'echo anything'],
      // GROQ_API_KEY: '' neutralizes both the inherited env var and the project .env (dotenv never overrides)
      { FASTRACK_HOME: env.homeDir, GROQ_API_KEY: '' }
    );

    const stdout = stdoutLines.join('\n');
    assert.equal(code, 1);
    assert.match(stdout, /No model configured\. Run: fastrack init/);
  } finally {
    teardownTestEnv(env);
  }
});
