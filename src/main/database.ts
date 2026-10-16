import fs from 'node:fs';
import path from 'node:path';
import initSqlJs, { type Database } from 'sql.js';

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
  `);
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

function persistDatabase() {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  fs.writeFileSync(databasePath, Buffer.from(database.export()));
}
