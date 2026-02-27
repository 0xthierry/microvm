import { setTimeout as sleep } from "node:timers/promises";

import type { ProcessService } from "./process";

type SshTarget = {
  sshUser: string;
  sshKeyPath: string;
  guestIp: string;
};

export type SshClientService = {
  waitForSshReady: (target: SshTarget, timeoutMs: number) => Promise<void>;
  sshBaseArgs: (target: SshTarget) => string[];
  renderSshCommand: (target: SshTarget) => string;
};

export const createSshClientService = ({
  process,
}: {
  process: ProcessService;
}): SshClientService => {
  const sshBaseArgs = (target: SshTarget): string[] => [
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

  const waitForSshReady = async (target: SshTarget, timeoutMs: number): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const attempt = process.run([...sshBaseArgs(target), "true"], { allowFailure: true });
      if (attempt.exitCode === 0) return;
      await sleep(1500);
    }
    throw new Error("Timed out waiting for SSH to become available.");
  };

  const renderSshCommand = (target: SshTarget): string =>
    [
      "ssh",
      "-i",
      process.shellQuote(target.sshKeyPath),
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "UserKnownHostsFile=/dev/null",
      `${target.sshUser}@${target.guestIp}`,
    ].join(" ");

  return {
    waitForSshReady,
    sshBaseArgs,
    renderSshCommand,
  };
};
