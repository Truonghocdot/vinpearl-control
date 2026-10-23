export const workflowActionTypes = ['launchApp', 'ensureHome', 'waitForText', 'tapText', 'inputText', 'selectDate', 'selectGuests', 'assertText', 'screenshot', 'stop'] as const;
export type WorkflowActionType = typeof workflowActionTypes[number];
export type WorkflowStep = { type: WorkflowActionType; name?: string; text?: string; target?: string; accessibilityId?: string; xpath?: string; predicate?: string; classChain?: string; scrollContainer?: string; tapCenter?: boolean; until?: string; value?: string; secret?: boolean; timeoutMs?: number; checkIn?: string; checkOut?: string; rooms?: number | string; adults?: number | string; children?: number | string; infants?: number | string; reason?: string };
export type WorkflowDefinition = { id: string; version: number; name: string; description?: string; bundleId: string; variables: Record<string, unknown>; steps: WorkflowStep[] };
export type WorkflowSummary = Pick<WorkflowDefinition, 'id' | 'version' | 'name' | 'description' | 'bundleId'> & { stepCount: number };
export type WorkflowLog = { step: number; name: string; type: WorkflowActionType; status: 'running' | 'succeeded' | 'stopped' | 'failed'; message: string; at: string; durationMs?: number; screenshot?: string; hierarchy?: string };
export type WorkflowRun = { id: number; workflowId: string; deviceId?: number; accountId?: number; campaignId?: number; engine: 'preview' | 'appium'; status: 'succeeded' | 'failed' | 'stopped' | 'cancelled'; startedAt: string; finishedAt: string; logs: WorkflowLog[] };
export type AutomationSession = { id: string };
export interface WorkflowEngine { readonly capabilities: readonly string[]; execute(session: AutomationSession, step: WorkflowStep, variables: Record<string, unknown>): Promise<unknown>; screenshot?(session: AutomationSession): Promise<string>; pageSource?(session: AutomationSession): Promise<string>; }

export function validateWorkflow(workflow: WorkflowDefinition): string[] {
  const errors: string[] = [];
  if (!workflow.id?.trim()) errors.push('Kịch bản booking thiếu id.'); if (!workflow.name?.trim()) errors.push('Kịch bản booking thiếu tên.'); if (!workflow.bundleId?.trim()) errors.push('Kịch bản booking thiếu bundleId.'); if (!workflow.steps?.length) errors.push('Kịch bản booking phải có ít nhất một step.');
  workflow.steps?.forEach((step, index) => { const label = `Step ${index + 1}`; const hasSelector = Boolean(step.text?.trim() || step.target?.trim() || step.accessibilityId?.trim() || step.xpath?.trim() || step.predicate?.trim() || step.classChain?.trim()); if (!workflowActionTypes.includes(step.type)) errors.push(`${label}: action không được hỗ trợ.`); if (['waitForText', 'assertText', 'tapText'].includes(step.type) && !hasSelector) errors.push(`${label}: thiếu selector.`); if (step.type === 'inputText' && (!hasSelector || step.value === undefined)) errors.push(`${label}: inputText cần selector/value.`); if (step.type === 'selectDate' && (!step.checkIn || !step.checkOut)) errors.push(`${label}: selectDate cần checkIn và checkOut.`); if (step.type === 'selectGuests' && (step.rooms === undefined || step.adults === undefined)) errors.push(`${label}: selectGuests cần rooms và adults.`); }); return errors;
}

export async function runWorkflowPreview(workflow: WorkflowDefinition, onLog?: (log: WorkflowLog) => void): Promise<Omit<WorkflowRun, 'id'>> {
  const startedAt = new Date().toISOString(); const errors = validateWorkflow(workflow);
  if (errors.length) { const log: WorkflowLog = { step: 0, name: 'Kiểm tra kịch bản booking', type: 'stop', status: 'failed', message: errors.join(' '), at: new Date().toISOString(), durationMs: 0 }; onLog?.(log); return { workflowId: workflow.id, engine: 'preview', status: 'failed', startedAt, finishedAt: log.at, logs: [log] }; }
  const logs: WorkflowLog[] = [];
  for (const [index, step] of workflow.steps.entries()) {
    const stepStartedAt = Date.now();
    const log: WorkflowLog = { step: index + 1, name: step.name ?? step.type, type: step.type, status: step.type === 'stop' ? 'stopped' : 'succeeded', message: describeStep(step, workflow.variables), at: new Date().toISOString() };
    if (step.type !== 'stop') await new Promise((resolve) => setTimeout(resolve, 10));
    log.durationMs = Date.now() - stepStartedAt; logs.push(log); onLog?.(log);
    if (step.type === 'stop') return { workflowId: workflow.id, engine: 'preview', status: 'stopped', startedAt, finishedAt: new Date().toISOString(), logs };
  }
  return { workflowId: workflow.id, engine: 'preview', status: 'succeeded', startedAt, finishedAt: new Date().toISOString(), logs };
}

export async function runWorkflowLive(workflow: WorkflowDefinition, engine: WorkflowEngine, session: AutomationSession, options: { deviceId?: number; accountId?: number; campaignId?: number; signal?: AbortSignal; onLog?: (log: WorkflowLog) => void; captureEveryStep?: boolean } = {}): Promise<Omit<WorkflowRun, 'id'>> {
  const metadata = { deviceId: options.deviceId, accountId: options.accountId, campaignId: options.campaignId };
  const startedAt = new Date().toISOString(); const errors = validateWorkflow(workflow); const logs: WorkflowLog[] = [];
  if (errors.length) return { workflowId: workflow.id, ...metadata, engine: 'appium', status: 'failed', startedAt, finishedAt: new Date().toISOString(), logs: [{ step: 0, name: 'Kiểm tra kịch bản booking', type: 'stop', status: 'failed', message: errors.join(' '), at: new Date().toISOString(), durationMs: 0 }] };
  const unsupported = workflow.steps.find((step) => !['stop', ...engine.capabilities].includes(step.type)); if (unsupported) throw new Error(`Engine không hỗ trợ action ${unsupported.type}.`);
  try {
    for (const [index, step] of workflow.steps.entries()) {
      if (options.signal?.aborted) throw new Error('Kịch bản booking đã bị hủy.');
      const stepStartedAt = Date.now();
      const log: WorkflowLog = { step: index + 1, name: step.name ?? step.type, type: step.type, status: step.type === 'stop' ? 'stopped' : 'running', message: step.type === 'stop' ? (step.reason ?? 'Workflow dừng an toàn.') : `Đang thực thi ${step.type}.`, at: new Date().toISOString() };
      try {
        // The grace period lets the engine's own wait fail first with a selector-specific message.
        if (step.type !== 'stop') await withTimeout(engine.execute(session, step, workflow.variables), (step.timeoutMs ?? 25_000) + 5_000);
        log.status = step.type === 'stop' ? 'stopped' : 'succeeded'; log.message = describeStep(step, workflow.variables); log.durationMs = Date.now() - stepStartedAt;
        // Successful steps keep only a screenshot: a full UI tree costs ~1s per step on device.
        if (options.captureEveryStep) await captureDiagnosticArtifacts(engine, session, log, false);
      } catch (error) {
        log.status = 'failed'; log.durationMs = Date.now() - stepStartedAt; log.message = redact(error instanceof Error ? error.message : 'Automation failed', secretValues(workflow.variables));
        await captureDiagnosticArtifacts(engine, session, log);
        logs.push(log); options.onLog?.(log); throw error;
      }
      logs.push(log); options.onLog?.(log);
      if (step.type === 'stop') return { workflowId: workflow.id, ...metadata, engine: 'appium', status: 'stopped', startedAt, finishedAt: new Date().toISOString(), logs };
    }
    return { workflowId: workflow.id, ...metadata, engine: 'appium', status: 'succeeded', startedAt, finishedAt: new Date().toISOString(), logs };
  } catch { return { workflowId: workflow.id, ...metadata, engine: 'appium', status: options.signal?.aborted ? 'cancelled' : 'failed', startedAt, finishedAt: new Date().toISOString(), logs }; }
}

async function captureDiagnosticArtifacts(engine: WorkflowEngine, session: AutomationSession, log: WorkflowLog, includeHierarchy = true) {
  if (engine.screenshot) { try { log.screenshot = await engine.screenshot(session); } catch { /* best effort */ } }
  if (includeHierarchy && engine.pageSource) { try { log.hierarchy = await engine.pageSource(session); } catch { /* best effort */ } }
}

function describeStep(step: WorkflowStep, variables: Record<string, unknown>) { const value = (input: unknown) => String(input ?? '').replace(/\{\{([\w.-]+)\}\}/g, (_m, key: string) => { const variable = variables[key]; return variable && typeof variable === 'object' && 'secret' in variable ? '[secret]' : String(variable ?? ''); }); switch (step.type) { case 'launchApp': return 'Mở ứng dụng VinClub.'; case 'ensureHome': return 'Kiểm tra phiên đăng nhập và mở trang chủ.'; case 'waitForText': return `Chờ text “${value(step.text ?? step.accessibilityId)}”.`; case 'tapText': return `Chạm “${value(step.text ?? step.accessibilityId)}”.`; case 'inputText': return `Nhập ${step.secret ? '[secret]' : `“${value(step.value)}”`} vào “${value(step.target ?? step.accessibilityId)}”.`; case 'selectDate': return `Chọn ${value(step.checkIn)} đến ${value(step.checkOut)}.`; case 'selectGuests': return `Chọn ${value(step.rooms)} phòng, ${value(step.adults)} người lớn.`; case 'assertText': return `Kiểm tra “${value(step.text ?? step.accessibilityId)}”.`; case 'screenshot': return 'Chụp màn hình.'; case 'stop': return step.reason ?? 'Kịch bản booking dừng an toàn.'; } }
function secretValues(variables: Record<string, unknown>) { return Object.entries(variables).filter(([key, value]) => /password|secret/i.test(key) && typeof value === 'string').map(([, value]) => String(value)); }
function redact(message: string, values: string[] = []) { return values.reduce((result, value) => value ? result.split(value).join('[redacted]') : result, message.replace(/password|secret/gi, '[redacted]')); }
function withTimeout<T>(promise: Promise<T>, timeoutMs: number) { return new Promise<T>((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`Step timeout sau ${timeoutMs}ms.`)), timeoutMs); promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); }); }); }
