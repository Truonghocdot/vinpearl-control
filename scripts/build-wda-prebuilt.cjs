// Builds the unsigned WebDriverAgent committed under prebuilt/wda (macOS + Xcode only).
// The bundle runs on any iPhone with iOS 15+ once re-signed for it; no xcodebuild is needed on the machine that installs it.
//   node scripts/build-wda-prebuilt.cjs [wdaVersion]
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const WDA_VERSION = process.argv[2] ?? '16.15.0';
const outDir = path.join(__dirname, '..', 'prebuilt', 'wda');
const run = (command, args, options = {}) => execFileSync(command, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options });
const plist = (file, key) => run('plutil', ['-extract', key, 'raw', '-o', '-', file]).trim();

if (process.platform !== 'darwin') { console.error('Chỉ build được WDA trên macOS có Xcode.'); process.exit(1); }
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wda-prebuilt-'));
try {
  // Pristine sources from npm: no team, profile or personal bundle id ends up in the repository.
  const tarball = run('npm', ['pack', `appium-webdriveragent@${WDA_VERSION}`, '--silent'], { cwd: work }).trim().split('\n').at(-1);
  run('tar', ['-xzf', tarball], { cwd: work });
  const source = path.join(work, 'package'); const derived = path.join(work, 'build');
  console.log(`xcodebuild WebDriverAgent ${WDA_VERSION} (unsigned)...`);
  run('xcodebuild', ['build-for-testing', '-project', path.join(source, 'WebDriverAgent.xcodeproj'), '-scheme', 'WebDriverAgentRunner', '-destination', 'generic/platform=iOS', '-derivedDataPath', derived, 'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO', 'CODE_SIGN_IDENTITY=']);
  const app = path.join(derived, 'Build', 'Products', 'Debug-iphoneos', 'WebDriverAgentRunner-Runner.app');
  fs.rmSync(path.join(app, 'PlugIns', 'WebDriverAgentRunner.xctest.dSYM'), { recursive: true, force: true });
  // Xcode 26 links the runner's Testing.framework against Swift Testing libraries that only iOS 26 ships; iOS 15/16 need copies.
  // On iOS 26 dyld finds the system copies in /usr/lib/swift first.
  const embedded = [];
  if (fs.existsSync(path.join(app, 'Frameworks', 'Testing.framework'))) {
    const platform = path.join(run('xcode-select', ['-p']).trim(), 'Platforms', 'iPhoneOS.platform', 'Developer');
    for (const extra of ['usr/lib/lib_TestingInterop.dylib', 'Library/Frameworks/_Testing_Foundation.framework']) { fs.cpSync(path.join(platform, extra), path.join(app, 'Frameworks', path.basename(extra)), { recursive: true, verbatimSymlinks: true }); embedded.push(path.basename(extra)); }
  }
  fs.mkdirSync(outDir, { recursive: true });
  const zip = path.join(outDir, 'WebDriverAgentRunner-Runner.zip'); fs.rmSync(zip, { force: true });
  run('ditto', ['-c', '-k', '--norsrc', '--noextattr', '--noqtn', '--keepParent', app, zip]);
  const [xcodeVersion, xcodeBuild] = run('xcodebuild', ['-version']).trim().split('\n').map((line) => line.split(' ').at(-1));
  const manifest = {
    wdaVersion: WDA_VERSION, xcodeVersion, xcodeBuild, builtAt: new Date().toISOString(),
    minimumIosVersion: plist(path.join(app, 'PlugIns', 'WebDriverAgentRunner.xctest', 'Info.plist'), 'MinimumOSVersion'),
    architectures: run('lipo', ['-archs', path.join(app, 'WebDriverAgentRunner-Runner')]).trim().split(' '),
    // Re-signing rewrites these to the provisioning profile's app id (runner: <id>.xctrunner, test bundle: <id>).
    bundleIds: { runner: plist(path.join(app, 'Info.plist'), 'CFBundleIdentifier'), xctest: plist(path.join(app, 'PlugIns', 'WebDriverAgentRunner.xctest', 'Info.plist'), 'CFBundleIdentifier') },
    xctestConfig: 'WebDriverAgentRunner.xctest', embeddedSwiftTesting: embedded, signed: false,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex'),
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${path.relative(process.cwd(), zip)} (${(fs.statSync(zip).size / 1048576).toFixed(1)} MB)`, manifest.sha256);
} finally { fs.rmSync(work, { recursive: true, force: true }); }
