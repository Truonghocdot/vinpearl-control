import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { closeDatabase, createDevice, initializeDatabase, listDevices } from './database';

const isDevelopment = !app.isPackaged;

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
