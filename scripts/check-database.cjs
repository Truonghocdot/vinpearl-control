const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const initSqlJs = require('sql.js');
const { initializeDatabase, createCampaign, createDevice, updateDevice, closeDatabase, getJobRun, listCampaigns, listDevices, listJobRuns, readJobArtifact, updateDeviceHealth } = require('../dist-electron/src/main/database.js');
const { vinClubWorkflow } = require('../dist-electron/src/main/workflow-template.js');
const { JobService } = require('../dist-electron/src/main/job-service.js');

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vinpearl-manager-'));
  try {
    fs.writeFileSync(path.join(directory, 'vinpearl.sqlite'), Buffer.from('legacy schema host_fingerprint'));
    await initializeDatabase(directory);
    const first = createDevice({ displayName: 'Phone A', udid: 'a'.repeat(40), bundleId: 'net.cloudhms.booking.vinpearl' });
    const second = createDevice({ displayName: 'Phone B', udid: 'b'.repeat(40), bundleId: 'net.cloudhms.booking.vinpearl' });
    const modern = createDevice({ displayName: 'Phone Modern', udid: '00008101-001d48683e88001e', bundleId: 'net.cloudhms.booking.vinpearl' });
    assert.equal(first.wdaLocalPort, 8100);
    assert.equal(second.wdaLocalPort, 8101);
    assert.equal(modern.wdaLocalPort, 8102);
    assert.equal(modern.udid, '00008101-001D48683E88001E');
    // usbmuxd reports legacy 40-hex UDIDs in lower case; go-ios and Appium do not find an upper-cased one.
    assert.equal(createDevice({ displayName: 'Legacy', udid: ' 32455544A6C51EDA56D426361DBCE796E621026C ', bundleId: 'net.cloudhms.booking.vinpearl', connectionType: 'ip', ipAddress: '10.9.9.9' }).udid, '32455544a6c51eda56d426361dbce796e621026c');
    assert.equal(listDevices().length, 4);
    assert.throws(() => createDevice({ displayName: 'Invalid', udid: 'bad', bundleId: 'net.cloudhms.booking.vinpearl' }));
    assert.throws(() => createDevice({ displayName: 'Port clash', udid: 'd'.repeat(40), bundleId: 'net.cloudhms.booking.vinpearl', wdaLocalPort: 8100 }), /Port 8100 trên Mac đang được "Phone A" dùng\. Để trống ô port để tự cấp \(port còn trống: 8103\)/);
    // IP devices attach to the WDA on the iPhone: they default to its port 8100 and may share it, but not an address.
    const wifi = createDevice({ displayName: 'Phone Wi-Fi', udid: 'e'.repeat(40), bundleId: 'net.cloudhms.booking.vinpearl', connectionType: 'ip', ipAddress: ' 192.168.1.20 ' });
    assert.deepEqual([wifi.connectionType, wifi.ipAddress, wifi.wdaLocalPort], ['ip', '192.168.1.20', 8100]);
    assert.equal(first.connectionType, 'usb'); assert.equal(first.ipAddress, null);
    assert.throws(() => createDevice({ displayName: 'Same IP', udid: 'f'.repeat(40), bundleId: 'net.cloudhms.booking.vinpearl', connectionType: 'ip', ipAddress: '192.168.1.20' }), /đã được thiết bị khác dùng/);
    ['', '192.168.1', '192.168.1.256', '192.168.01.2', 'iphone.local'].forEach((ipAddress) => assert.throws(() => createDevice({ displayName: 'Bad IP', udid: 'f'.repeat(40), bundleId: 'net.cloudhms.booking.vinpearl', connectionType: 'ip', ipAddress }), /IP/));
    assert.throws(() => createDevice({ displayName: 'Bad mode', udid: 'f'.repeat(40), bundleId: 'net.cloudhms.booking.vinpearl', connectionType: 'bluetooth' }));
    // Switching modes clears the IP and moves the device onto a free Mac port (or back to WDA's 8100).
    const moved = updateDevice(wifi.id, { displayName: 'Phone Wi-Fi', udid: wifi.udid, bundleId: wifi.bundleId, connectionType: 'usb', ipAddress: '192.168.1.20' });
    assert.deepEqual([moved.connectionType, moved.ipAddress, moved.wdaLocalPort], ['usb', null, 8103]);
    const back = updateDevice(wifi.id, { displayName: 'Phone Wi-Fi', udid: wifi.udid, bundleId: wifi.bundleId, connectionType: 'ip', ipAddress: '10.0.0.7' });
    assert.deepEqual([back.connectionType, back.ipAddress, back.wdaLocalPort], ['ip', '10.0.0.7', 8100]);
    assert.equal(updateDevice(wifi.id, { displayName: 'Phone Wi-Fi renamed', udid: wifi.udid, bundleId: wifi.bundleId, connectionType: 'ip', ipAddress: '10.0.0.7' }).wdaLocalPort, 8100);
    // Targets are devices only: each iPhone runs with the MyVinpearl account logged in on it.
    const campaign = createCampaign({ name: 'Campaign A', inputs: { ...vinClubWorkflow.variables, hotel: 'Test hotel' }, status: 'active', targets: [{ deviceId: first.id }, { deviceId: second.id }] });
    assert.deepEqual(campaign.targets, [{ deviceId: first.id }, { deviceId: second.id }]);
    assert.equal(listCampaigns().length, 1);
    assert.throws(() => createCampaign({ name: 'Duplicate device', inputs: { ...vinClubWorkflow.variables }, targets: [{ deviceId: first.id }, { deviceId: first.id }] }));
    assert.throws(() => createCampaign({ name: 'No device', inputs: { ...vinClubWorkflow.variables }, targets: [] }));
    assert.throws(() => createCampaign({ name: 'Secret campaign', inputs: { ...vinClubWorkflow.variables, password: 'forbidden' }, targets: [{ deviceId: first.id }] }));
    assert.throws(() => createCampaign({ name: 'Missing payment year', inputs: { ...vinClubWorkflow.variables, paymentYear: undefined }, targets: [{ deviceId: first.id }] }));
    assert.throws(() => createCampaign({ name: 'Missing room type', inputs: { ...vinClubWorkflow.variables, roomType: '' }, targets: [{ deviceId: first.id }] }));
    const capabilities = [...new Set(vinClubWorkflow.steps.filter((step) => step.type !== 'stop').map((step) => step.type))];
    updateDeviceHealth(first.id, { status: 'ready', pairingStatus: 'paired', capabilities });
    const testCampaign = createCampaign({ name: 'Draft test', inputs: { ...vinClubWorkflow.variables }, status: 'draft', targets: [{ deviceId: first.id }] });
    const fakeEngine = { capabilities, health: async () => true, acquireSession: async () => ({ id: 'test-session' }), discardSession: async () => undefined, execute: async () => undefined, screenshot: async () => 'aGVsbG8=', pageSource: async () => '<AppiumAUT />' };
    const testRuns = await new JobService(fakeEngine).runCampaign(testCampaign.id);
    assert.equal(testRuns[0].status, 'stopped');
    const milestones = vinClubWorkflow.steps.flatMap((step, index) => (step.capture ? [index + 1] : []));
    assert.ok(testRuns[0].logs.every((log) => Boolean(log.screenshot) === milestones.includes(log.step) && !log.hierarchy), 'Draft runs photograph milestones only and keep the UI tree for failures.');
    assert.equal(getJobRun(testRuns[0].id).logs.length, testRuns[0].logs.length);
    assert.equal(readJobArtifact(testRuns[0].id, milestones[0], 'screenshot').content, 'aGVsbG8=');
    assert.throws(() => readJobArtifact(testRuns[0].id, milestones[0], 'hierarchy'), /chưa có artifact/);
    assert.equal(listJobRuns()[0].deviceName, 'Phone A');
    // Two iPhones in one campaign run at the same time, each on its own session.
    updateDeviceHealth(second.id, { status: 'ready', pairingStatus: 'paired', capabilities });
    const pairCampaign = createCampaign({ name: 'Two phones', inputs: { ...vinClubWorkflow.variables }, status: 'draft', targets: [{ deviceId: first.id }, { deviceId: second.id }] });
    let running = 0; let peak = 0;
    const parallelEngine = { ...fakeEngine, acquireSession: async (device) => ({ id: `session-${device.udid}` }), execute: async (session, step) => { if (step.type !== 'launchApp') return; running += 1; peak = Math.max(peak, running); await new Promise((resolve) => setTimeout(resolve, 30)); running -= 1; } };
    const pairRuns = await new JobService(parallelEngine).runCampaign(pairCampaign.id);
    assert.deepEqual(pairRuns.map((run) => [run.deviceId, run.status]), [[first.id, 'stopped'], [second.id, 'stopped']]);
    assert.equal(peak, 2, 'Both devices run in parallel.');
    closeDatabase();
    assert.ok(fs.readdirSync(directory).some((file) => file.startsWith('vinpearl-ssh-archive-')));
    await checkAccountMigration();
    console.log('database check ok: legacy archive, USB and IP devices, device-only campaign targets, account schema migration, draft safe-stop and WDA ports');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

// A database from before accounts were dropped keeps its campaign targets and run history.
async function checkAccountMigration() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vinpearl-accounts-'));
  try {
    const SQL = await initSqlJs(); const legacy = new SQL.Database();
    legacy.run(`
      CREATE TABLE devices (id INTEGER PRIMARY KEY AUTOINCREMENT, display_name TEXT NOT NULL, udid TEXT NOT NULL UNIQUE, bundle_id TEXT NOT NULL, connection_type TEXT NOT NULL CHECK(connection_type = 'usb'), status TEXT NOT NULL DEFAULT 'unknown', pairing_status TEXT NOT NULL DEFAULT 'unknown', capabilities_json TEXT NOT NULL DEFAULT '[]', wda_local_port INTEGER NOT NULL UNIQUE, last_checked_at TEXT, last_error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, display_name TEXT NOT NULL, username TEXT NOT NULL, credential_ref TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL, description TEXT, definition_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE campaigns (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, workflow_id TEXT NOT NULL, variables_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (workflow_id) REFERENCES workflows(id));
      CREATE TABLE campaign_targets (campaign_id INTEGER NOT NULL, device_id INTEGER NOT NULL, account_id INTEGER NOT NULL, PRIMARY KEY (campaign_id, device_id, account_id), FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE, FOREIGN KEY (device_id) REFERENCES devices(id), FOREIGN KEY (account_id) REFERENCES accounts(id));
      CREATE TABLE job_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, workflow_id TEXT NOT NULL, device_id INTEGER NOT NULL, account_id INTEGER NOT NULL, campaign_id INTEGER, engine TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT NOT NULL, session_id TEXT, logs_json TEXT NOT NULL, FOREIGN KEY (workflow_id) REFERENCES workflows(id), FOREIGN KEY (device_id) REFERENCES devices(id), FOREIGN KEY (account_id) REFERENCES accounts(id), FOREIGN KEY (campaign_id) REFERENCES campaigns(id));
      CREATE TABLE job_steps (id INTEGER PRIMARY KEY AUTOINCREMENT, job_run_id INTEGER NOT NULL, step_number INTEGER NOT NULL, step_name TEXT NOT NULL, action_type TEXT NOT NULL, status TEXT NOT NULL, message TEXT NOT NULL, occurred_at TEXT NOT NULL, screenshot_path TEXT, hierarchy_path TEXT, FOREIGN KEY (job_run_id) REFERENCES job_runs(id));
      INSERT INTO devices (display_name, udid, bundle_id, connection_type, wda_local_port) VALUES ('Old phone', '${'C'.repeat(40)}', 'net.cloudhms.booking.vinpearl', 'usb', 8100);
      INSERT INTO accounts (display_name, username, credential_ref) VALUES ('Old account', 'old@example.test', 'old-ref');
      INSERT INTO workflows (id, name, version, definition_json) VALUES ('vinclub-safe-booking', 'Old', 1, '{}');
      INSERT INTO campaigns (name, workflow_id, variables_json) VALUES ('Old campaign', 'vinclub-safe-booking', '{}');
      INSERT INTO campaign_targets VALUES (1, 1, 1);
      INSERT INTO job_runs (workflow_id, device_id, account_id, campaign_id, engine, status, started_at, finished_at, logs_json) VALUES ('vinclub-safe-booking', 1, 1, 1, 'appium', 'stopped', '2026-10-01', '2026-10-01', '[]');
      INSERT INTO job_steps (job_run_id, step_number, step_name, action_type, status, message, occurred_at) VALUES (1, 1, 'Mở', 'launchApp', 'succeeded', '', '2026-10-01');
    `);
    fs.writeFileSync(path.join(directory, 'vinpearl.sqlite'), Buffer.from(legacy.export())); legacy.close();
    await initializeDatabase(directory);
    assert.deepEqual(listCampaigns()[0].targets, [{ deviceId: 1 }]);
    assert.equal(listDevices().find((device) => device.id === 1).udid, 'c'.repeat(40), 'Stored upper-case legacy UDIDs are lower-cased on open.');
    assert.deepEqual([listDevices()[0].connectionType, listDevices()[0].ipAddress, listDevices()[0].wdaLocalPort], ['usb', null, 8100], 'USB-only device tables are rebuilt to allow IP devices.');
    assert.equal(createDevice({ displayName: 'New Wi-Fi', udid: 'D'.repeat(40), bundleId: 'net.cloudhms.booking.vinpearl', connectionType: 'ip', ipAddress: '192.168.1.30' }).wdaLocalPort, 8100);
    assert.equal(listJobRuns()[0].campaignName, 'Old campaign');
    assert.equal(getJobRun(1).deviceId, 1);
    closeDatabase();
    const migrated = new SQL.Database(fs.readFileSync(path.join(directory, 'vinpearl.sqlite')));
    assert.equal(migrated.exec("SELECT name FROM sqlite_master WHERE name = 'accounts'").length, 0, 'The accounts table is dropped.');
    assert.ok(!migrated.exec('PRAGMA table_info(job_runs)')[0].values.some((column) => column[1] === 'account_id'));
    assert.equal(migrated.exec('SELECT COUNT(*) FROM job_steps')[0].values[0][0], 1);
    migrated.close();
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
main().catch((error) => { console.error(error); process.exit(1); });
