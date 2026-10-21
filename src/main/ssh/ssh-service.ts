import { Client, type ClientChannel, type ConnectConfig } from 'ssh2';

export type SshTarget = {
  host: string;
  port: number;
  username: string;
  hostFingerprint?: string;
};

export type SshAuth = {
  privateKey?: string | Buffer;
  passphrase?: string;
  password?: string;
};

export type SshCommandOptions = {
  timeoutMs?: number;
  maxOutputBytes?: number;
};

export type SshCommandResult = {
  stdout: string;
  stderr: string;
  code: number | null;
  signal?: string;
  fingerprint: string;
  durationMs: number;
};

export type SshProbeResult = SshCommandResult & {
  rootless: boolean;
  sshServer: 'openssh' | 'dropbear' | 'unknown';
};

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_OUTPUT_BYTES = 512 * 1024;
const PROBE_COMMAND = 'uname -a; id; printf "\\nPATH=%s\\n" "$PATH"; command -v sshd || true; command -v dropbear || true; if test -d /var/jb; then printf "ROOTLESS=1\\n"; else printf "ROOTLESS=0\\n"; fi';

export class SshHostKeyError extends Error {
  constructor(message: string, readonly fingerprint: string) {
    super(message);
    this.name = 'SshHostKeyError';
  }
}

export class SshService {
  async probe(target: SshTarget, auth: SshAuth, options?: SshCommandOptions): Promise<SshProbeResult> {
    const result = await this.execute(target, auth, PROBE_COMMAND, options);
    const combined = `${result.stdout}\n${result.stderr}`;
    return {
      ...result,
      rootless: /(?:^|\n)ROOTLESS=1(?:\n|$)/.test(combined),
      sshServer: /(?:^|\n).*sshd(?:\n|$)/.test(combined)
        ? 'openssh'
        : /(?:^|\n).*dropbear(?:\n|$)/.test(combined) ? 'dropbear' : 'unknown',
    };
  }

  async execute(
    target: SshTarget,
    auth: SshAuth,
    command: string,
    options: SshCommandOptions = {},
  ): Promise<SshCommandResult> {
    if (!target.host.trim() || !target.username.trim()) throw new Error('SSH host and username are required.');
    if (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535) throw new Error('SSH port is invalid.');
    if (!command.trim()) throw new Error('SSH command is required.');
    if (!auth.privateKey && !auth.password) throw new Error('SSH private key or password is required.');

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const startedAt = Date.now();
    const connection = await this.open(target, auth, timeoutMs);
    try {
      const result = await executeChannel(connection.client, command, timeoutMs, maxOutputBytes);
      return {
        ...result,
        fingerprint: connection.fingerprint,
        durationMs: Date.now() - startedAt,
      };
    } finally {
      connection.client.end();
    }
  }

  private open(target: SshTarget, auth: SshAuth, timeoutMs: number): Promise<{ client: Client; fingerprint: string }> {
    return new Promise((resolve, reject) => {
      const client = new Client();
      let observedFingerprint = '';
      let settled = false;
      let connectTimer: NodeJS.Timeout;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        if (error) {
          client.destroy();
          reject(error);
        } else {
          resolve({ client, fingerprint: observedFingerprint });
        }
      };
      connectTimer = setTimeout(() => finish(new Error(`SSH connection timed out after ${timeoutMs}ms.`)), timeoutMs);

      client.once('ready', () => finish());
      client.on('error', (error) => {
        if (observedFingerprint) {
          finish(new SshHostKeyError(`${error.message} (${observedFingerprint})`, observedFingerprint));
        } else {
          finish(error);
        }
      });
      client.on('timeout', () => finish(new Error(`SSH socket timed out after ${timeoutMs}ms.`)));

      const config: ConnectConfig = {
        host: target.host,
        port: target.port,
        username: target.username,
        privateKey: auth.privateKey,
        passphrase: auth.passphrase,
        password: auth.password,
        readyTimeout: timeoutMs,
        timeout: timeoutMs,
        hostHash: 'sha256',
        hostVerifier: (fingerprint: string) => {
          observedFingerprint = formatFingerprint(fingerprint);
          const trusted = Boolean(target.hostFingerprint && fingerprintsEqual(target.hostFingerprint, observedFingerprint));
          if (!trusted) {
            finish(new SshHostKeyError(
              target.hostFingerprint ? 'SSH host fingerprint mismatch.' : 'SSH host fingerprint is not trusted yet.',
              observedFingerprint,
            ));
          }
          return trusted;
        },
      };
      client.connect(config);
    });
  }
}

type OpenChannelResult = Pick<SshCommandResult, 'stdout' | 'stderr' | 'code' | 'signal'>;

function executeChannel(client: Client, command: string, timeoutMs: number, maxOutputBytes: number): Promise<OpenChannelResult> {
  return new Promise((resolve, reject) => {
    let channel: ClientChannel | undefined;
    let stdout = '';
    let stderr = '';
    let bytes = 0;
    let settled = false;
    let exitCode: number | null = null;
    let exitSignal: string | undefined;
    const timer = setTimeout(() => {
      channel?.close();
      finish(new Error(`SSH command timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    const append = (target: 'stdout' | 'stderr', chunk: Buffer | string) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
      bytes += Buffer.byteLength(text);
      if (bytes > maxOutputBytes) {
        channel?.close();
        finish(new Error(`SSH command output exceeded ${maxOutputBytes} bytes.`));
        return;
      }
      if (target === 'stdout') stdout += text;
      else stderr += text;
    };

    const finish = (error?: Error, code: number | null = null, signal?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve({ stdout, stderr, code, signal });
    };

    client.exec(command, (error, stream) => {
      if (error) {
        finish(error);
        return;
      }
      channel = stream;
      stream.on('data', (chunk: Buffer) => append('stdout', chunk));
      stream.stderr.on('data', (chunk: Buffer) => append('stderr', chunk));
      stream.once('exit', (code: number | null, signal?: string) => {
        exitCode = code;
        exitSignal = signal;
      });
      stream.once('close', (code: number | null, signal?: string) => {
        finish(undefined, code ?? exitCode, signal ?? exitSignal);
      });
      stream.once('error', (streamError: Error) => finish(streamError));
    });
  });
}

function formatFingerprint(hexFingerprint: string) {
  const base64 = Buffer.from(hexFingerprint, 'hex').toString('base64').replace(/=+$/, '');
  return `SHA256:${base64}`;
}

function fingerprintsEqual(expected: string, observed: string) {
  const normalize = (value: string) => value.trim().replace(/^SHA256:/i, '').replace(/:/g, '').toLowerCase();
  const expectedValue = normalize(expected);
  const observedValue = normalize(observed);
  if (expectedValue === observedValue) return true;
  if (/^[0-9a-f]{64}$/.test(expectedValue)) return expectedValue === Buffer.from(observedValue, 'base64').toString('hex');
  return false;
}

