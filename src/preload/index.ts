import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desktopApi', {
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
  listDevices: () => ipcRenderer.invoke('devices:list'),
  createDevice: (input: {
    name: string;
    host: string;
    port: number;
    username: string;
  }) => ipcRenderer.invoke('devices:create', input),
});
