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
};
