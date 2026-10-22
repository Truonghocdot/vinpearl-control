import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

export interface CredentialStore { get(ref: string): Promise<{ username?: string; password: string }>; set(ref: string, value: { username?: string; password: string }): Promise<void>; delete(ref: string): Promise<void>; }

export class MacKeychainStore implements CredentialStore {
  constructor(private readonly service = 'com.vinpearl.iphone-manager') {}
  async get(ref: string) { const { stdout } = await execFileAsync('security', ['find-generic-password', '-s', this.service, '-a', ref, '-w']); const parsed = JSON.parse(stdout.trim()) as { username?: string; password: string }; if (!parsed.password) throw new Error(`Credential ${ref} không có password.`); return parsed; }
  async set(ref: string, value: { username?: string; password: string }) { await execFileAsync('security', ['add-generic-password', '-U', '-s', this.service, '-a', ref, '-w', JSON.stringify(value)]); }
  async delete(ref: string) { await execFileAsync('security', ['delete-generic-password', '-s', this.service, '-a', ref]).catch(() => undefined); }
}

export class MemoryCredentialStore implements CredentialStore {
  private readonly values = new Map<string, { username?: string; password: string }>();
  async get(ref: string) { const value = this.values.get(ref); if (!value) throw new Error(`Credential ${ref} chưa được lưu.`); return value; }
  async set(ref: string, value: { username?: string; password: string }) { this.values.set(ref, value); }
  async delete(ref: string) { this.values.delete(ref); }
}
