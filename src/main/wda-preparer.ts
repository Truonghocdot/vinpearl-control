import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deviceIosVersion, installApp, usesGoIos } from './go-ios';

export type WdaPreparation = { iosVersion: string; wdaBundleId: string | null; wdaExpiresAt: string | null; message: string };
export const WDA_XCTEST_CONFIG = 'WebDriverAgentRunner.xctest';
// Swift Testing ships inside iOS 26 but not iOS 15/16, yet Xcode 26 links the runner's Testing.framework against both.
const SWIFT_TESTING_EXTRAS = ['usr/lib/lib_TestingInterop.dylib', 'Library/Frameworks/_Testing_Foundation.framework'];

// Builds Appium's WebDriverAgent for one iPhone, makes it launchable on old iOS and installs it with go-ios.
export class WdaPreparer {
  constructor(private readonly rootPath: string, private readonly teamId?: string) {}
  iosVersion(udid: string) { return deviceIosVersion(udid); }

  async prepare(device: { udid: string }): Promise<WdaPreparation> {
    const iosVersion = await deviceIosVersion(device.udid);
    if (!usesGoIos(iosVersion)) return { iosVersion, wdaBundleId: null, wdaExpiresAt: null, message: `iOS ${iosVersion}: Appium tự build và chạy WDA qua Xcode, không cần chuẩn bị.` };
    const buildPath = path.join(this.rootPath, device.udid); fs.mkdirSync(buildPath, { recursive: true });
    await runLogged('xcodebuild', ['build-for-testing', '-project', path.join(findWdaProject(), 'WebDriverAgent.xcodeproj'), '-scheme', 'WebDriverAgentRunner', '-destination', `id=${device.udid}`, '-derivedDataPath', buildPath, '-allowProvisioningUpdates', ...(this.teamId ? [`DEVELOPMENT_TEAM=${this.teamId}`] : [])], path.join(buildPath, 'xcodebuild.log'), 20 * 60_000);
    const app = path.join(buildPath, 'Build', 'Products', 'Debug-iphoneos', 'WebDriverAgentRunner-Runner.app');
    if (!fs.existsSync(app)) throw new Error(`xcodebuild không tạo ra ${app}.`);
    await embedSwiftTesting(app);
    const profile = await readProfile(app);
    if (profile.devices && !profile.devices.some((udid) => udid.toUpperCase() === device.udid.toUpperCase())) throw new Error('Provisioning profile của WDA chưa có UDID iPhone này. Mở Xcode một lần với máy đang cắm để Xcode đăng ký thiết bị, rồi chuẩn bị lại.');
    const wdaBundleId = (await run('plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', path.join(app, 'Info.plist')])).trim();
    await installApp(device.udid, app);
    return { iosVersion, wdaBundleId, wdaExpiresAt: profile.expiresAt, message: `Đã cài WDA (${wdaBundleId}) cho iOS ${iosVersion}; profile hết hạn ${new Date(profile.expiresAt).toLocaleString('vi-VN')}.` };
  }
}

export function findWdaProject() {
  const appiumHome = process.env.APPIUM_HOME?.trim() || path.join(os.homedir(), '.appium');
  const candidates = [process.env.VINPEARL_WDA_PROJECT?.trim(), path.join(appiumHome, 'node_modules', 'appium-xcuitest-driver', 'node_modules', 'appium-webdriveragent')];
  const found = candidates.find((candidate) => candidate && fs.existsSync(path.join(candidate, 'WebDriverAgent.xcodeproj')));
  if (!found) throw new Error('Không tìm thấy WebDriverAgent. Cài "appium driver install xcuitest" hoặc đặt VINPEARL_WDA_PROJECT.');
  return found;
}

// Adds the Swift Testing libraries the runner needs and re-signs it with the identity and entitlements Xcode used.
export async function embedSwiftTesting(app: string) {
  const frameworks = path.join(app, 'Frameworks');
  if (!fs.existsSync(path.join(frameworks, 'Testing.framework'))) return false;
  const platform = path.join((await run('xcode-select', ['-p'])).trim(), 'Platforms', 'iPhoneOS.platform', 'Developer');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wda-sign-'));
  try {
    await run('codesign', ['-d', `--extract-certificates=${path.join(work, 'cert')}`, app]);
    const identity = crypto.createHash('sha1').update(fs.readFileSync(path.join(work, 'cert0'))).digest('hex').toUpperCase();
    const entitlements = path.join(work, 'entitlements.plist'); fs.writeFileSync(entitlements, await run('codesign', ['-d', '--entitlements', ':-', app]));
    for (const extra of SWIFT_TESTING_EXTRAS) {
      const source = path.join(platform, extra); const destination = path.join(frameworks, path.basename(extra));
      if (!fs.existsSync(source)) throw new Error(`Xcode thiếu ${source}.`);
      fs.rmSync(destination, { recursive: true, force: true }); fs.cpSync(source, destination, { recursive: true, verbatimSymlinks: true });
      await run('codesign', ['-f', '-s', identity, destination]);
    }
    await run('codesign', ['-f', '-s', identity, '--entitlements', entitlements, app]);
    await run('codesign', ['--verify', '--deep', '--strict', app]);
    return true;
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}

export async function readProfile(app: string): Promise<{ expiresAt: string; devices: string[] | null }> {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wda-profile-'));
  try {
    const plist = path.join(work, 'profile.plist'); fs.writeFileSync(plist, await run('security', ['cms', '-D', '-i', path.join(app, 'embedded.mobileprovision')]));
    const expiresAt = new Date((await run('plutil', ['-extract', 'ExpirationDate', 'raw', '-o', '-', plist])).trim()).toISOString();
    // Enterprise profiles have no device list (ProvisionsAllDevices).
    const devices = await run('plutil', ['-extract', 'ProvisionedDevices', 'json', '-o', '-', plist]).then((json) => JSON.parse(json) as string[], () => null);
    return { expiresAt, devices };
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}

function run(command: string, args: string[], timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${command} ${args[0]}: ${(stderr || error.message).trim().split('\n').at(-1)}`)); else resolve(stdout);
    });
  });
}

// xcodebuild prints megabytes; keep the full log on disk and surface its error lines.
function runLogged(command: string, args: string[], logPath: string, timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    const log = fs.createWriteStream(logPath); const errors: string[] = [];
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    const collect = (chunk: Buffer) => { log.write(chunk); chunk.toString().split('\n').forEach((line) => { if (/\berror:/.test(line)) errors.push(line.trim()); }); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.once('error', (error) => { clearTimeout(timer); log.end(); reject(error); });
    child.once('close', (code) => { clearTimeout(timer); log.end(); if (code === 0) resolve(); else reject(new Error(`${command} lỗi (${code ?? 'timeout'}): ${errors.slice(-2).join(' | ') || 'xem ' + logPath}`)); });
  });
}
