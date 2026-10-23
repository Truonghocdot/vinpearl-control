const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const initSqlJs = require('sql.js');
const { usesGoIos, goIosError } = require('../dist-electron/src/main/go-ios.js');
const { WdaSupervisor } = require('../dist-electron/src/main/wda-supervisor.js');
const { AppiumAutomationEngine } = require('../dist-electron/src/main/appium-engine.js');
const { initializeDatabase, closeDatabase, createDevice, getDevice, listDevices, updateDeviceWda } = require('../dist-electron/src/main/database.js');
const { JobService } = require('../dist-electron/src/main/job-service.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function fakeProcesses() {
  const spawned = [];
  const spawn = (args) => { const child = new EventEmitter(); child.args = args; child.stderr = new EventEmitter(); child.killed = false; child.kill = () => { if (!child.killed) { child.killed = true; setImmediate(() => child.emit('exit', null, 'SIGTERM')); } return true; }; child.die = (stderr) => { if (stderr) child.stderr.emit('data', Buffer.from(stderr)); child.killed = true; child.emit('exit', 1, null); }; if (args[0] === 'runwda') setTimeout(() => { if (!child.killed) child.stderr.emit('data', Buffer.from('{"level":"INFO","msg":"Process started successfully"}\n')); }, 5); spawned.push(child); return child; };
  return { spawned, spawn, runners: () => spawned.filter((child) => child.args[0] === 'runwda') };
}

async function checkSupervisor() {
  // USB: runwda plus a Mac port forward; ready once WDA answers on the forwarded port.
  const usb = fakeProcesses(); let up = false;
  const supervisor = new WdaSupervisor({ spawn: usb.spawn, status: async (host, port) => (up && host === '127.0.0.1' && port === 8160 ? { platformVersion: '15.8.8' } : null), startupTimeoutMs: 3_000, restartDelayMs: 20, maxRestarts: 2 });
  const target = { udid: 'U1', wdaBundleId: 'net.example.WebDriverAgentRunner.xctrunner', connectionType: 'usb', ipAddress: null, wdaLocalPort: 8160 };
  setTimeout(() => { up = true; }, 600);
  assert.deepEqual(await supervisor.ensure(target), { url: 'http://127.0.0.1:8160', platformVersion: '15.8.8', generation: 1 });
  assert.deepEqual(usb.spawned.map((child) => child.args[0]), ['runwda', 'forward']);
  assert.deepEqual(usb.runners()[0].args, ['runwda', '--bundleid=net.example.WebDriverAgentRunner.xctrunner', '--testrunnerbundleid=net.example.WebDriverAgentRunner.xctrunner', '--xctestconfig=WebDriverAgentRunner.xctest', '--env=USE_PORT=8100', '--udid=U1']);
  assert.deepEqual(usb.spawned[1].args, ['forward', '8160', '8100', '--udid=U1']);
  assert.equal((await supervisor.ensure(target)).generation, 1, 'A running WDA is reused.');
  assert.equal(usb.spawned.length, 2);
  // WDA dies with its runner: the supervisor restarts both processes on its own.
  up = false; usb.runners()[0].die('{"level":"ERROR","msg":"WDA process ended unexpectedly"}\n');
  assert.equal(supervisor.state('U1').state, 'restarting');
  assert.equal(supervisor.state('U1').lastError, 'WDA process ended unexpectedly');
  assert.equal(goIosError('{"level":"INFO","msg":"Killing test runner"}\n'), 'Killing test runner', 'Without an ERROR line the last message is used, not raw JSON.');
  assert.ok(usb.spawned[1].killed, 'The forward goes down with the runner.');
  await sleep(60); up = true;
  assert.equal(usb.runners().length, 2, 'Restarted without being asked.');
  await sleep(600);
  assert.equal(supervisor.state('U1').state, 'running', 'A restarted WDA is marked running without anyone waiting on it.');
  assert.equal((await supervisor.ensure(target)).generation, 2);
  assert.equal(supervisor.state('U1').restarts, 1);
  // A device that keeps failing (unplugged) stops being retried, then ensure starts it again from scratch.
  up = false;
  for (let attempt = 0; attempt < 3; attempt += 1) { usb.runners().at(-1).die('{"level":"ERROR","msg":"Device not found"}\n'); await sleep(20 * 2 ** attempt + 30); }
  assert.equal(supervisor.state('U1').state, 'error');
  const runnersBefore = usb.runners().length;
  await assert.rejects(supervisor.ensure({ ...target }), /WDA không khởi động được trên U1/);
  assert.equal(usb.runners().length, runnersBefore + 1, 'ensure retries a device the restarts gave up on.');
  supervisor.stop('U1');
  assert.ok(usb.spawned.every((child) => child.killed), 'stop kills every process.');
  assert.equal(supervisor.state('U1'), null);
  // IP: WDA is reached on the iPhone itself, on its own port, with no forward.
  const ip = fakeProcesses();
  const ipSupervisor = new WdaSupervisor({ spawn: ip.spawn, status: async (host, port) => (host === '192.168.1.17' && port === 8100 ? {} : null) });
  assert.equal((await ipSupervisor.ensure({ ...target, udid: 'U2', connectionType: 'ip', ipAddress: '192.168.1.17', wdaLocalPort: 8100 })).url, 'http://192.168.1.17:8100');
  assert.deepEqual(ip.spawned.map((child) => child.args[0]), ['runwda']);
  assert.ok(ip.spawned[0].args.includes('--env=USE_PORT=8100'));
  ipSupervisor.stopAll();
  // The WDA being replaced may still answer /status: it does not count until go-ios reports the new launch.
  const racing = fakeProcesses(); const quiet = (args) => { const child = racing.spawn(args); child.stderr.emit = () => true; return child; };
  const raceSupervisor = new WdaSupervisor({ spawn: quiet, status: async () => ({}), startupTimeoutMs: 400 });
  await assert.rejects(raceSupervisor.ensure({ ...target, udid: 'U4' }), /WDA không khởi động được/);
  raceSupervisor.stopAll();
}

async function checkEngine() {
  const created = []; let generation = 1; const ensured = [];
  const client = { isAlive: async () => true, restartApp: async () => undefined, deleteSession: async () => undefined, createSession: async (udid, bundleId, _port, options) => { created.push(options); return { id: `s${created.length}`, bundleId, capabilities: {} }; } };
  const wda = { ensure: async (target) => { ensured.push(target); return { url: 'http://127.0.0.1:8160', platformVersion: '15.8.8', generation }; }, stop: () => undefined, stopAll: () => undefined };
  const engine = new AppiumAutomationEngine(client, undefined, wda);
  const device = { udid: 'U1', bundleId: 'net.cloudhms.booking.vinpearl', wdaLocalPort: 8160, connectionType: 'usb', wdaBundleId: 'net.example.WebDriverAgentRunner.xctrunner', wdaExpiresAt: new Date(Date.now() + 86_400_000).toISOString() };
  assert.equal((await engine.acquireSession(device)).id, 's1');
  assert.deepEqual([created[0].webDriverAgentUrl, created[0].platformVersion], ['http://127.0.0.1:8160', '15.8.8']);
  assert.equal(ensured[0].wdaBundleId, 'net.example.WebDriverAgentRunner.xctrunner');
  assert.equal((await engine.acquireSession(device)).id, 's1', 'Warm session on the same WDA.');
  generation = 2;
  assert.equal((await engine.acquireSession(device)).id, 's2', 'A restarted WDA gets a new session even if Appium still lists the old one.');
  await assert.rejects(engine.acquireSession({ ...device, udid: 'U3', wdaExpiresAt: new Date(Date.now() - 1_000).toISOString() }), /Profile WDA đã hết hạn/);
  assert.equal(ensured.filter((target) => target.udid === 'U3').length, 0, 'An expired profile is not even launched.');
  await new AppiumAutomationEngine(client, undefined, wda).acquireSession({ ...device, wdaBundleId: null });
  assert.equal(created.at(-1).webDriverAgentUrl, undefined, 'Unprepared USB devices keep Appium launching WDA.');
}

async function checkDatabase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vinpearl-wda-'));
  try {
    // A devices table from the IP-mode schema, before the WDA columns existed.
    const SQL = await initSqlJs(); const legacy = new SQL.Database();
    legacy.run("CREATE TABLE devices (id INTEGER PRIMARY KEY AUTOINCREMENT, display_name TEXT NOT NULL, udid TEXT NOT NULL UNIQUE, bundle_id TEXT NOT NULL, connection_type TEXT NOT NULL CHECK(connection_type IN ('usb', 'ip')), ip_address TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'unknown', pairing_status TEXT NOT NULL DEFAULT 'unknown', capabilities_json TEXT NOT NULL DEFAULT '[]', wda_local_port INTEGER NOT NULL, last_checked_at TEXT, last_error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, CHECK((connection_type = 'ip') = (ip_address IS NOT NULL)))");
    legacy.run(`INSERT INTO devices (display_name, udid, bundle_id, connection_type, wda_local_port) VALUES ('Old', '${'A'.repeat(40)}', 'net.cloudhms.booking.vinpearl', 'usb', 8100)`);
    fs.writeFileSync(path.join(directory, 'vinpearl.sqlite'), Buffer.from(legacy.export())); legacy.close();
    await initializeDatabase(directory);
    assert.deepEqual([listDevices()[0].iosVersion, listDevices()[0].wdaBundleId], [null, null]);
    const phone = createDevice({ displayName: 'iPhone 7', udid: 'b'.repeat(40), bundleId: 'net.cloudhms.booking.vinpearl' });
    const prepared = updateDeviceWda(phone.id, { iosVersion: '15.8.8', wdaBundleId: 'net.example.WebDriverAgentRunner.xctrunner', wdaExpiresAt: '2026-10-29T09:22:27.000Z' });
    assert.deepEqual([prepared.iosVersion, prepared.wdaBundleId, prepared.wdaExpiresAt], ['15.8.8', 'net.example.WebDriverAgentRunner.xctrunner', '2026-10-29T09:22:27.000Z']);
    assert.ok(prepared.wdaPreparedAt);
    await checkAutoPrepare();
    closeDatabase();
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

// "Kiểm tra" prepares WDA by itself: first check of an iOS < 17 phone, and a profile with less than a day left.
async function checkAutoPrepare() {
  const versions = { ['1'.repeat(40)]: '15.8.8', ['2'.repeat(40)]: '26.6.2' }; const prepared = []; let failPrepare = false;
  const preparer = { iosVersion: async (udid) => { if (!versions[udid]) throw new Error('Device not found'); return versions[udid]; }, prepare: async (device) => { prepared.push(device.udid); if (failPrepare) throw new Error('xcodebuild lỗi'); return { iosVersion: versions[device.udid], wdaBundleId: 'net.example.WebDriverAgentRunner.xctrunner', wdaExpiresAt: new Date(Date.now() + 6 * 86_400_000).toISOString(), message: 'ok' }; } };
  const sessions = []; const engine = { capabilities: ['launchApp'], health: async () => true, forgetDevice: async () => undefined, acquireSession: async (device) => { sessions.push(device); return { id: 's' }; } };
  const jobs = new JobService(engine, 4, preparer);
  const old = createDevice({ displayName: 'iPhone 7', udid: '1'.repeat(40), bundleId: 'net.cloudhms.booking.vinpearl' });
  assert.equal((await jobs.checkDevice(old.id)).deviceReady, true);
  assert.deepEqual(prepared, ['1'.repeat(40)], 'First check of an iOS 15 phone builds and installs WDA.');
  assert.equal(sessions.at(-1).wdaBundleId, 'net.example.WebDriverAgentRunner.xctrunner', 'The session uses the WDA just installed.');
  await jobs.checkDevice(old.id); assert.equal(prepared.length, 1, 'A fresh profile is not re-signed.');
  const modern = createDevice({ displayName: 'iPhone 12', udid: '2'.repeat(40), bundleId: 'net.cloudhms.booking.vinpearl' });
  await jobs.checkDevice(modern.id);
  assert.deepEqual([prepared.length, getDevice(modern.id).iosVersion, getDevice(modern.id).wdaBundleId], [1, '26.6.2', null], 'iOS 17+ only records its version; Appium launches WDA.');
  const unseen = createDevice({ displayName: 'Wi-Fi only', udid: '3'.repeat(40), bundleId: 'net.cloudhms.booking.vinpearl' });
  assert.equal((await jobs.checkDevice(unseen.id)).deviceReady, true, 'A phone go-ios cannot see keeps the Appium path.');
  updateDeviceWda(old.id, { iosVersion: '15.8.8', wdaBundleId: 'net.example.WebDriverAgentRunner.xctrunner', wdaExpiresAt: new Date(Date.now() + 3_600_000).toISOString() });
  failPrepare = true;
  assert.equal((await jobs.checkDevice(old.id)).deviceReady, true, 'A failed re-sign keeps a still-valid profile working.');
  assert.equal(prepared.length, 2);
  failPrepare = false; await jobs.checkDevice(old.id);
  assert.ok(Date.parse(getDevice(old.id).wdaExpiresAt) > Date.now() + 5 * 86_400_000, 'A profile with under a day left is re-signed.');
  updateDeviceWda(old.id, { iosVersion: '15.8.8', wdaBundleId: 'net.example.WebDriverAgentRunner.xctrunner', wdaExpiresAt: new Date(Date.now() - 1_000).toISOString() });
  failPrepare = true;
  const expired = await jobs.checkDevice(old.id);
  assert.equal(expired.deviceReady, false); assert.match(expired.message, /xcodebuild lỗi/, 'An expired profile that cannot be re-signed fails the check.');
}

async function main() {
  assert.deepEqual(['15.8.8', '16.7.10', '17.0', '26.6.2', '', null].map(usesGoIos), [true, true, false, false, false, false]);
  assert.equal(goIosError('{"level":"WARN","msg":"agent"}\n{"level":"ERROR","msg":"Device not found: X","err":"Is it attached?"}\n'), 'Device not found: X: Is it attached?');
  await checkSupervisor(); await checkEngine(); await checkDatabase();
  console.log('wda check ok: go-ios for iOS < 17, runner + forward, auto-restart with give-up, new session after WDA restart, expired profile guard, auto-prepare on health check, WDA columns migration');
}
main().catch((error) => { console.error(error); process.exit(1); });
