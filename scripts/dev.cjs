const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

delete process.env.ELECTRON_RUN_AS_NODE;

const viteCli = path.join(path.dirname(require.resolve('vite')), '../../bin/vite.js');
const tscCli = path.join(path.dirname(require.resolve('typescript')), '../bin/tsc');

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: process.env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed: ${command} ${args.join(' ')}`));
    });
  });
}

let vite;

let electron;
let shuttingDown = false;

function stop() {
  if (shuttingDown) return;
  shuttingDown = true;
  vite?.kill();
  electron?.kill();
}

function waitForVite() {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      if (vite.exitCode !== null) {
        reject(new Error('Vite exited before the dev server became ready.'));
        return;
      }
      const request = http.get('http://127.0.0.1:5173', (response) => {
        response.resume();
        resolve();
      });
      request.on('error', () => {
        if (Date.now() - startedAt > 15000) {
          reject(new Error('Timed out waiting for Vite on port 5173.'));
        } else {
          setTimeout(check, 150);
        }
      });
    };
    check();
  });
}

process.on('SIGINT', () => {
  stop();
  process.exit(0);
});
process.on('SIGTERM', () => {
  stop();
  process.exit(0);
});

run(process.execPath, [tscCli, '-p', 'tsconfig.node.json'])
  .then(() => {
    vite = spawn(process.execPath, [viteCli, '--host', '127.0.0.1'], {
      env: process.env,
      stdio: 'inherit',
    });
    return waitForVite();
  })
  .then(() => {
    electron = spawn(require('electron'), ['.'], {
      env: process.env,
      stdio: 'inherit',
    });
    electron.on('exit', (code) => {
      stop();
      process.exit(code ?? 1);
    });
  })
  .catch((error) => {
    console.error(error.message);
    stop();
    process.exit(1);
  });
