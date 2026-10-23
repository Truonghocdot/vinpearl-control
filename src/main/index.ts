import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { AppiumClient } from './appium-client';
import { AppiumAutomationEngine } from './appium-engine';
import { VinClubActionAdapter } from './vinclub-action-adapter';
import { closeDatabase, createCampaign, createDevice, getJobRun, initializeDatabase, listCampaigns, listDevices, listJobRuns, readJobArtifact, updateCampaign, updateDevice } from './database';
import { JobService } from './job-service';
import { WdaPreparer } from './wda-preparer';
import { WdaSupervisor } from './wda-supervisor';

const isDevelopment = !app.isPackaged;
const appiumPort = Number(process.env.VINPEARL_APPIUM_PORT ?? 4723);
const xcodeOrgId = process.env.VINPEARL_XCODE_ORG_ID?.trim() || undefined;
const appiumClient = new AppiumClient({
  port: Number.isInteger(appiumPort) ? appiumPort : 4723,
  xcodeOrgId,
  xcodeSigningId: process.env.VINPEARL_XCODE_SIGNING_ID?.trim() || 'Apple Development',
  waitForIdleTimeout: nonNegativeEnv('VINPEARL_WDA_IDLE_TIMEOUT', 0),
  animationCoolOffTimeout: nonNegativeEnv('VINPEARL_WDA_ANIMATION_COOLOFF', 0),
  maxTypingFrequency: nonNegativeEnv('VINPEARL_MAX_TYPING_FREQUENCY', 60) || 60,
  webDriverAgentUrl: process.env.VINPEARL_WDA_URL?.trim() || undefined,
});
// iOS < 17 devices: WDA is built once by "Chuẩn bị WDA", then started and kept alive with go-ios (Xcode 26.4+ cannot launch it).
const wdaSupervisor = new WdaSupervisor({ status: (host, port) => appiumClient.wdaStatus(host, port) });
const appiumEngine = new AppiumAutomationEngine(appiumClient, new VinClubActionAdapter(appiumClient), wdaSupervisor);
// Parallel runs across iPhones (one run per device at a time). Each run mostly waits on its own device, so the Mac handles several.
const jobs = new JobService(appiumEngine, Math.max(1, Math.floor(nonNegativeEnv('VINPEARL_MAX_PARALLEL', 4))), new WdaPreparer(path.join(app.getPath('userData'), 'wda'), xcodeOrgId));

function nonNegativeEnv(name: string, fallback: number) {
  const raw = process.env[name]?.trim(); const value = Number(raw);
  return raw && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function createWindow() {
  const window = new BrowserWindow({ width: 1280, height: 800, minWidth: 980, minHeight: 640, backgroundColor: '#0d1726', webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false } });
  if (isDevelopment) void window.loadURL('http://127.0.0.1:5173'); else void window.loadFile(path.join(__dirname, '../../../dist-renderer/index.html'));
}

function registerIpc() {
  ipcMain.handle('app:get-info', () => ({ name: app.getName(), version: app.getVersion(), platform: process.platform, appiumPort }));
  ipcMain.handle('devices:list', () => listDevices().map((device) => ({ ...device, wdaProcess: wdaSupervisor.state(device.udid) })));
  ipcMain.handle('devices:create', (_event, input) => createDevice(input));
  ipcMain.handle('devices:update', (_event, input: { id: number; device: Parameters<typeof updateDevice>[1] }) => updateDevice(Number(input.id), input.device));
  ipcMain.handle('devices:check', (_event, deviceId: number) => jobs.checkDevice(Number(deviceId)));
  ipcMain.handle('devices:prepare-wda', (_event, deviceId: number) => jobs.prepareWda(Number(deviceId)));
  ipcMain.handle('devices:capture-hierarchy', (_event, deviceId: number) => jobs.captureUiHierarchy(Number(deviceId)));
  ipcMain.handle('campaigns:list', () => listCampaigns());
  ipcMain.handle('campaigns:create', (_event, input) => createCampaign(input));
  ipcMain.handle('campaigns:update', (_event, input: { id: number; campaign: Parameters<typeof updateCampaign>[1] }) => updateCampaign(Number(input.id), input.campaign));
  ipcMain.handle('campaigns:run', (_event, campaignId: number) => jobs.runCampaign(Number(campaignId)));
  ipcMain.handle('jobs:list', () => listJobRuns());
  ipcMain.handle('jobs:get', (_event, jobRunId: number) => getJobRun(Number(jobRunId)));
  ipcMain.handle('jobs:read-artifact', (_event, input: { jobRunId: number; step: number; kind: 'screenshot' | 'hierarchy' }) => readJobArtifact(Number(input.jobRunId), Number(input.step), input.kind));
  ipcMain.handle('jobs:cancel', (_event, deviceId: number) => jobs.cancel(Number(deviceId)));
}

app.whenReady().then(async () => { if (process.platform !== 'darwin') console.warn('Vinpearl iPhone Manager chỉ hỗ trợ macOS.'); await initializeDatabase(app.getPath('userData')); registerIpc(); createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
// Runners are child processes: never leave `ios runwda` holding a device after the app quits.
app.on('will-quit', () => wdaSupervisor.stopAll());
app.on('window-all-closed', () => { void appiumEngine.closeAll(); closeDatabase(); if (process.platform !== 'darwin') app.quit(); });
