const { spawn } = require('node:child_process');

delete process.env.ELECTRON_RUN_AS_NODE;

const electronPath = require('electron');
const child = spawn(electronPath, ['.'], {
  env: process.env,
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
