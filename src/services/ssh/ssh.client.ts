import { setTimeout as sleep } from "node:timers/promises";
import { processRunner } from "../../lib/process/process-runner";
import { SshCommandFailedError, SshWaitTimeoutError } from "./errors";

export type SshTarget = {
  sshUser: string;
  sshKeyPath: string;
  guestIp: string;
};

export class SshClient {
  baseArgs(target: SshTarget): string[] {
    return [
      "ssh",
      "-i",
      target.sshKeyPath,
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "UserKnownHostsFile=/dev/null",
      "-o",
      "IdentitiesOnly=yes",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=3",
      `${target.sshUser}@${target.guestIp}`,
    ];
  }

  async waitForReady(target: SshTarget, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const result = processRunner.run([...this.baseArgs(target), "true"], {
          allowFailure: true,
        });

        if (result.exitCode === 0) {
          return;
        }
      } catch (cause) {
        throw new SshCommandFailedError({
          target: `${target.sshUser}@${target.guestIp}`,
          cause,
        });
      }

      await sleep(1500);
    }

    throw new SshWaitTimeoutError({
      target: `${target.sshUser}@${target.guestIp}`,
      timeoutMs,
    });
  }

  renderCommand(target: SshTarget): string {
    return [
      "ssh",
      "-i",
      processRunner.shellQuote(target.sshKeyPath),
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "UserKnownHostsFile=/dev/null",
      `${target.sshUser}@${target.guestIp}`,
    ].join(" ");
  }

  connect(target: SshTarget): void {
    try {
      processRunner.run(this.baseArgs(target), {
        inherit: true,
      });
    } catch (cause) {
      throw new SshCommandFailedError({
        target: `${target.sshUser}@${target.guestIp}`,
        cause,
      });
    }
  }

  exec(target: SshTarget, command: string): void {
    try {
      processRunner.run([...this.baseArgs(target), command], {
        inherit: true,
      });
    } catch (cause) {
      throw new SshCommandFailedError({
        target: `${target.sshUser}@${target.guestIp}`,
        cause,
      });
    }
  }
}
