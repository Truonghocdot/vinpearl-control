import { contextBridge, ipcRenderer } from 'electron';
import type { Account, AccountInput, Campaign, CampaignInput, Device, DeviceInput, JobRunSummary } from '../main/database';
import type { DeviceHealth } from '../main/job-service';
import type { WorkflowDefinition, WorkflowRun, WorkflowSummary } from '../main/workflow-runner';
import type { VinClubScriptInput, VinClubScriptResult } from '../main/automation-script';

contextBridge.exposeInMainWorld('desktopApi', {
  getAppInfo: (): Promise<{ name: string; version: string; platform: string; appiumPort: number }> => ipcRenderer.invoke('app:get-info'),
  listDevices: (): Promise<Device[]> => ipcRenderer.invoke('devices:list'),
  createDevice: (input: DeviceInput): Promise<Device> => ipcRenderer.invoke('devices:create', input),
  updateDevice: (input: { id: number; device: DeviceInput }): Promise<Device> => ipcRenderer.invoke('devices:update', input),
  checkDevice: (deviceId: number): Promise<DeviceHealth> => ipcRenderer.invoke('devices:check', deviceId),
  listAccounts: (): Promise<Account[]> => ipcRenderer.invoke('accounts:list'),
  createAccount: (input: AccountInput & { password: string }): Promise<Account> => ipcRenderer.invoke('accounts:create', input),
  updateAccount: (input: { id: number; account: AccountInput; password?: string }): Promise<Account> => ipcRenderer.invoke('accounts:update', input),
  setAccountStatus: (input: { id: number; status: 'active' | 'disabled' }): Promise<Account> => ipcRenderer.invoke('accounts:set-status', input),
  listWorkflows: (): Promise<WorkflowSummary[]> => ipcRenderer.invoke('workflows:list'),
  getWorkflow: (workflowId: string): Promise<WorkflowDefinition> => ipcRenderer.invoke('workflows:get', workflowId),
  runWorkflowPreview: (workflowId: string): Promise<Omit<WorkflowRun, 'id'>> => ipcRenderer.invoke('workflows:run-preview', workflowId),
  listCampaigns: (): Promise<Campaign[]> => ipcRenderer.invoke('campaigns:list'),
  createCampaign: (input: CampaignInput): Promise<Campaign> => ipcRenderer.invoke('campaigns:create', input),
  updateCampaign: (input: { id: number; campaign: CampaignInput }): Promise<Campaign> => ipcRenderer.invoke('campaigns:update', input),
  runCampaign: (campaignId: number): Promise<WorkflowRun[]> => ipcRenderer.invoke('campaigns:run', campaignId),
  listJobRuns: (): Promise<JobRunSummary[]> => ipcRenderer.invoke('jobs:list'),
  cancelJob: (deviceId: number): Promise<boolean> => ipcRenderer.invoke('jobs:cancel', deviceId),
  runVinClubScript: (input: VinClubScriptInput): Promise<VinClubScriptResult> => ipcRenderer.invoke('scripts:run-vinclub-preview', input),
});
