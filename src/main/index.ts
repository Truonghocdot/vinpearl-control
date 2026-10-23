import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { AppiumClient } from './appium-client';
import { AppiumAutomationEngine } from './appium-engine';
import { VinClubActionAdapter } from './vinclub-action-adapter';
import { closeDatabase, createAccount, createCampaign, createDevice, getJobRun, initializeDatabase, listAccounts, listCampaigns, listDevices, listJobRuns, readJobArtifact, setAccountStatus, updateAccount, updateCampaign, updateDevice } from './database';
import { JobService } from './job-service';
import { MacKeychainStore } from './keychain';

const isDevelopment = !app.isPackaged;
const appiumPort = Number(process.env.VINPEARL_APPIUM_PORT ?? 4723);
const appiumClient = new AppiumClient({
  port: Number.isInteger(appiumPort) ? appiumPort : 4723,
  xcodeOrgId: process.env.VINPEARL_XCODE_ORG_ID?.trim() || undefined,
  xcodeSigningId: process.env.VINPEARL_XCODE_SIGNING_ID?.trim() || 'Apple Development',
  waitForIdleTimeout: nonNegativeEnv('VINPEARL_WDA_IDLE_TIMEOUT', 0),
  animationCoolOffTimeout: nonNegativeEnv('VINPEARL_WDA_ANIMATION_COOLOFF', 0),
  maxTypingFrequency: nonNegativeEnv('VINPEARL_MAX_TYPING_FREQUENCY', 60) || 60,
  webDriverAgentUrl: process.env.VINPEARL_WDA_URL?.trim() || undefined,
});
const appiumEngine = new AppiumAutomationEngine(appiumClient, new VinClubActionAdapter(appiumClient));
const jobs = new JobService(appiumEngine, new MacKeychainStore());

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
  ipcMain.handle('devices:list', () => listDevices());
  ipcMain.handle('devices:create', (_event, input) => createDevice(input));
  ipcMain.handle('devices:update', (_event, input: { id: number; device: Parameters<typeof updateDevice>[1] }) => updateDevice(Number(input.id), input.device));
  ipcMain.handle('devices:check', (_event, deviceId: number) => jobs.checkDevice(Number(deviceId)));
  ipcMain.handle('devices:capture-hierarchy', (_event, deviceId: number) => jobs.captureUiHierarchy(Number(deviceId)));
  ipcMain.handle('accounts:list', () => listAccounts());
  ipcMain.handle('accounts:create', async (_event, input: { displayName: string; username: string; credentialRef: string; password: string }) => { if (!input.displayName?.trim() || !input.username?.trim() || !input.credentialRef?.trim() || !input.password) throw new Error('Tên, username, credential reference và password là bắt buộc.'); await new MacKeychainStore().set(input.credentialRef.trim(), { password: input.password }); return createAccount(input); });
  ipcMain.handle('accounts:update', async (_event, input: { id: number; account: Parameters<typeof updateAccount>[1]; password?: string }) => { if (input.password) await new MacKeychainStore().set(input.account.credentialRef.trim(), { password: input.password }); return updateAccount(Number(input.id), input.account); });
  ipcMain.handle('accounts:set-status', (_event, input: { id: number; status: 'active' | 'disabled' }) => setAccountStatus(Number(input.id), input.status));
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
app.on('window-all-closed', () => { closeDatabase(); if (process.platform !== 'darwin') app.quit(); });
