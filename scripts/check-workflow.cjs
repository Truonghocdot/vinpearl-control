const { vinClubWorkflow } = require('../dist-electron/src/main/workflow-template.js');
const assert = require('node:assert/strict');
const { runWorkflowPreview, runWorkflowLive } = require('../dist-electron/src/main/workflow-runner.js');
const { runVinClubScript, validateScriptInput } = require('../dist-electron/src/main/automation-script.js');

runWorkflowPreview(vinClubWorkflow).then((run) => {
  if (run.status !== 'stopped') throw new Error(`Expected stopped, received ${run.status}`);
  if (run.logs.length !== vinClubWorkflow.steps.length) throw new Error('Preview did not execute every step.');
  if (run.logs.at(-1)?.type !== 'stop') throw new Error('Preview did not finish at the safe stop.');
  if (run.logs.some((log) => log.message.includes('undefined'))) throw new Error('Template interpolation produced undefined.');
  console.log(`workflow preview ok: ${run.logs.length} steps, status=${run.status}`);
  return runVinClubScript({
    credentialRef: 'check-only',
    paymentPlan: 'VEC-08-25',
    locations: [
      { name: 'Melia Vinpearl Da Nang Riverfront', checkIn: '2026-12-17', checkOut: '2026-12-18', rooms: 1, adults: 1, children: 0, infants: 0 },
      { name: 'Vinpearl Resort Nha Trang', checkIn: '2026-12-20', checkOut: '2026-12-21', rooms: 2, adults: 2, children: 0, infants: 0 },
    ],
  });
}).then((scriptRun) => {
  if (scriptRun.totalLocations !== 2 || scriptRun.completedLocations !== 2) throw new Error('Multi-location script did not complete both locations.');
  if (scriptRun.results[0].workflowId !== 'vinclub-melia-room-search-1') throw new Error('Location workflow id is not stable.');
  if (!scriptRun.results[0].logs.some((log) => log.message.includes('Melia Vinpearl Da Nang Riverfront'))) throw new Error('First hotel was not interpolated.');
  if (!scriptRun.results[1].logs.some((log) => log.message.includes('Vinpearl Resort Nha Trang'))) throw new Error('Second hotel was not interpolated.');
  if (!validateScriptInput({ credentialRef: 'check-only', locations: [{ name: 'A', checkIn: '2026-02-31', checkOut: '2026-03-02', rooms: 1, adults: 1, children: 0, infants: 0 }] }).length) throw new Error('Invalid date was accepted.');
  console.log(`multi-location script ok: ${scriptRun.totalLocations} locations`);
  const workflow = { id: 'redaction-check', version: 1, name: 'Redaction', bundleId: 'com.example.app', variables: { password: 'not-in-a-log' }, steps: [{ type: 'inputText', target: 'Password', value: '{{password}}', secret: true }] };
  return runWorkflowLive(workflow, { capabilities: ['inputText'], execute: async (_session, _step, variables) => { throw new Error(`server echoed ${variables.password}`); } }, { id: 'session' });
}).then((failedRun) => {
  assert.equal(failedRun.status, 'failed');
  assert.ok(!failedRun.logs[0].message.includes('not-in-a-log'));
  assert.match(failedRun.logs[0].message, /\[redacted\]/);
  const controller = new AbortController(); controller.abort();
  return runWorkflowLive({ id: 'cancel-check', version: 1, name: 'Cancel', bundleId: 'com.example.app', variables: {}, steps: [{ type: 'launchApp' }] }, { capabilities: ['launchApp'], execute: async () => undefined }, { id: 'session' }, { signal: controller.signal });
}).then((cancelledRun) => {
  assert.equal(cancelledRun.status, 'cancelled');
  console.log('workflow runtime check ok: redaction and cancellation');
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
