import { contextBridge, ipcRenderer } from 'electron';
import type { Campaign, CampaignInput, Device, DeviceInput, JobArtifact, JobRunSummary, UiHierarchyCapture } from '../main/database';
import type { DeviceHealth } from '../main/job-service';
import type { WorkflowRun } from '../main/workflow-runner';

contextBridge.exposeInMainWorld('desktopApi', {
  getAppInfo: (): Promise<{ name: string; version: string; platform: string; appiumPort: number }> => ipcRenderer.invoke('app:get-info'),
  listDevices: (): Promise<Device[]> => ipcRenderer.invoke('devices:list'),
  createDevice: (input: DeviceInput): Promise<Device> => ipcRenderer.invoke('devices:create', input),
  updateDevice: (input: { id: number; device: DeviceInput }): Promise<Device> => ipcRenderer.invoke('devices:update', input),
  checkDevice: (deviceId: number): Promise<DeviceHealth> => ipcRenderer.invoke('devices:check', deviceId),
  captureUiHierarchy: (deviceId: number): Promise<UiHierarchyCapture> => ipcRenderer.invoke('devices:capture-hierarchy', deviceId),
  prepareWda: (deviceId: number): Promise<{ device: Device; message: string }> => ipcRenderer.invoke('devices:prepare-wda', deviceId),
  listCampaigns: (): Promise<Campaign[]> => ipcRenderer.invoke('campaigns:list'),
  createCampaign: (input: CampaignInput): Promise<Campaign> => ipcRenderer.invoke('campaigns:create', input),
  updateCampaign: (input: { id: number; campaign: CampaignInput }): Promise<Campaign> => ipcRenderer.invoke('campaigns:update', input),
  runCampaign: (campaignId: number): Promise<WorkflowRun[]> => ipcRenderer.invoke('campaigns:run', campaignId),
  listJobRuns: (): Promise<JobRunSummary[]> => ipcRenderer.invoke('jobs:list'), getJobRun: (jobRunId: number): Promise<WorkflowRun> => ipcRenderer.invoke('jobs:get', jobRunId), readJobArtifact: (input: { jobRunId: number; step: number; kind: 'screenshot' | 'hierarchy' }): Promise<JobArtifact> => ipcRenderer.invoke('jobs:read-artifact', input),
  cancelJob: (deviceId: number): Promise<boolean> => ipcRenderer.invoke('jobs:cancel', deviceId),
});
