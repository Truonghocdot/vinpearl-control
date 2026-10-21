import fs from 'node:fs';
import path from 'node:path';
import initSqlJs, { type Database } from 'sql.js';
import { vinClubWorkflow } from './workflow-template';
import type { WorkflowDefinition, WorkflowRun, WorkflowSummary } from './workflow-runner';

export type Device = {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  status: 'unknown' | 'online' | 'offline';
  lastCheckedAt: string | null;
};

type DeviceInput = Pick<Device, 'name' | 'host' | 'port' | 'username'>;

let database: Database;
let databasePath: string;

export async function initializeDatabase(userDataPath: string) {
  databasePath = path.join(userDataPath, 'vinpearl.sqlite');
  const unpackedSqlPath = path.join(
    process.resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    'sql.js',
    'dist',
  );
  const sqlPath = fs.existsSync(unpackedSqlPath)
    ? unpackedSqlPath
    : path.dirname(require.resolve('sql.js'));
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(sqlPath, file),
  });
  const existingDatabase = fs.existsSync(databasePath)
    ? new Uint8Array(fs.readFileSync(databasePath))
    : undefined;
  database = existingDatabase ? new SQL.Database(existingDatabase) : new SQL.Database();
  database.run(`
    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 22,
      username TEXT NOT NULL,
      host_fingerprint TEXT,
      status TEXT NOT NULL DEFAULT 'unknown',
      last_checked_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version INTEGER NOT NULL,
      description TEXT,
      definition_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS workflow_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      logs_json TEXT NOT NULL,
      FOREIGN KEY (workflow_id) REFERENCES workflows(id)
    );
  `);
  seedWorkflows();
  persistDatabase();
}

export function listDevices(): Device[] {
  const result = database.exec(`
    SELECT id, name, host, port, username,
      status, last_checked_at AS lastCheckedAt
    FROM devices
    ORDER BY updated_at DESC, id DESC
  `)[0];
  if (!result) return [];
  return result.values.map((values) => Object.fromEntries(
    result.columns.map((column, index) => [column, values[index]]),
  )) as Device[];
}

export function createDevice(input: DeviceInput): Device {
  if (!input.name.trim() || !input.host.trim() || !input.username.trim()) {
    throw new Error('Device name, host and username are required.');
  }
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    throw new Error('SSH port must be between 1 and 65535.');
  }

  const statement = database.prepare(`
    INSERT INTO devices (name, host, port, username)
    VALUES (?, ?, ?, ?)
  `);
  statement.run([input.name.trim(), input.host.trim(), input.port, input.username.trim()]);
  statement.free();
  const id = database.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number;
  persistDatabase();
  return listDevices().find((device) => device.id === id)!;
}

export function closeDatabase() {
  if (!database) return;
  persistDatabase();
  database.close();
}

export function listWorkflows(): WorkflowSummary[] {
  const result = database.exec(`
    SELECT id, name, version, description, definition_json
    FROM workflows ORDER BY updated_at DESC, id ASC
  `)[0];
  if (!result) return [];
  return result.values.map((values) => {
    const row = Object.fromEntries(result.columns.map((column, index) => [column, values[index]]));
    const definition = JSON.parse(String(row.definition_json)) as WorkflowDefinition;
    return {
      id: String(row.id),
      name: String(row.name),
      version: Number(row.version),
      description: row.description ? String(row.description) : undefined,
      stepCount: definition.steps.length,
    };
  });
}

export function getWorkflow(id: string): WorkflowDefinition {
  const result = database.exec(`
    SELECT definition_json FROM workflows WHERE id = '${escapeSql(id)}'
  `)[0];
  if (!result?.values[0]?.[0]) throw new Error('Workflow không tồn tại.');
  return JSON.parse(String(result.values[0][0])) as WorkflowDefinition;
}

export function saveWorkflowRun(run: Omit<WorkflowRun, 'id'>): WorkflowRun {
  const statement = database.prepare(`
    INSERT INTO workflow_runs (workflow_id, status, started_at, finished_at, logs_json)
    VALUES (?, ?, ?, ?, ?)
  `);
  statement.run([
    run.workflowId,
    run.status,
    run.startedAt,
    run.finishedAt,
    JSON.stringify(run.logs),
  ]);
  statement.free();
  const id = database.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number;
  persistDatabase();
  return { ...run, id };
}

function seedWorkflows() {
  const countResult = database.exec('SELECT COUNT(*) AS count FROM workflows')[0];
  const count = Number(countResult?.values[0]?.[0] ?? 0);
  if (count > 0) return;
  const statement = database.prepare(`
    INSERT INTO workflows (id, name, version, description, definition_json)
    VALUES (?, ?, ?, ?, ?)
  `);
  statement.run([
    vinClubWorkflow.id,
    vinClubWorkflow.name,
    vinClubWorkflow.version,
    vinClubWorkflow.description ?? null,
    JSON.stringify(vinClubWorkflow),
  ]);
  statement.free();
}

function escapeSql(value: string) {
  return value.replace(/'/g, "''");
}

function persistDatabase() {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  fs.writeFileSync(databasePath, Buffer.from(database.export()));
}
