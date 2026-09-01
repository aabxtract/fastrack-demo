import Database from 'better-sqlite3';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FASTRACK_DIR = process.env.FASTRACK_HOME ?? path.join(os.homedir(), '.fastrack');
export const DB_PATH = path.join(FASTRACK_DIR, 'fastrack.db');

let db = null;

function ensureDB() {
  if (!db) {
    fs.mkdirSync(FASTRACK_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initDB();
  }
  return db;
}

export function initDB() {
  fs.mkdirSync(FASTRACK_DIR, { recursive: true });
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      description TEXT,
      steps TEXT,
      status TEXT DEFAULT 'active',
      trigger_type TEXT DEFAULT 'once',
      trigger_config TEXT,
      created_at DATETIME,
      last_run DATETIME,
      run_count INTEGER DEFAULT 0,
      success_rate REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS context (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE,
      value TEXT,
      updated_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_id INTEGER,
      input TEXT,
      output TEXT,
      model_used TEXT,
      duration INTEGER,
      success INTEGER DEFAULT 0,
      error TEXT,
      timestamp DATETIME
    );

    CREATE INDEX IF NOT EXISTS idx_history_workflow ON history(workflow_id);
    CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflows(status);
  `);
  return db;
}

export function saveWorkflow(workflow) {
  const d = ensureDB();
  const now = new Date().toISOString();
  const steps = JSON.stringify(workflow.steps ?? []);
  const triggerConfig = JSON.stringify(workflow.trigger_config ?? {});

  if (workflow.id) {
    const existing = d.prepare('SELECT id FROM workflows WHERE id = ?').get(workflow.id);
    if (existing) {
      d.prepare(`
        UPDATE workflows
        SET name = ?, description = ?, steps = ?, status = ?, trigger_type = ?,
            trigger_config = ?, last_run = ?, run_count = ?, success_rate = ?
        WHERE id = ?
      `).run(
        workflow.name ?? null,
        workflow.description ?? null,
        steps,
        workflow.status ?? 'active',
        workflow.trigger_type ?? 'once',
        triggerConfig,
        workflow.last_run ?? null,
        workflow.run_count ?? 0,
        workflow.success_rate ?? 0,
        workflow.id
      );
      return getWorkflow(workflow.id);
    }
  }

  const result = d.prepare(`
    INSERT INTO workflows (name, description, steps, status, trigger_type, trigger_config, created_at, last_run, run_count, success_rate)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    workflow.name ?? null,
    workflow.description ?? null,
    steps,
    workflow.status ?? 'active',
    workflow.trigger_type ?? 'once',
    triggerConfig,
    workflow.created_at ?? now,
    workflow.last_run ?? null,
    workflow.run_count ?? 0,
    workflow.success_rate ?? 0
  );

  return getWorkflow(result.lastInsertRowid);
}

export function getWorkflow(id) {
  const d = ensureDB();
  const row = d.prepare('SELECT * FROM workflows WHERE id = ?').get(id);
  return row ? rowToWorkflow(row) : null;
}

export function getWorkflowByName(name) {
  const d = ensureDB();
  const row = d.prepare('SELECT * FROM workflows WHERE name = ? ORDER BY id ASC').get(name);
  return row ? rowToWorkflow(row) : null;
}

export function getWorkflows() {
  const d = ensureDB();
  const rows = d.prepare('SELECT * FROM workflows ORDER BY id DESC').all();
  return rows.map(rowToWorkflow);
}

export function deleteWorkflow(id) {
  const d = ensureDB();
  d.prepare('DELETE FROM workflows WHERE id = ?').run(id);
  d.prepare('DELETE FROM history WHERE workflow_id = ?').run(id);
  return true;
}

export function saveContext(key, value) {
  const d = ensureDB();
  const now = new Date().toISOString();
  const stored = typeof value === 'string' ? value : JSON.stringify(value);
  d.prepare(`
    INSERT INTO context (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, stored, now);
  return { key, value: stored, updated_at: now };
}

export function getContext(key) {
  const d = ensureDB();
  const row = d.prepare('SELECT * FROM context WHERE key = ?').get(key);
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

export function getAllContext() {
  const d = ensureDB();
  const rows = d.prepare('SELECT * FROM context ORDER BY key ASC').all();
  return rows.map((row) => {
    let value = row.value;
    try {
      value = JSON.parse(row.value);
    } catch {
      // keep raw string
    }
    return { key: row.key, value, updated_at: row.updated_at };
  });
}

export function logHistory(entry) {
  const d = ensureDB();
  const now = new Date().toISOString();
  const result = d.prepare(`
    INSERT INTO history (workflow_id, input, output, model_used, duration, success, error, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.workflow_id ?? null,
    entry.input ?? null,
    typeof entry.output === 'string' ? entry.output : JSON.stringify(entry.output ?? null),
    entry.model_used ?? null,
    entry.duration ?? null,
    entry.success ? 1 : 0,
    entry.error ?? null,
    entry.timestamp ?? now
  );

  if (entry.workflow_id) {
    const rate = getSuccessRate(entry.workflow_id);
    d.prepare('UPDATE workflows SET success_rate = ? WHERE id = ?').run(rate, entry.workflow_id);
  }

  return result.lastInsertRowid;
}

export function getHistory(workflowId, limit = 10) {
  const d = ensureDB();
  const rows = d.prepare(
    'SELECT * FROM history WHERE workflow_id = ? ORDER BY id DESC LIMIT ?'
  ).all(workflowId, limit);
  return rows.map((row) => ({
    ...row,
    success: row.success === 1
  }));
}

export function getSuccessRate(workflowId) {
  const d = ensureDB();
  const row = d.prepare(`
    SELECT COUNT(*) AS total, SUM(success) AS successes
    FROM history WHERE workflow_id = ?
  `).get(workflowId);
  if (!row || row.total === 0 || row.successes == null) return 0;
  return Math.round((row.successes / row.total) * 100);
}

export function closeDB() {
  if (db) {
    db.close();
    db = null;
  }
}

export function wipeDatabase() {
  const d = ensureDB();
  d.exec('DELETE FROM history; DELETE FROM context; DELETE FROM workflows;');
  return true;
}

function rowToWorkflow(row) {
  let steps = [];
  let triggerConfig = {};
  try {
    steps = JSON.parse(row.steps ?? '[]');
  } catch {
    steps = [];
  }
  try {
    triggerConfig = JSON.parse(row.trigger_config ?? '{}');
  } catch {
    triggerConfig = {};
  }
  return {
    ...row,
    steps,
    trigger_config: triggerConfig
  };
}
