// Downloads the pinned go-ios CLI into vendor/go-ios/ios (bundled into the app as an extra resource).
// The npm package is not a dependency: its postinstall moves the binary into npm's global bin directory.
const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const VERSION = '1.3.2';
const TARBALL = `https://registry.npmjs.org/go-ios/-/go-ios-${VERSION}.tgz`;
const TARBALL_INTEGRITY = 'sha512-ZLTL7D2NxKtgAUK3NOLOP5bk3iqkRbAvSojH+bMD7B3qZM2j9GxT8WyRbw4+H5T6YPgHxeph1uZcn1m5Ty/InA==';
// Universal (arm64 + x86_64) macOS binary; the package ships the same file under both darwin folders.
const BINARY_IN_TARBALL = 'package/dist/go-ios-darwin-arm64_darwin_arm64/ios';
const BINARY_SHA256 = '0b841d42da8d98141efcb0a63f0abab90c86b36e7b90011b1b68eee2c2d1c234';
const target = path.join(__dirname, '..', 'vendor', 'go-ios', 'ios');
// `npm install` keeps working offline; packaging passes --required and fails instead.
const required = process.argv.includes('--required');

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) { response.resume(); download(response.headers.location).then(resolve, reject); return; }
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`HTTP ${response.statusCode} for ${url}`)); return; }
      const chunks = []; response.on('data', (chunk) => chunks.push(chunk)); response.on('end', () => resolve(Buffer.concat(chunks))); response.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  if (process.platform !== 'darwin') return;
  if (fs.existsSync(target) && sha256(target) === BINARY_SHA256) return;
  const tarball = await download(TARBALL);
  const integrity = `sha512-${crypto.createHash('sha512').update(tarball).digest('base64')}`;
  if (integrity !== TARBALL_INTEGRITY) throw new Error(`go-ios ${VERSION} tarball integrity mismatch.`);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'go-ios-'));
  try {
    const archive = path.join(work, 'go-ios.tgz'); fs.writeFileSync(archive, tarball);
    execFileSync('tar', ['-xzf', archive, '-C', work, BINARY_IN_TARBALL]);
    const binary = path.join(work, BINARY_IN_TARBALL);
    if (sha256(binary) !== BINARY_SHA256) throw new Error(`go-ios ${VERSION} binary checksum mismatch.`);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(binary, target); fs.chmodSync(target, 0o755);
    console.log(`go-ios ${VERSION} -> ${path.relative(process.cwd(), target)}`);
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}

main().catch((error) => {
  console.error(`Không tải được go-ios: ${error.message}`);
  if (required) process.exit(1);
});
