const { vinClubWorkflow } = require('../dist-electron/src/main/workflow-template.js');
const { runWorkflowPreview } = require('../dist-electron/src/main/workflow-runner.js');
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
  if (!validateScriptInput({ username: 'test', locations: [{ name: 'A', checkIn: '2026-02-31', checkOut: '2026-03-02', rooms: 1, adults: 1, children: 0, infants: 0 }] }).length) throw new Error('Invalid date was accepted.');
  console.log(`multi-location script ok: ${scriptRun.totalLocations} locations`);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
