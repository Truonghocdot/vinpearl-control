import { contextBridge, ipcRenderer } from 'electron';
import type { WorkflowDefinition, WorkflowRun, WorkflowSummary } from '../main/workflow-runner';
import type { VinClubScriptInput, VinClubScriptResult } from '../main/automation-script';
import type { SshAuth, SshCommandResult, SshProbeResult, SshTarget } from '../main/ssh/ssh-service';

type SshHostUntrustedResponse = { status: 'host-untrusted'; fingerprint: string };
type SshProbeResponse = { status: 'ok'; result: SshProbeResult } | SshHostUntrustedResponse;
type SshCommandResponse = { status: 'ok'; result: SshCommandResult } | SshHostUntrustedResponse;

contextBridge.exposeInMainWorld('desktopApi', {
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
  listDevices: () => ipcRenderer.invoke('devices:list'),
  createDevice: (input: {
    name: string;
    host: string;
    port: number;
    username: string;
  }) => ipcRenderer.invoke('devices:create', input),
  listWorkflows: (): Promise<WorkflowSummary[]> => ipcRenderer.invoke('workflows:list'),
  getWorkflow: (workflowId: string): Promise<WorkflowDefinition> => ipcRenderer.invoke('workflows:get', workflowId),
  runWorkflowPreview: (workflowId: string): Promise<WorkflowRun> => ipcRenderer.invoke('workflows:run-preview', workflowId),
  runVinClubScript: (input: VinClubScriptInput): Promise<VinClubScriptResult> => ipcRenderer.invoke('scripts:run-vinclub', input),
  probeSsh: (input: { target: SshTarget; auth: SshAuth }): Promise<SshProbeResponse> => ipcRenderer.invoke('ssh:probe', input),
  runSshCommand: (input: { target: SshTarget; auth: SshAuth; command: string }): Promise<SshCommandResponse> => ipcRenderer.invoke('ssh:command', input),
});
