const { vinClubWorkflow } = require('../dist-electron/src/main/workflow-template.js');
const assert = require('node:assert/strict');
const { runWorkflowPreview, runWorkflowLive } = require('../dist-electron/src/main/workflow-runner.js');

runWorkflowPreview(vinClubWorkflow).then((run) => {
  if (run.status !== 'stopped') throw new Error(`Expected stopped, received ${run.status}`);
  if (run.logs.length !== vinClubWorkflow.steps.length) throw new Error('Preview did not execute every step.');
  if (run.logs.at(-1)?.type !== 'stop') throw new Error('Preview did not finish at the safe stop.');
  assert.equal(vinClubWorkflow.steps.at(-2)?.text, 'Xác nhận thanh toán');
  assert.equal(vinClubWorkflow.variables.paymentYear, 2027);
  assert.equal(vinClubWorkflow.variables.roomType, 'Deluxe Twin');
  assert.ok(vinClubWorkflow.steps.some((step) => step.text === 'Năm {{paymentYear}}'), 'Payment year must match the visible year section.');
  assert.ok(!Object.hasOwn(vinClubWorkflow.variables, 'paymentPlan'), 'Payment must be selected by year, not plan code.');
  assert.ok(!vinClubWorkflow.steps.some((step) => step.type === 'tapText' && step.text === 'Xác nhận'), 'Final confirmation must never be pressed.');
  const tapByName = (name) => vinClubWorkflow.steps.find((step) => step.type === 'tapText' && step.name === name);
  assert.match(tapByName('Chọn mã căn của năm thanh toán').xpath, /Năm \{\{paymentYear\}\}.*following-sibling::XCUIElementTypeCell\[1\]/, 'Payment year must tap the owner-code cell, not the year header.');
  assert.match(tapByName('Chọn phòng theo loại phòng input').xpath, /@name='\{\{roomType\}\}'/, 'Room selection must be scoped to roomType.');
  assert.match(tapByName('Mở xác nhận thanh toán').xpath, /XCUIElementTypeButton\[@name='Thanh toán'\]/, 'Payment must target the button, not the progress label.');
  assert.ok(vinClubWorkflow.steps.some((step) => step.xpath?.includes("@name='Thanh toán' and @enabled='true'")), 'Terms acceptance must be verified by the enabled payment button.');
  if (run.logs.some((log) => log.message.includes('undefined'))) throw new Error('Template interpolation produced undefined.');
  if (run.logs.some((log) => log.durationMs === undefined)) throw new Error('Preview did not capture per-step duration.');
  console.log(`booking preview ok: ${run.logs.length} steps, status=${run.status}`);
  return runWorkflowLive({ id: 'diagnostic-check', version: 1, name: 'Diagnostic', bundleId: 'com.example.app', variables: {}, steps: [{ type: 'launchApp' }, { type: 'stop' }] }, { capabilities: ['launchApp'], execute: async () => undefined, screenshot: async () => 'aGVsbG8=', pageSource: async () => '<AppiumAUT />' }, { id: 'session' }, { captureEveryStep: true });
}).then((diagnosticRun) => {
  assert.equal(diagnosticRun.status, 'stopped');
  assert.equal(diagnosticRun.logs.length, 2);
  assert.equal(diagnosticRun.logs[0].screenshot, 'aGVsbG8=');
  assert.equal(diagnosticRun.logs[0].hierarchy, undefined, 'Successful steps must skip the slow UI tree capture.');
  const workflow = { id: 'redaction-check', version: 1, name: 'Redaction', bundleId: 'com.example.app', variables: { password: 'not-in-a-log' }, steps: [{ type: 'inputText', target: 'Password', value: '{{password}}', secret: true }] };
  return runWorkflowLive(workflow, { capabilities: ['inputText'], execute: async (_session, _step, variables) => { throw new Error(`server echoed ${variables.password}`); }, screenshot: async () => 'aGVsbG8=', pageSource: async () => '<AppiumAUT />' }, { id: 'session' });
}).then((failedRun) => {
  assert.equal(failedRun.status, 'failed');
  assert.equal(failedRun.logs[0].hierarchy, '<AppiumAUT />', 'Failed steps must keep the UI tree for debugging.');
  assert.ok(!failedRun.logs[0].message.includes('not-in-a-log'));
  assert.match(failedRun.logs[0].message, /\[redacted\]/);
  const controller = new AbortController(); controller.abort();
  return runWorkflowLive({ id: 'cancel-check', version: 1, name: 'Cancel', bundleId: 'com.example.app', variables: {}, steps: [{ type: 'launchApp' }] }, { capabilities: ['launchApp'], execute: async () => undefined }, { id: 'session' }, { signal: controller.signal });
}).then((cancelledRun) => {
  assert.equal(cancelledRun.status, 'cancelled');
  console.log('booking runtime check ok: redaction and cancellation');
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
