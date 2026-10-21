export const workflowActionTypes = [
  'launchApp',
  'waitForText',
  'tapText',
  'inputText',
  'selectDate',
  'selectGuests',
  'assertText',
  'sshCommand',
  'stop',
] as const;

export type WorkflowActionType = typeof workflowActionTypes[number];

export type WorkflowStep = {
  type: WorkflowActionType;
  name?: string;
  text?: string;
  target?: string;
  value?: string;
  secret?: boolean;
  timeoutMs?: number;
  checkIn?: string;
  checkOut?: string;
  rooms?: number | string;
  adults?: number | string;
  children?: number | string;
  infants?: number | string;
  reason?: string;
  command?: string;
  maxOutputBytes?: number;
};

export type WorkflowDefinition = {
  id: string;
  version: number;
  name: string;
  description?: string;
  variables: Record<string, unknown>;
  steps: WorkflowStep[];
};

export type WorkflowSummary = Pick<WorkflowDefinition, 'id' | 'version' | 'name' | 'description'> & {
  stepCount: number;
};

export type WorkflowLog = {
  step: number;
  name: string;
  type: WorkflowActionType;
  status: 'running' | 'succeeded' | 'stopped' | 'failed';
  message: string;
  at: string;
};

export type WorkflowRun = {
  id: number;
  workflowId: string;
  status: 'succeeded' | 'failed' | 'stopped';
  startedAt: string;
  finishedAt: string;
  logs: WorkflowLog[];
};

export function validateWorkflow(workflow: WorkflowDefinition): string[] {
  const errors: string[] = [];
  if (!workflow.id.trim()) errors.push('Workflow thiếu id.');
  if (!workflow.name.trim()) errors.push('Workflow thiếu tên.');
  if (!workflow.steps.length) errors.push('Workflow phải có ít nhất một step.');

  workflow.steps.forEach((step, index) => {
    const label = `Step ${index + 1}`;
    if (!workflowActionTypes.includes(step.type)) errors.push(`${label}: action không được hỗ trợ.`);
    if (step.type === 'waitForText' || step.type === 'assertText' || step.type === 'tapText') {
      if (!step.text?.trim()) errors.push(`${label}: thiếu text selector.`);
    }
    if (step.type === 'inputText' && (!step.target?.trim() || step.value === undefined)) {
      errors.push(`${label}: inputText cần target và value.`);
    }
    if (step.type === 'selectDate' && (!step.checkIn || !step.checkOut)) {
      errors.push(`${label}: selectDate cần checkIn và checkOut.`);
    }
    if (step.type === 'selectGuests' && (step.rooms === undefined || step.adults === undefined)) {
      errors.push(`${label}: selectGuests cần rooms và adults.`);
    }
    if (step.type === 'sshCommand' && !step.command?.trim()) errors.push(`${label}: sshCommand cần command.`);
  });
  return errors;
}

function interpolate(value: unknown, variables: Record<string, unknown>): string {
  return String(value ?? '').replace(/\{\{([\w.-]+)\}\}/g, (_match, key: string) => {
    const variable = variables[key];
    if (variable && typeof variable === 'object' && 'secret' in variable) return '[secret]';
    return String(variable ?? '');
  });
}

function describeStep(step: WorkflowStep, variables: Record<string, unknown>): string {
  switch (step.type) {
    case 'launchApp': return 'Mô phỏng mở ứng dụng VinClub.';
    case 'waitForText': return `Mô phỏng chờ text “${interpolate(step.text, variables)}”.`;
    case 'tapText': return `Mô phỏng chạm text “${interpolate(step.text, variables)}”.`;
    case 'inputText': return `Mô phỏng nhập ${step.secret ? '[secret]' : `“${interpolate(step.value, variables)}”`} vào “${step.target}”.`;
    case 'selectDate': return `Mô phỏng chọn ${interpolate(step.checkIn, variables)} đến ${interpolate(step.checkOut, variables)}.`;
    case 'selectGuests': return `Mô phỏng chọn ${interpolate(step.rooms, variables)} phòng, ${interpolate(step.adults, variables)} người lớn.`;
    case 'assertText': return `Mô phỏng kiểm tra text “${interpolate(step.text, variables)}”.`;
    case 'sshCommand': return `Mô phỏng SSH exec: ${step.command ?? ''}`;
    case 'stop': return step.reason ?? 'Workflow dừng theo cấu hình.';
  }
}

export async function runWorkflowPreview(
  workflow: WorkflowDefinition,
  onLog?: (log: WorkflowLog) => void,
): Promise<Omit<WorkflowRun, 'id'>> {
  const errors = validateWorkflow(workflow);
  const startedAt = new Date().toISOString();
  if (errors.length) {
    const finishedAt = new Date().toISOString();
    const log: WorkflowLog = {
      step: 0,
      name: 'Validate workflow',
      type: 'stop',
      status: 'failed',
      message: errors.join(' '),
      at: finishedAt,
    };
    onLog?.(log);
    return { workflowId: workflow.id, status: 'failed', startedAt, finishedAt, logs: [log] };
  }

  const logs: WorkflowLog[] = [];
  for (const [index, step] of workflow.steps.entries()) {
    const at = new Date().toISOString();
    const stopped = step.type === 'stop';
    const log: WorkflowLog = {
      step: index + 1,
      name: step.name ?? step.type,
      type: step.type,
      status: stopped ? 'stopped' : 'succeeded',
      message: describeStep(step, workflow.variables),
      at,
    };
    logs.push(log);
    onLog?.(log);
    if (stopped) {
      const finishedAt = new Date().toISOString();
      return { workflowId: workflow.id, status: 'stopped', startedAt, finishedAt, logs };
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }

  const finishedAt = new Date().toISOString();
  return { workflowId: workflow.id, status: 'succeeded', startedAt, finishedAt, logs };
}
