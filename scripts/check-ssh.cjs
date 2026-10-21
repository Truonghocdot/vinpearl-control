const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { Server } = require('ssh2');
const { SshHostKeyError, SshService } = require('../dist-electron/src/main/ssh/ssh-service.js');

const { privateKey: hostKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
});

const server = new Server({ hostKeys: [hostKey] }, (client) => {
  client.on('authentication', (context) => {
    if (context.method === 'password' && context.username === 'check' && context.password === 'secret') context.accept();
    else context.reject();
  });
  client.on('ready', () => {
    client.on('session', (accept) => {
      const session = accept();
      session.once('exec', (acceptExec) => {
        const stream = acceptExec();
        stream.stderr.write('test stderr');
        stream.write('test stdout');
        stream.exit(0);
        stream.end();
      });
    });
  });
});

function listen() {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function main() {
  const port = await listen();
  const service = new SshService();
  const target = { host: '127.0.0.1', port, username: 'check' };
  const auth = { password: 'secret' };
  let fingerprint = '';

  await assert.rejects(
    service.execute(target, auth, 'echo first'),
    (error) => {
      assert.ok(error instanceof SshHostKeyError);
      fingerprint = error.fingerprint;
      return true;
    },
  );

  const result = await service.execute({ ...target, hostFingerprint: fingerprint }, auth, 'echo second');
  assert.equal(result.stdout, 'test stdout');
  assert.equal(result.stderr, 'test stderr');
  assert.equal(result.code, 0);
  assert.match(result.fingerprint, /^SHA256:/);
  server.close();
  console.log('ssh engine check ok: host pinning, auth, exec, stderr and exit code');
}

main().catch((error) => {
  server.close();
  console.error(error);
  process.exit(1);
});
