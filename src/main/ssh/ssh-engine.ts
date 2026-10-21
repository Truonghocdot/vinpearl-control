import { SshService, type SshAuth, type SshCommandResult, type SshCommandOptions, type SshTarget } from './ssh-service';

export type SshCommandAction = {
  type: 'sshCommand';
  command: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
};

export class SSHCommandEngine {
  readonly name = 'ssh-command';
  readonly capabilities = ['sshCommand', 'deviceProbe'] as const;

  constructor(private readonly service = new SshService()) {}

  execute(target: SshTarget, auth: SshAuth, action: SshCommandAction, options?: SshCommandOptions): Promise<SshCommandResult> {
    return this.service.execute(target, auth, action.command, {
      timeoutMs: action.timeoutMs ?? options?.timeoutMs,
      maxOutputBytes: action.maxOutputBytes ?? options?.maxOutputBytes,
    });
  }

  probe(target: SshTarget, auth: SshAuth, options?: SshCommandOptions) {
    return this.service.probe(target, auth, options);
  }
}
