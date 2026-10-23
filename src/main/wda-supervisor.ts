import type { ChildProcess } from 'node:child_process';
import { goIosError, spawnGoIos } from './go-ios';
import { WDA_XCTEST_CONFIG } from './wda-preparer';

export type WdaTarget = { udid: string; wdaBundleId: string; connectionType?: 'usb' | 'ip'; ipAddress?: string | null; wdaLocalPort: number };
export type WdaProcessState = { state: 'starting' | 'running' | 'restarting' | 'error' | 'stopped'; url: string; generation: number; restarts: number; lastError: string | null };
export type WdaAttach = { url: string; platformVersion?: string; generation: number };
type ChildLike = Pick<ChildProcess, 'kill' | 'once'> & { stderr?: NodeJS.ReadableStream | null };
export type WdaSupervisorDeps = {
  spawn?: (args: string[]) => ChildLike;
  status: (host: string, port: number) => Promise<{ platformVersion?: string } | null>;
  startupTimeoutMs?: number;
  restartDelayMs?: number;
  maxRestarts?: number;
};
type Entry = { target: WdaTarget; host: string; port: number; runner?: ChildLike; forwarder?: ChildLike; state: WdaProcessState; failures: number; startedAt: number; launched: boolean; timer?: NodeJS.Timeout; stderr: string };
// go-ios logs this once iOS launched the new runner, which also ends any previous WDA instance. Before that, /status may
// still be answered by the WDA being replaced (seen on device: ready, then ECONNREFUSED a moment later).
const LAUNCHED_MARKER = 'Process started successfully';
const LAUNCH_GRACE_MS = 15_000;

// WDA on iOS < 17 lives only as long as the `ios runwda` process that started it (and dies with the USB/Wi-Fi link),
// so each device keeps one runner, restarted with backoff when it exits. USB devices also get `ios forward` to a Mac port.
export class WdaSupervisor {
  private readonly entries = new Map<string, Entry>();
  private readonly spawn: (args: string[]) => ChildLike;
  private readonly startupTimeoutMs: number;
  private readonly restartDelayMs: number;
  private readonly maxRestarts: number;
  constructor(private readonly deps: WdaSupervisorDeps) {
    this.spawn = deps.spawn ?? spawnGoIos;
    this.startupTimeoutMs = deps.startupTimeoutMs ?? 60_000;
    this.restartDelayMs = deps.restartDelayMs ?? 2_000;
    this.maxRestarts = deps.maxRestarts ?? 5;
  }

  // Starts WDA if needed (or after the restarts gave up) and waits until it answers.
  async ensure(target: WdaTarget): Promise<WdaAttach> {
    const entry = this.entry(target);
    if (!entry.runner && !entry.timer) { entry.failures = 0; this.start(entry); }
    const started = Date.now();
    while (Date.now() - started < this.startupTimeoutMs) {
      if (entry.state.state === 'error') break;
      const status = await this.readyStatus(entry);
      if (status) { this.markRunning(entry); return this.attach(entry, status); }
      await sleep(250);
    }
    throw new Error(`WDA không khởi động được trên ${target.udid}${entry.state.lastError ? `: ${entry.state.lastError}` : ` sau ${this.startupTimeoutMs}ms`}. Kiểm tra iPhone đang mở khóa, còn kết nối với Mac và profile WDA còn hạn.`);
  }

  state(udid: string): WdaProcessState | null { const state = this.entries.get(udid)?.state; return state ? { ...state } : null; }
  stop(udid: string) { const entry = this.entries.get(udid); if (!entry) return; this.entries.delete(udid); this.kill(entry); entry.state.state = 'stopped'; }
  stopAll() { [...this.entries.keys()].forEach((udid) => this.stop(udid)); }

  private entry(target: WdaTarget) {
    const ip = target.connectionType === 'ip' && target.ipAddress ? target.ipAddress : null;
    // IP devices are reached directly on WDA's own port; USB devices through a forwarded Mac port (WDA listens on 8100).
    const host = ip ?? '127.0.0.1'; const port = target.wdaLocalPort;
    const existing = this.entries.get(target.udid);
    if (existing && existing.host === host && existing.port === port && existing.target.wdaBundleId === target.wdaBundleId) return existing;
    if (existing) this.stop(target.udid);
    const entry: Entry = { target, host, port, state: { state: 'stopped', url: `http://${host}:${port}`, generation: 0, restarts: 0, lastError: null }, failures: 0, startedAt: 0, launched: false, stderr: '' };
    this.entries.set(target.udid, entry);
    return entry;
  }

  private start(entry: Entry) {
    const { udid, wdaBundleId, connectionType } = entry.target; const devicePort = connectionType === 'ip' ? entry.port : 8100;
    if (entry.timer) clearTimeout(entry.timer); entry.timer = undefined;
    entry.state.state = entry.state.generation ? 'restarting' : 'starting'; entry.state.generation += 1; entry.startedAt = Date.now(); entry.stderr = ''; entry.launched = false;
    const runner = this.spawn(['runwda', `--bundleid=${wdaBundleId}`, `--testrunnerbundleid=${wdaBundleId}`, `--xctestconfig=${WDA_XCTEST_CONFIG}`, `--env=USE_PORT=${devicePort}`, `--udid=${udid}`]);
    entry.runner = runner;
    runner.stderr?.on('data', (chunk: Buffer) => { const text = entry.stderr + chunk.toString(); if (text.includes(LAUNCHED_MARKER)) entry.launched = true; entry.stderr = text.slice(-8_000); });
    runner.once('exit', () => this.exited(entry, runner));
    void this.watchStartup(entry, runner);
    if (connectionType !== 'ip') { const forwarder = this.spawn(['forward', String(entry.port), String(devicePort), `--udid=${udid}`]); entry.forwarder = forwarder; forwarder.once('exit', () => { if (entry.forwarder === forwarder) entry.forwarder = undefined; }); }
  }

  // Marks a (re)started WDA as running in the background, so its state is right even when nobody is waiting on it.
  private async watchStartup(entry: Entry, runner: ChildLike) {
    while (entry.runner === runner && Date.now() - entry.startedAt < this.startupTimeoutMs) {
      if (await this.readyStatus(entry)) { if (entry.runner === runner) this.markRunning(entry); return; }
      await sleep(500);
    }
  }
  private async readyStatus(entry: Entry) { return entry.runner && (entry.launched || Date.now() - entry.startedAt > LAUNCH_GRACE_MS) ? this.deps.status(entry.host, entry.port) : null; }
  private markRunning(entry: Entry) { entry.state.state = 'running'; entry.state.lastError = null; }

  private exited(entry: Entry, runner: ChildLike) {
    if (entry.runner !== runner || this.entries.get(entry.target.udid) !== entry) return;
    entry.runner = undefined; this.kill(entry);
    entry.state.lastError = goIosError(entry.stderr) || 'ios runwda đã thoát.';
    // A runner that stayed up for a minute was healthy: start counting failures again.
    entry.failures = Date.now() - entry.startedAt > 60_000 ? 1 : entry.failures + 1;
    if (entry.failures > this.maxRestarts) { entry.state.state = 'error'; return; }
    entry.state.state = 'restarting'; entry.state.restarts += 1;
    entry.timer = setTimeout(() => { entry.timer = undefined; if (this.entries.get(entry.target.udid) === entry && !entry.runner) this.start(entry); }, Math.min(this.restartDelayMs * 2 ** (entry.failures - 1), 30_000));
  }

  private kill(entry: Entry) {
    if (entry.timer) clearTimeout(entry.timer); entry.timer = undefined;
    const { runner, forwarder } = entry; entry.runner = undefined; entry.forwarder = undefined;
    runner?.kill('SIGTERM'); forwarder?.kill('SIGTERM');
  }

  private attach(entry: Entry, status: { platformVersion?: string }): WdaAttach { return { url: entry.state.url, platformVersion: status.platformVersion, generation: entry.state.generation }; }
}

function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
