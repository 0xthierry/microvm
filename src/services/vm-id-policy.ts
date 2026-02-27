import { join } from "node:path";

import type { AppConfig } from "../config/app-config";

export type VmIdPolicyService = {
  normalizeVmId: (vmId: string | undefined) => string;
  assertVmId: (vmId: string) => void;
  assertJailerSafeVmId: (vmId: string) => void;
  assertJailerSocketPathLength: (vmId: string, execName?: string) => void;
};

export const createVmIdPolicyService = ({
  appConfig,
}: {
  appConfig: AppConfig;
}): VmIdPolicyService => {
  const defaultVmId = appConfig.defaults.vm.id;
  const jailerBaseDir = appConfig.paths.jailerBaseDir;
  const jailerApiSocketInJail = appConfig.defaults.jailer.apiSocketInJail;
  const maxUnixSocketPathLength = appConfig.defaults.jailer.maxUnixSocketPathLength;

  const normalizeVmId = (vmId: string | undefined): string => {
    const value = vmId?.trim();
    return value && value.length > 0 ? value : defaultVmId;
  };

  const assertVmId = (vmId: string): void => {
    if (/^[a-z0-9][a-z0-9_-]{0,31}$/.test(vmId)) {
      return;
    }
    throw new Error(
      `Invalid vm-id "${vmId}". Use lowercase letters, digits, '_' and '-' (max 32 chars).`,
    );
  };

  const assertJailerSafeVmId = (vmId: string): void => {
    if (/^[a-z0-9][a-z0-9-]{0,31}$/.test(vmId)) {
      return;
    }
    throw new Error(
      `VM "${vmId}" is not jailer-safe. For create/start, use lowercase letters, digits, and '-' only.`,
    );
  };

  const assertJailerSocketPathLength = (vmId: string, execName = "firecracker"): void => {
    const socketPath = join(jailerBaseDir, execName, vmId, "root", jailerApiSocketInJail.slice(1));
    if (socketPath.length <= maxUnixSocketPathLength) {
      return;
    }

    const fixedChars = socketPath.length - vmId.length;
    const maxVmIdLength = Math.max(1, maxUnixSocketPathLength - fixedChars);
    throw new Error(
      `VM id "${vmId}" is too long for this host path (socket length ${socketPath.length} > ${maxUnixSocketPathLength}). Max vm-id length here is ${maxVmIdLength}. Use a shorter vm-id or move the repo to a shorter path.`,
    );
  };

  return {
    normalizeVmId,
    assertVmId,
    assertJailerSafeVmId,
    assertJailerSocketPathLength,
  };
};
