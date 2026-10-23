import fs from 'node:fs';
import path from 'node:path';
import initSqlJs, { type Database } from 'sql.js';
import { BOOKING_FLOW_ID, vinClubWorkflow } from './workflow-template';
import type { WorkflowLog, WorkflowRun } from './workflow-runner';

export type DeviceStatus = 'unknown' | 'ready' | 'offline' | 'busy' | 'error';
// USB: WDA is forwarded to wdaLocalPort on the Mac. IP: Appium attaches to the WDA already running at ipAddress:wdaLocalPort on the iPhone.
export type DeviceConnection = 'usb' | 'ip';
// "Chuẩn bị WDA" records the iOS version, and for go-ios devices (iOS < 17) the installed WDA bundle and its profile expiry.
export type DeviceWda = { iosVersion: string | null; wdaBundleId: string | null; wdaExpiresAt: string | null; wdaPreparedAt: string | null };
export type Device = { id: number; displayName: string; udid: string; bundleId: string; connectionType: DeviceConnection; ipAddress: string | null; status: DeviceStatus; pairingStatus: 'unknown' | 'paired' | 'unpaired'; capabilities: string[]; wdaLocalPort: number; lastCheckedAt: string | null; lastError: string | null } & DeviceWda;
export type DeviceInput = Pick<Device, 'displayName' | 'udid' | 'bundleId'> & { connectionType?: DeviceConnection; ipAddress?: string; wdaLocalPort?: number };
// MyVinpearl is logged in by hand on each iPhone, so a target is just the device (no account records or credentials).
export type CampaignTarget = { deviceId: number };
export type CampaignInputs = {
  paymentYear: number;
  locationQuery: string;
  hotel: string;
  checkIn: string;
  checkOut: string;
  rooms: number;
  adults: number;
  children: number;
  infants: number;
  roomType: string;
  roomPoints: string | number;
};
export type Campaign = { id: number; name: string; inputs: CampaignInputs; targets: CampaignTarget[]; status: 'draft' | 'active' | 'archived'; createdAt: string; updatedAt: string };
export type CampaignInput = Pick<Campaign, 'name' | 'inputs' | 'targets'> & { status?: Campaign['status'] };
export type JobRunSummary = Pick<WorkflowRun, 'id' | 'workflowId' | 'deviceId' | 'campaignId' | 'engine' | 'status' | 'startedAt' | 'finishedAt'> & { workflowName: string; deviceName: string; campaignName: string | null };
export type UiHierarchyCapture = { capturedAt: string; savedPath: string; source: string };
export type JobArtifactKind = 'screenshot' | 'hierarchy';
export type JobArtifact = { kind: JobArtifactKind; savedPath: string; content: string };

let database: Database; let databasePath: string; let artifactPath: string;

export async function initializeDatabase(userDataPath: string) {
  databasePath = path.join(userDataPath, 'vinpearl.sqlite'); artifactPath = path.join(userDataPath, 'artifacts'); archiveLegacyDatabase();
  const unpackedSqlPath = process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist') : '';
  const sqlPath = fs.existsSync(unpackedSqlPath) ? unpackedSqlPath : path.dirname(require.resolve('sql.js'));
  const SQL = await initSqlJs({ locateFile: (file) => path.join(sqlPath, file) });
  database = fs.existsSync(databasePath) ? new SQL.Database(new Uint8Array(fs.readFileSync(databasePath))) : new SQL.Database();
  database.run(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS devices (${DEVICES_COLUMNS});
    CREATE TABLE IF NOT EXISTS workflows (id TEXT PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL, description TEXT, definition_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS campaigns (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, workflow_id TEXT NOT NULL, variables_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (workflow_id) REFERENCES workflows(id));
    CREATE TABLE IF NOT EXISTS campaign_targets (${CAMPAIGN_TARGETS_COLUMNS});
    CREATE TABLE IF NOT EXISTS job_runs (${JOB_RUNS_COLUMNS});
    CREATE TABLE IF NOT EXISTS job_steps (id INTEGER PRIMARY KEY AUTOINCREMENT, job_run_id INTEGER NOT NULL, step_number INTEGER NOT NULL, step_name TEXT NOT NULL, action_type TEXT NOT NULL, status TEXT NOT NULL, message TEXT NOT NULL, occurred_at TEXT NOT NULL, screenshot_path TEXT, hierarchy_path TEXT, FOREIGN KEY (job_run_id) REFERENCES job_runs(id));
  `);
  migrateDevicesTable(); migrateDeviceWdaColumns(); migrateUdidCase(); migrateJobRunColumns(); migrateDropAccounts(); migrateJobStepColumns(); seedWorkflows();
  // Only USB devices share the Mac's ports; IP devices usually all run WDA on 8100.
  database.run("CREATE UNIQUE INDEX IF NOT EXISTS devices_usb_wda_port ON devices (wda_local_port) WHERE connection_type = 'usb'");
  persistDatabase();
}
const DEVICE_WDA_COLUMNS = [['ios_version', 'iosVersion'], ['wda_bundle_id', 'wdaBundleId'], ['wda_expires_at', 'wdaExpiresAt'], ['wda_prepared_at', 'wdaPreparedAt']] as const;
const DEVICES_COLUMNS = `id INTEGER PRIMARY KEY AUTOINCREMENT, display_name TEXT NOT NULL, udid TEXT NOT NULL UNIQUE, bundle_id TEXT NOT NULL, connection_type TEXT NOT NULL CHECK(connection_type IN ('usb', 'ip')), ip_address TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'unknown', pairing_status TEXT NOT NULL DEFAULT 'unknown', capabilities_json TEXT NOT NULL DEFAULT '[]', wda_local_port INTEGER NOT NULL, last_checked_at TEXT, last_error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, ${DEVICE_WDA_COLUMNS.map(([column]) => `${column} TEXT`).join(', ')}, CHECK((connection_type = 'ip') = (ip_address IS NOT NULL))`;
const CAMPAIGN_TARGETS_COLUMNS = 'campaign_id INTEGER NOT NULL, device_id INTEGER NOT NULL, PRIMARY KEY (campaign_id, device_id), FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE, FOREIGN KEY (device_id) REFERENCES devices(id)';
const JOB_RUNS_COLUMNS = 'id INTEGER PRIMARY KEY AUTOINCREMENT, workflow_id TEXT NOT NULL, device_id INTEGER NOT NULL, campaign_id INTEGER, engine TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT NOT NULL, session_id TEXT, logs_json TEXT NOT NULL, FOREIGN KEY (workflow_id) REFERENCES workflows(id), FOREIGN KEY (device_id) REFERENCES devices(id), FOREIGN KEY (campaign_id) REFERENCES campaigns(id)';

export function listDevices(): Device[] { const result = database.exec(`SELECT id, display_name AS displayName, udid, bundle_id AS bundleId, connection_type AS connectionType, ip_address AS ipAddress, status, pairing_status AS pairingStatus, capabilities_json AS capabilitiesJson, wda_local_port AS wdaLocalPort, last_checked_at AS lastCheckedAt, last_error AS lastError, ${DEVICE_WDA_COLUMNS.map(([column, key]) => `${column} AS ${key}`).join(', ')} FROM devices ORDER BY updated_at DESC, id DESC`)[0]; return result ? result.values.map((values) => { const row = Object.fromEntries(result.columns.map((column, index) => [column, values[index]])); return { ...row, capabilities: JSON.parse(String(row.capabilitiesJson ?? '[]')) } as Device; }) : []; }
export function getDevice(id: number) { const device = listDevices().find((item) => item.id === id); if (!device) throw new Error('Thiết bị không tồn tại.'); return device; }
export function createDevice(input: DeviceInput): Device { const statement = database.prepare('INSERT INTO devices (display_name, udid, bundle_id, connection_type, ip_address, wda_local_port) VALUES (?, ?, ?, ?, ?, ?)'); try { statement.run(deviceValues(input)); } finally { statement.free(); } const id = Number(database.exec('SELECT last_insert_rowid() AS id')[0].values[0][0]); persistDatabase(); return getDevice(id); }
export function updateDevice(id: number, input: DeviceInput): Device { const values = deviceValues(input, getDevice(id)); const statement = database.prepare('UPDATE devices SET display_name = ?, udid = ?, bundle_id = ?, connection_type = ?, ip_address = ?, wda_local_port = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'); try { statement.run([...values, id]); } finally { statement.free(); } persistDatabase(); return getDevice(id); }
export function updateDeviceHealth(id: number, update: Pick<Device, 'status' | 'pairingStatus' | 'capabilities'> & { lastError?: string | null }) { const statement = database.prepare('UPDATE devices SET status = ?, pairing_status = ?, capabilities_json = ?, last_checked_at = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'); try { statement.run([update.status, update.pairingStatus, JSON.stringify(update.capabilities), new Date().toISOString(), update.lastError ?? null, id]); } finally { statement.free(); } persistDatabase(); return getDevice(id); }
export function updateDeviceWda(id: number, update: Omit<DeviceWda, 'wdaPreparedAt'>) { const statement = database.prepare('UPDATE devices SET ios_version = ?, wda_bundle_id = ?, wda_expires_at = ?, wda_prepared_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'); try { statement.run([update.iosVersion, update.wdaBundleId, update.wdaExpiresAt, new Date().toISOString(), id]); } finally { statement.free(); } persistDatabase(); return getDevice(id); }
export function setDeviceStatus(id: number, status: DeviceStatus, lastError: string | null = null) { const statement = database.prepare('UPDATE devices SET status = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'); try { statement.run([status, lastError, id]); } finally { statement.free(); } persistDatabase(); return getDevice(id); }

export function listCampaigns(): Campaign[] { const result = database.exec('SELECT id, name, variables_json AS inputsJson, status, created_at AS createdAt, updated_at AS updatedAt FROM campaigns ORDER BY updated_at DESC, id DESC')[0]; if (!result) return []; return result.values.map((values) => { const row = Object.fromEntries(result.columns.map((column, index) => [column, values[index]])); return { id: Number(row.id), name: String(row.name), inputs: normalizeCampaignInputs(row.inputsJson), status: String(row.status) as Campaign['status'], createdAt: String(row.createdAt), updatedAt: String(row.updatedAt), targets: listCampaignTargets(Number(row.id)) }; }); }
export function getCampaign(id: number) { const campaign = listCampaigns().find((item) => item.id === id); if (!campaign) throw new Error('Campaign không tồn tại.'); return campaign; }
export function createCampaign(input: CampaignInput): Campaign { validateCampaign(input); const statement = database.prepare('INSERT INTO campaigns (name, workflow_id, variables_json, status) VALUES (?, ?, ?, ?)'); try { statement.run([input.name.trim(), BOOKING_FLOW_ID, JSON.stringify(input.inputs), input.status ?? 'draft']); } finally { statement.free(); } const id = Number(database.exec('SELECT last_insert_rowid() AS id')[0].values[0][0]); saveCampaignTargets(id, input.targets); persistDatabase(); return getCampaign(id); }
export function updateCampaign(id: number, input: CampaignInput): Campaign { getCampaign(id); validateCampaign(input); const statement = database.prepare('UPDATE campaigns SET name = ?, workflow_id = ?, variables_json = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'); try { statement.run([input.name.trim(), BOOKING_FLOW_ID, JSON.stringify(input.inputs), input.status ?? 'draft', id]); } finally { statement.free(); } database.run(`DELETE FROM campaign_targets WHERE campaign_id = ${id}`); saveCampaignTargets(id, input.targets); persistDatabase(); return getCampaign(id); }

export function saveJobRun(run: Omit<WorkflowRun, 'id'>, sessionId?: string): WorkflowRun {
  if (!run.deviceId) throw new Error('Job phải có deviceId.');
  const statement = database.prepare('INSERT INTO job_runs (workflow_id, device_id, campaign_id, engine, status, started_at, finished_at, session_id, logs_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  try { statement.run([run.workflowId, run.deviceId, run.campaignId ?? null, run.engine, run.status, run.startedAt, run.finishedAt, sessionId ?? null, '[]']); } finally { statement.free(); }
  const id = Number(database.exec('SELECT last_insert_rowid() AS id')[0].values[0][0]);
  const storedLogs = run.logs.map((log) => ({ ...log, screenshot: log.screenshot ? saveScreenshot(id, log.step, log.screenshot) ?? undefined : undefined, hierarchy: log.hierarchy ? saveJobHierarchy(id, log.step, log.hierarchy) ?? undefined : undefined }));
  const update = database.prepare('UPDATE job_runs SET logs_json = ? WHERE id = ?');
  try { update.run([JSON.stringify(storedLogs), id]); } finally { update.free(); }
  saveJobSteps(id, storedLogs); persistDatabase(); return { ...run, id, logs: storedLogs };
}
export function listJobRuns(limit = 40): JobRunSummary[] { const result = database.exec(`SELECT job_runs.id, job_runs.workflow_id AS workflowId, job_runs.device_id AS deviceId, job_runs.campaign_id AS campaignId, job_runs.engine, job_runs.status, job_runs.started_at AS startedAt, job_runs.finished_at AS finishedAt, workflows.name AS workflowName, devices.display_name AS deviceName, campaigns.name AS campaignName FROM job_runs JOIN workflows ON workflows.id = job_runs.workflow_id JOIN devices ON devices.id = job_runs.device_id LEFT JOIN campaigns ON campaigns.id = job_runs.campaign_id ORDER BY job_runs.id DESC LIMIT ${Math.min(Math.max(limit, 1), 100)}`)[0]; return result ? result.values.map((values) => Object.fromEntries(result.columns.map((column, index) => [column, values[index]])) as JobRunSummary) : []; }
export function getJobRun(id: number): WorkflowRun { const statement = database.prepare('SELECT id, workflow_id AS workflowId, device_id AS deviceId, campaign_id AS campaignId, engine, status, started_at AS startedAt, finished_at AS finishedAt, logs_json AS logsJson FROM job_runs WHERE id = ?'); try { statement.bind([id]); if (!statement.step()) throw new Error('Job run không tồn tại.'); const row = statement.getAsObject(); return { id: Number(row.id), workflowId: String(row.workflowId), deviceId: Number(row.deviceId), campaignId: row.campaignId === null ? undefined : Number(row.campaignId), engine: String(row.engine) as WorkflowRun['engine'], status: String(row.status) as WorkflowRun['status'], startedAt: String(row.startedAt), finishedAt: String(row.finishedAt), logs: JSON.parse(String(row.logsJson)) as WorkflowLog[] }; } finally { statement.free(); } }
export function saveScreenshot(jobRunId: number, step: number, imageBase64: string) { if (!imageBase64 || !/^[A-Za-z0-9+/=]+$/.test(imageBase64)) return null; const directory = path.join(artifactPath, String(jobRunId)); fs.mkdirSync(directory, { recursive: true }); const relativePath = path.join(String(jobRunId), `step-${step}.png`); fs.writeFileSync(path.join(artifactPath, relativePath), Buffer.from(imageBase64, 'base64')); return relativePath; }
export function readJobArtifact(jobRunId: number, step: number, kind: JobArtifactKind): JobArtifact { const column = kind === 'screenshot' ? 'screenshot_path' : 'hierarchy_path'; const statement = database.prepare(`SELECT ${column} AS savedPath FROM job_steps WHERE job_run_id = ? AND step_number = ?`); try { statement.bind([jobRunId, step]); if (!statement.step()) throw new Error('Artifact của step không tồn tại.'); const savedPath = String(statement.getAsObject().savedPath ?? ''); if (!savedPath) throw new Error('Step này chưa có artifact.'); const root = path.resolve(artifactPath); const absolute = path.resolve(root, savedPath); if (!absolute.startsWith(`${root}${path.sep}`) || !fs.existsSync(absolute)) throw new Error('Artifact không còn tồn tại.'); return { kind, savedPath, content: kind === 'screenshot' ? fs.readFileSync(absolute).toString('base64') : fs.readFileSync(absolute, 'utf8') }; } finally { statement.free(); } }
export function saveUiHierarchy(deviceId: number, source: string): UiHierarchyCapture { const capturedAt = new Date().toISOString(); const directory = path.join(artifactPath, `device-${deviceId}`); fs.mkdirSync(directory, { recursive: true }); const filename = `hierarchy-${capturedAt.replace(/[:.]/g, '-')}.xml`; const savedPath = path.join(directory, filename); fs.writeFileSync(savedPath, source, 'utf8'); return { capturedAt, savedPath, source }; }
export function closeDatabase() { if (!database) return; persistDatabase(); database.close(); }

function listCampaignTargets(campaignId: number): CampaignTarget[] { const statement = database.prepare('SELECT device_id AS deviceId FROM campaign_targets WHERE campaign_id = ? ORDER BY device_id'); try { statement.bind([campaignId]); const targets: CampaignTarget[] = []; while (statement.step()) targets.push({ deviceId: Number(statement.getAsObject().deviceId) }); return targets; } finally { statement.free(); } }
function saveCampaignTargets(campaignId: number, targets: CampaignTarget[]) { const statement = database.prepare('INSERT INTO campaign_targets (campaign_id, device_id) VALUES (?, ?)'); try { targets.forEach((target) => statement.run([campaignId, target.deviceId])); } finally { statement.free(); } }
function validateCampaign(input: CampaignInput) { if (!input.name?.trim()) throw new Error('Campaign cần tên.'); const inputErrors = validateCampaignInputs(input.inputs); if (inputErrors.length) throw new Error(inputErrors.join(' ')); if (!Array.isArray(input.targets) || !input.targets.length) throw new Error('Campaign cần ít nhất một iPhone.'); const deviceIds = new Set<number>(); input.targets.forEach((target) => { getDevice(Number(target.deviceId)); if (deviceIds.has(target.deviceId)) throw new Error('Một iPhone chỉ được chọn một lần trong cùng campaign.'); deviceIds.add(target.deviceId); }); }
export function validateCampaignInputs(input: unknown): string[] {
  const errors: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ['Campaign inputs phải là JSON object.'];
  const variables = input as Record<string, unknown>;
  if (Object.keys(variables).some((key) => /password|secret|credential/i.test(key))) errors.push('Campaign không được chứa password, secret hoặc credential.');
  const requiredStrings: Array<[keyof CampaignInputs, string]> = [['locationQuery', 'từ khóa địa điểm'], ['hotel', 'tên khách sạn'], ['checkIn', 'ngày nhận phòng'], ['checkOut', 'ngày trả phòng'], ['roomType', 'loại phòng']];
  requiredStrings.forEach(([key, label]) => { if (typeof variables[key] !== 'string' || !(variables[key] as string).trim()) errors.push(`Campaign thiếu ${label}.`); });
  if (!Number.isInteger(variables.paymentYear) || Number(variables.paymentYear) < 2020 || Number(variables.paymentYear) > 2100) errors.push('paymentYear phải là năm từ 2020 đến 2100.');
  const integerRanges: Array<[keyof CampaignInputs, number, number, string]> = [['rooms', 1, 20, 'số phòng'], ['adults', 1, 50, 'người lớn'], ['children', 0, 50, 'trẻ em'], ['infants', 0, 50, 'em bé']];
  integerRanges.forEach(([key, min, max, label]) => { if (!Number.isInteger(variables[key]) || Number(variables[key]) < min || Number(variables[key]) > max) errors.push(`${label} phải từ ${min} đến ${max}.`); });
  if (typeof variables.checkIn === 'string' && typeof variables.checkOut === 'string') { if (!isIsoDate(variables.checkIn)) errors.push('checkIn phải có dạng YYYY-MM-DD hợp lệ.'); if (!isIsoDate(variables.checkOut)) errors.push('checkOut phải có dạng YYYY-MM-DD hợp lệ.'); if (isIsoDate(variables.checkIn) && isIsoDate(variables.checkOut) && variables.checkOut <= variables.checkIn) errors.push('checkOut phải sau checkIn.'); }
  if ((typeof variables.roomPoints !== 'string' && typeof variables.roomPoints !== 'number') || !String(variables.roomPoints).trim()) errors.push('roomPoints là bắt buộc.');
  return errors;
}
function saveJobHierarchy(jobRunId: number, step: number, source: string) { if (!source.trim()) return null; const directory = path.join(artifactPath, String(jobRunId)); fs.mkdirSync(directory, { recursive: true }); const relativePath = path.join(String(jobRunId), `step-${step}.xml`); fs.writeFileSync(path.join(artifactPath, relativePath), source, 'utf8'); return relativePath; }
function saveJobSteps(jobRunId: number, logs: WorkflowLog[]) { const statement = database.prepare('INSERT INTO job_steps (job_run_id, step_number, step_name, action_type, status, message, occurred_at, screenshot_path, hierarchy_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'); try { logs.forEach((log) => statement.run([jobRunId, log.step, log.name, log.type, log.status, log.message, log.at, log.screenshot ?? null, log.hierarchy ?? null])); } finally { statement.free(); } }
function seedWorkflows() {
  const existing = database.prepare('SELECT version FROM workflows WHERE id = ?');
  let currentVersion: number | undefined;
  try { existing.bind([vinClubWorkflow.id]); if (existing.step()) currentVersion = Number(existing.getAsObject().version); } finally { existing.free(); }
  if (currentVersion !== undefined && currentVersion >= vinClubWorkflow.version) return;
  const statement = database.prepare(`
    INSERT INTO workflows (id, name, version, description, definition_json)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, version = excluded.version,
      description = excluded.description, definition_json = excluded.definition_json,
      updated_at = CURRENT_TIMESTAMP
  `);
  try { statement.run([vinClubWorkflow.id, vinClubWorkflow.name, vinClubWorkflow.version, vinClubWorkflow.description ?? null, JSON.stringify(vinClubWorkflow)]); } finally { statement.free(); }
}
// Older device tables kept a credential reference and allowed USB only, with the WDA port unique across all devices.
function migrateDevicesTable() { const columns = tableColumns('devices'); if (columns.includes('ip_address') && !columns.includes('credential_ref')) return; database.run('PRAGMA foreign_keys = OFF'); database.run(`CREATE TABLE devices_next (${DEVICES_COLUMNS})`); database.run('INSERT INTO devices_next (id, display_name, udid, bundle_id, connection_type, status, pairing_status, capabilities_json, wda_local_port, last_checked_at, last_error, created_at, updated_at) SELECT id, display_name, udid, bundle_id, connection_type, status, pairing_status, capabilities_json, wda_local_port, last_checked_at, last_error, created_at, updated_at FROM devices'); database.run('DROP TABLE devices'); database.run('ALTER TABLE devices_next RENAME TO devices'); database.run('PRAGMA foreign_keys = ON'); }
function migrateDeviceWdaColumns() { const columns = tableColumns('devices'); DEVICE_WDA_COLUMNS.forEach(([column]) => { if (!columns.includes(column)) database.run(`ALTER TABLE devices ADD COLUMN ${column} TEXT`); }); }
function migrateUdidCase() { database.run('UPDATE devices SET udid = UPPER(udid) WHERE udid != UPPER(udid)'); }
function migrateJobRunColumns() { const columns = tableColumns('job_runs'); if (!columns.includes('campaign_id')) database.run('ALTER TABLE job_runs ADD COLUMN campaign_id INTEGER'); }
// Databases from before accounts were dropped: keep campaign targets (one per device) and run history, drop the account table.
function migrateDropAccounts() {
  const hasAccounts = Boolean(database.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'accounts'")[0]);
  if (!hasAccounts && !tableColumns('campaign_targets').includes('account_id') && !tableColumns('job_runs').includes('account_id')) return;
  database.run('PRAGMA foreign_keys = OFF');
  database.run(`CREATE TABLE campaign_targets_next (${CAMPAIGN_TARGETS_COLUMNS})`);
  database.run('INSERT OR IGNORE INTO campaign_targets_next (campaign_id, device_id) SELECT campaign_id, device_id FROM campaign_targets');
  database.run('DROP TABLE campaign_targets'); database.run('ALTER TABLE campaign_targets_next RENAME TO campaign_targets');
  database.run(`CREATE TABLE job_runs_next (${JOB_RUNS_COLUMNS})`);
  database.run('INSERT INTO job_runs_next (id, workflow_id, device_id, campaign_id, engine, status, started_at, finished_at, session_id, logs_json) SELECT id, workflow_id, device_id, campaign_id, engine, status, started_at, finished_at, session_id, logs_json FROM job_runs');
  database.run('DROP TABLE job_runs'); database.run('ALTER TABLE job_runs_next RENAME TO job_runs');
  database.run('DROP TABLE IF EXISTS accounts');
  database.run('PRAGMA foreign_keys = ON');
}
function tableColumns(table: string) { return database.exec(`PRAGMA table_info(${table})`)[0]?.values.map((values) => String(values[1])) ?? []; }
function migrateJobStepColumns() { const columns = database.exec('PRAGMA table_info(job_steps)')[0]?.values.map((values) => String(values[1])) ?? []; if (!columns.includes('hierarchy_path')) database.run('ALTER TABLE job_steps ADD COLUMN hierarchy_path TEXT'); }
function isUdid(value: string) { return /^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{8}-[a-fA-F0-9]{16})$/.test(value?.trim()); }
function canonicalUdid(value: string) { return value.trim().toUpperCase(); }
function deviceValues(input: DeviceInput, current?: Device) {
  if (!input.displayName?.trim() || !isUdid(input.udid) || !input.bundleId?.trim()) throw new Error('Tên, UDID Apple hợp lệ và bundle ID là bắt buộc.');
  const connectionType = input.connectionType ?? 'usb';
  if (connectionType !== 'usb' && connectionType !== 'ip') throw new Error('Kiểu kết nối phải là USB hoặc IP.');
  const ipAddress = connectionType === 'ip' ? input.ipAddress?.trim() ?? '' : null;
  if (ipAddress !== null && !isIpv4(ipAddress)) throw new Error('Địa chỉ IP của iPhone không hợp lệ (ví dụ 192.168.1.20).');
  // WDA listens on 8100 on the iPhone itself; USB devices each need a free Mac port to forward it to.
  const port = input.wdaLocalPort ?? (current?.connectionType === connectionType ? current.wdaLocalPort : connectionType === 'ip' ? DEFAULT_WDA_PORT : nextWdaPort());
  if (!Number.isInteger(port) || port < 8100 || port > 65535) throw new Error('WDA port phải từ 8100 đến 65535.');
  const others = listDevices().filter((device) => device.id !== current?.id);
  // Each USB device forwards WDA to its own Mac port; the field is normally left empty so a free one is assigned.
  const holder = connectionType === 'usb' ? others.find((device) => device.connectionType === 'usb' && device.wdaLocalPort === port) : undefined;
  if (holder) throw new Error(`Port ${port} trên Mac đang được "${holder.displayName}" dùng. Để trống ô port để tự cấp (port còn trống: ${nextWdaPort(current?.id)}).`);
  if (ipAddress && others.some((device) => device.ipAddress === ipAddress)) throw new Error(`IP ${ipAddress} đã được thiết bị khác dùng.`);
  return [input.displayName.trim(), canonicalUdid(input.udid), input.bundleId.trim(), connectionType, ipAddress, port];
}
const DEFAULT_WDA_PORT = 8100;
function isIpv4(value: string) { const parts = value.split('.'); return parts.length === 4 && parts.every((part) => /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255); }
function nextWdaPort(exceptId?: number) { const ports = new Set(listDevices().filter((device) => device.connectionType === 'usb' && device.id !== exceptId).map((device) => device.wdaLocalPort)); for (let port = 8100; port < 8200; port += 1) if (!ports.has(port)) return port; throw new Error('Không còn WDA port trống.'); }
function isIsoDate(value: unknown) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const [year, month, day] = value.split('-').map(Number); const date = new Date(Date.UTC(year, month - 1, day)); return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day; }
function normalizeCampaignInputs(value: unknown): CampaignInputs { let saved: Record<string, unknown> = {}; try { const parsed = typeof value === 'string' ? JSON.parse(value) : value; if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) saved = parsed as Record<string, unknown>; } catch { /* Invalid legacy data is surfaced by validation when it is run. */ } return { ...vinClubWorkflow.variables, ...saved } as CampaignInputs; }
function archiveLegacyDatabase() { if (!fs.existsSync(databasePath)) return; try { const text = fs.readFileSync(databasePath).toString('utf8'); if (!text.includes('host_fingerprint') && !text.includes('ssh_server')) return; fs.renameSync(databasePath, path.join(path.dirname(databasePath), `vinpearl-ssh-archive-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`)); } catch { /* Existing DB stays intact if it cannot be inspected. */ } }
function persistDatabase() { fs.mkdirSync(path.dirname(databasePath), { recursive: true }); fs.writeFileSync(databasePath, Buffer.from(database.export())); }
