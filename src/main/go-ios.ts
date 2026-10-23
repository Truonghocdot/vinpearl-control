import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// go-ios starts WDA on iOS < 17 without Xcode's test runner: Xcode 26.4+ refuses to run XCUITest on those devices
// ("Logic Testing Unavailable"). iOS 17+ needs a go-ios tunnel instead, so those devices keep Appium's xcodebuild launch.
export const GO_IOS_MAX_MAJOR = 16;
export function usesGoIos(iosVersion: string | null | undefined) { const major = Number(String(iosVersion ?? '').split('.')[0]); return Number.isInteger(major) && major > 0 && major <= GO_IOS_MAX_MAJOR; }

export function goIosPath() {
  const candidates = [process.env.VINPEARL_GO_IOS_PATH?.trim(), process.resourcesPath ? path.join(process.resourcesPath, 'go-ios', 'ios') : '', path.join(__dirname, '../../../vendor/go-ios/ios')];
  const found = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!found) throw new Error('Không tìm thấy go-ios. Chạy "npm install" (tải vendor/go-ios/ios) hoặc đặt VINPEARL_GO_IOS_PATH.');
  return found;
}

// Results come as JSON on stdout; logs are JSON lines on stderr, the last ERROR line says why a command failed.
export function goIosError(stderr: string) {
  const lines = stderr.split('\n').map((line) => { try { return JSON.parse(line) as { level?: string; msg?: string; err?: string; error?: string }; } catch { return null; } });
  const failure = lines.filter((line) => line?.level === 'ERROR').at(-1) ?? lines.filter((line) => line?.msg).at(-1);
  return failure ? [failure.msg, failure.err ?? failure.error].filter(Boolean).join(': ') : stderr.trim().split('\n').at(-1) ?? '';
}

export function runGoIos(args: string[], timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(goIosPath(), args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`go-ios ${args[0]}: ${goIosError(stderr) || error.message}`)); else resolve(stdout);
    });
  });
}

export function spawnGoIos(args: string[]): ChildProcess { return spawn(goIosPath(), args, { stdio: ['ignore', 'ignore', 'pipe'] }); }

export async function deviceIosVersion(udid: string) {
  const output = await runGoIos(['info', `--udid=${udid}`], 30_000).catch((error: Error) => {
    // usbmuxd does not list the phone: unplugged, locked before first trust, or paired only through Xcode's Wi-Fi (CoreDevice).
    if (/not found/i.test(error.message)) throw new Error('Mac không thấy iPhone này qua USB. Cắm cáp, mở khóa máy và bấm "Tin cậy" nếu được hỏi. Máy iOS 17+ không cần "Chuẩn bị WDA".');
    throw error;
  });
  const info = JSON.parse(output.split('\n')[0] || '{}') as { ProductVersion?: string };
  if (!info.ProductVersion) throw new Error('go-ios không đọc được phiên bản iOS của thiết bị.');
  return info.ProductVersion;
}
export function installApp(udid: string, appPath: string) { return runGoIos(['install', `--path=${appPath}`, `--udid=${udid}`], 300_000); }
