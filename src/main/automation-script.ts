import { runWorkflowPreview, type WorkflowDefinition, type WorkflowLog, type WorkflowRun } from './workflow-runner';
import { vinClubWorkflow } from './workflow-template';

export type LocationInput = {
  name: string;
  checkIn: string;
  checkOut: string;
  rooms: number;
  adults: number;
  children: number;
  infants: number;
};

export type VinClubScriptInput = {
  credentialRef?: string;
  username?: string;
  paymentPlan?: string;
  locations: LocationInput[];
};

export type ScriptLocationResult = {
  location: LocationInput;
  workflowId: string;
  status: WorkflowRun['status'];
  logs: WorkflowLog[];
};

export type VinClubScriptResult = {
  status: 'succeeded' | 'failed';
  totalLocations: number;
  completedLocations: number;
  failedLocations: number;
  results: ScriptLocationResult[];
};

export function validateScriptInput(input: VinClubScriptInput): string[] {
  const errors: string[] = [];
  if (!input || !Array.isArray(input.locations)) return ['Input script phải có danh sách locations.'];
  const credentialRef = typeof input.credentialRef === 'string' ? input.credentialRef : '';
  const username = typeof input.username === 'string' ? input.username : '';
  if (!credentialRef.trim() && !username.trim()) {
    errors.push('Cần credentialRef hoặc username để chạy script.');
  }
  if (input.paymentPlan !== undefined && typeof input.paymentPlan !== 'string') errors.push('Mã thanh toán phải là chuỗi.');
  if (!input.locations.length) errors.push('Cần ít nhất một địa điểm.');
  if (input.locations.length > 50) errors.push('Tối đa 50 địa điểm trong một lần chạy.');

  input.locations.forEach((location, index) => {
    const label = `Địa điểm ${index + 1}`;
    if (!location || typeof location.name !== 'string' || !location.name.trim()) {
      errors.push(`${label}: thiếu tên khách sạn.`);
      return;
    }
    if (!isIsoDate(location.checkIn) || !isIsoDate(location.checkOut)) errors.push(`${label}: ngày phải có dạng YYYY-MM-DD.`);
    if (isIsoDate(location.checkIn) && isIsoDate(location.checkOut) && location.checkOut <= location.checkIn) {
      errors.push(`${label}: checkOut phải sau checkIn.`);
    }
    if (!Number.isInteger(location.rooms) || location.rooms < 1 || location.rooms > 20) errors.push(`${label}: số phòng phải từ 1 đến 20.`);
    if (!Number.isInteger(location.adults) || location.adults < 1 || location.adults > 50) errors.push(`${label}: số người lớn phải từ 1 đến 50.`);
    if (!Number.isInteger(location.children) || location.children < 0 || location.children > 50) errors.push(`${label}: số trẻ em không hợp lệ.`);
    if (!Number.isInteger(location.infants) || location.infants < 0 || location.infants > 50) errors.push(`${label}: số em bé không hợp lệ.`);
  });
  return errors;
}

export function createLocationWorkflow(
  input: VinClubScriptInput,
  location: LocationInput,
  index: number,
): WorkflowDefinition {
  const workflowId = `${vinClubWorkflow.id}-${index + 1}`;
  return {
    ...vinClubWorkflow,
    id: workflowId,
    name: `${vinClubWorkflow.name} · ${location.name}`,
    variables: {
      ...vinClubWorkflow.variables,
      username: input.username ?? { secret: false },
      credentialRef: input.credentialRef ?? '',
      hotel: location.name,
      paymentPlan: input.paymentPlan ?? vinClubWorkflow.variables.paymentPlan,
      checkIn: location.checkIn,
      checkOut: location.checkOut,
      rooms: location.rooms,
      adults: location.adults,
      children: location.children,
      infants: location.infants,
    },
  };
}

export async function runVinClubScript(
  input: VinClubScriptInput,
  onLocation?: (result: ScriptLocationResult) => void,
): Promise<VinClubScriptResult> {
  const validationErrors = validateScriptInput(input);
  if (validationErrors.length) throw new Error(validationErrors.join(' '));

  const results: ScriptLocationResult[] = [];
  for (const [index, location] of input.locations.entries()) {
    const workflow = createLocationWorkflow(input, location, index);
    const run = await runWorkflowPreview(workflow);
    const result: ScriptLocationResult = {
      location,
      workflowId: workflow.id,
      status: run.status,
      logs: run.logs,
    };
    results.push(result);
    onLocation?.(result);
  }

  const failedLocations = results.filter((result) => result.status === 'failed').length;
  return {
    status: failedLocations ? 'failed' : 'succeeded',
    totalLocations: results.length,
    completedLocations: results.filter((result) => result.status !== 'failed').length,
    failedLocations,
    results,
  };
}

function isIsoDate(value: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
