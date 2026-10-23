const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { initializeDatabase, createAccount, createCampaign, createDevice, closeDatabase, getJobRun, listCampaigns, listDevices, readJobArtifact, updateDeviceHealth } = require('../dist-electron/src/main/database.js');
const { MemoryCredentialStore } = require('../dist-electron/src/main/keychain.js');
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
    assert.equal(listDevices().length, 3);
    assert.throws(() => createDevice({ displayName: 'Invalid', udid: 'bad', bundleId: 'net.cloudhms.booking.vinpearl' }));
    const firstAccount = createAccount({ displayName: 'Account A', username: 'a@example.test', credentialRef: 'test-a' });
    const secondAccount = createAccount({ displayName: 'Account B', username: 'b@example.test', credentialRef: 'test-b' });
    const campaign = createCampaign({ name: 'Campaign A', inputs: { ...vinClubWorkflow.variables, hotel: 'Test hotel' }, status: 'active', targets: [{ deviceId: first.id, accountId: firstAccount.id }, { deviceId: second.id, accountId: secondAccount.id }] });
    assert.equal(campaign.targets.length, 2);
    assert.equal(listCampaigns().length, 1);
    assert.throws(() => createCampaign({ name: 'Duplicate device', inputs: { ...vinClubWorkflow.variables }, targets: [{ deviceId: first.id, accountId: firstAccount.id }, { deviceId: first.id, accountId: secondAccount.id }] }));
    assert.throws(() => createCampaign({ name: 'Secret campaign', inputs: { ...vinClubWorkflow.variables, password: 'forbidden' }, targets: [{ deviceId: first.id, accountId: firstAccount.id }] }));
    assert.throws(() => createCampaign({ name: 'Missing payment year', inputs: { ...vinClubWorkflow.variables, paymentYear: undefined }, targets: [{ deviceId: first.id, accountId: firstAccount.id }] }));
    assert.throws(() => createCampaign({ name: 'Missing room type', inputs: { ...vinClubWorkflow.variables, roomType: '' }, targets: [{ deviceId: first.id, accountId: firstAccount.id }] }));
    const credentials = new MemoryCredentialStore();
    await credentials.set('test', { username: 'operator', password: 'secret' });
    assert.deepEqual(await credentials.get('test'), { username: 'operator', password: 'secret' });
    await credentials.set(firstAccount.credentialRef, { username: firstAccount.username, password: 'secret' });
    const capabilities = [...new Set(vinClubWorkflow.steps.filter((step) => step.type !== 'stop').map((step) => step.type))];
    updateDeviceHealth(first.id, { status: 'ready', pairingStatus: 'paired', capabilities });
    const testCampaign = createCampaign({ name: 'Draft test', inputs: { ...vinClubWorkflow.variables }, status: 'draft', targets: [{ deviceId: first.id, accountId: firstAccount.id }] });
    const fakeEngine = { capabilities, health: async () => true, createSession: async () => ({ id: 'test-session' }), close: async () => undefined, execute: async () => undefined, screenshot: async () => 'aGVsbG8=', pageSource: async () => '<AppiumAUT />' };
    const testRuns = await new JobService(fakeEngine, credentials).runCampaign(testCampaign.id);
    assert.equal(testRuns[0].status, 'stopped');
    assert.ok(testRuns[0].logs.every((log) => log.screenshot && !log.hierarchy), 'Draft runs keep a screenshot per step and the UI tree only for failures.');
    assert.equal(getJobRun(testRuns[0].id).logs.length, testRuns[0].logs.length);
    assert.equal(readJobArtifact(testRuns[0].id, 1, 'screenshot').content, 'aGVsbG8=');
    assert.throws(() => readJobArtifact(testRuns[0].id, 1, 'hierarchy'), /chưa có artifact/);
    closeDatabase();
    assert.ok(fs.readdirSync(directory).some((file) => file.startsWith('vinpearl-ssh-archive-')));
    console.log('database check ok: legacy archive, independent devices/accounts, draft safe-stop, campaign targets and WDA ports');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
main().catch((error) => { console.error(error); process.exit(1); });
