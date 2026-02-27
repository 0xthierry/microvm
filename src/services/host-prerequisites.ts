import { mkdirSync } from "node:fs";

import type { ProcessService } from "./process";

export type HostPrerequisitesService = {
  ensureDirs: (paths: string[]) => void;
  ensureDependencies: (binaries: string[]) => void;
  ensureKvmAccess: () => void;
  ensureSudoSession: () => Promise<void>;
};

export const createHostPrerequisitesService = ({
  process,
  logStep,
}: {
  process: ProcessService;
  logStep: (message: string) => void;
}): HostPrerequisitesService => {
  const ensureDirs = (paths: string[]): void => {
    paths.forEach((path) => mkdirSync(path, { recursive: true }));
  };

  const ensureDependencies = (binaries: string[]): void => {
    binaries.forEach((binary) => {
      const result = process.run(["bash", "-lc", `command -v ${binary}`], {
        allowFailure: true,
      });
      if (result.exitCode !== 0) {
        throw new Error(`Missing dependency: ${binary}`);
      }
    });
  };

  const ensureKvmAccess = (): void => {
    const canRead = process.run(["bash", "-lc", "[ -r /dev/kvm ]"], { allowFailure: true }).exitCode === 0;
    const canWrite = process.run(["bash", "-lc", "[ -w /dev/kvm ]"], { allowFailure: true }).exitCode === 0;
    if (!canRead || !canWrite) {
      throw new Error("Current user cannot read/write /dev/kvm.");
    }
  };

  const ensureSudoSession = async (): Promise<void> => {
    if (process.isRoot()) {
      return;
    }
    logStep("Requesting sudo for network setup...");
    process.run(["sudo", "-v"], { inherit: true });
  };

  return {
    ensureDirs,
    ensureDependencies,
    ensureKvmAccess,
    ensureSudoSession,
  };
};
