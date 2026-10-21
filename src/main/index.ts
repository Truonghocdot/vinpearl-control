import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import {
  closeDatabase,
  createDevice,
  getWorkflow,
  initializeDatabase,
  listDevices,
  listWorkflows,
  saveWorkflowRun,
} from './database';
import { runWorkflowPreview } from './workflow-runner';
import { runVinClubScript, type VinClubScriptInput } from './automation-script';
import { SshHostKeyError, SshService, type SshAuth, type SshTarget } from './ssh/ssh-service';

const isDevelopment = !app.isPackaged;
const sshService = new SshService();

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#0d1726',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDevelopment) {
    void window.loadURL('http://127.0.0.1:5173');
  } else {
    void window.loadFile(path.join(__dirname, '../../../dist-renderer/index.html'));
  }
}

function registerIpc() {
  ipcMain.handle('app:get-info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
  }));

  ipcMain.handle('devices:list', () => listDevices());
  ipcMain.handle('devices:create', (_event, input) => createDevice(input));
  ipcMain.handle('workflows:list', () => listWorkflows());
  ipcMain.handle('workflows:get', (_event, workflowId: string) => getWorkflow(workflowId));
  ipcMain.handle('workflows:run-preview', async (_event, workflowId: string) => {
    const workflow = getWorkflow(workflowId);
    const run = await runWorkflowPreview(workflow);
    return saveWorkflowRun(run);
  });
  ipcMain.handle('scripts:run-vinclub', async (_event, input: VinClubScriptInput) => runVinClubScript(input));
  ipcMain.handle('ssh:probe', async (_event, input: { target: SshTarget; auth: SshAuth }) => {
    try {
      return { status: 'ok' as const, result: await sshService.probe(input.target, input.auth) };
    } catch (error) {
      if (error instanceof SshHostKeyError) return { status: 'host-untrusted' as const, fingerprint: error.fingerprint };
      throw error;
    }
  });
  ipcMain.handle('ssh:command', async (_event, input: { target: SshTarget; auth: SshAuth; command: string }) => {
    try {
      return { status: 'ok' as const, result: await sshService.execute(input.target, input.auth, input.command) };
    } catch (error) {
      if (error instanceof SshHostKeyError) return { status: 'host-untrusted' as const, fingerprint: error.fingerprint };
      throw error;
    }
  });
}

app.whenReady().then(async () => {
  await initializeDatabase(app.getPath('userData'));
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  closeDatabase();
  if (process.platform !== 'darwin') app.quit();
});
