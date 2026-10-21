export type Device = {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  status: 'unknown' | 'online' | 'offline';
  lastCheckedAt: string | null;
};

export type DesktopApi = {
  getAppInfo: () => Promise<{ name: string; version: string; platform: string }>;
  listDevices: () => Promise<Device[]>;
  createDevice: (input: {
    name: string;
    host: string;
    port: number;
    username: string;
  }) => Promise<Device>;
  listWorkflows: () => Promise<WorkflowSummary[]>;
  getWorkflow: (workflowId: string) => Promise<WorkflowDefinition>;
  runWorkflowPreview: (workflowId: string) => Promise<WorkflowRun>;
  runVinClubScript: (input: VinClubScriptInput) => Promise<VinClubScriptResult>;
  probeSsh: (input: { target: SshTarget; auth: SshAuth }) => Promise<SshProbeResponse>;
  runSshCommand: (input: { target: SshTarget; auth: SshAuth; command: string }) => Promise<SshCommandResponse>;
};

export type WorkflowStep = {
  type: string;
  name?: string;
};

export type WorkflowDefinition = {
  id: string;
  version: number;
  name: string;
  description?: string;
  variables: Record<string, unknown>;
  steps: WorkflowStep[];
};

export type WorkflowSummary = {
  id: string;
  name: string;
  version: number;
  description?: string;
  stepCount: number;
};

export type WorkflowLog = {
  step: number;
  name: string;
  type: string;
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

export type SshTarget = {
  host: string;
  port: number;
  username: string;
  hostFingerprint?: string;
};

export type SshAuth = {
  privateKey?: string;
  passphrase?: string;
  password?: string;
};

export type SshCommandResult = {
  stdout: string;
  stderr: string;
  code: number | null;
  signal?: string;
  fingerprint: string;
  durationMs: number;
};

export type SshProbeResult = SshCommandResult & {
  rootless: boolean;
  sshServer: 'openssh' | 'dropbear' | 'unknown';
};

export type SshHostUntrustedResponse = {
  status: 'host-untrusted';
  fingerprint: string;
};

export type SshProbeResponse =
  | { status: 'ok'; result: SshProbeResult }
  | SshHostUntrustedResponse;

export type SshCommandResponse =
  | { status: 'ok'; result: SshCommandResult }
  | SshHostUntrustedResponse;
