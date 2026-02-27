import { HostClient } from "./host.client";
import {
  HostDependencyMissingError,
  HostKvmAccessDeniedError,
  HostPrerequisiteCheckFailedError,
} from "./errors";

const CREATE_REQUIRED_BINARIES = [
  "docker",
  "mkfs.ext4",
  "tar",
  "ssh-keygen",
  "e2fsck",
  "resize2fs",
] as const;

const UP_REQUIRED_BINARIES = [
  "firecracker",
  "jailer",
  "curl",
  "ip",
  "iptables",
  "ssh",
] as const;

type CreateEnvironmentParams = {
  vmsDir: string;
  runtimeDir: string;
  vmDir: string;
  runtimeVmDir: string;
};

export class HostService {
  constructor(private readonly client: HostClient = new HostClient()) {}

  prepareCreateEnvironment(params: CreateEnvironmentParams): void {
    this.ensureDirs([
      params.vmsDir,
      params.runtimeDir,
      params.vmDir,
      params.runtimeVmDir,
    ]);
    this.ensureDependencies([...CREATE_REQUIRED_BINARIES]);
    this.ensureSudoSession();
  }

  prepareUpEnvironment(): void {
    this.ensureDependencies([...UP_REQUIRED_BINARIES]);
    this.ensureSudoSession();
  }

  ensureDirs(paths: string[]): void {
    try {
      this.client.ensureDirs(paths);
    } catch (cause) {
      throw new HostPrerequisiteCheckFailedError({
        message: "Failed to prepare required directories.",
        cause,
      });
    }
  }

  ensureDependencies(binaries: string[]): void {
    for (const binary of new Set(binaries)) {
      try {
        if (!this.client.commandExists(binary)) {
          throw new HostDependencyMissingError({ binary });
        }
      } catch (cause) {
        if (cause instanceof HostDependencyMissingError) {
          throw cause;
        }
        throw new HostPrerequisiteCheckFailedError({
          message: `Failed while checking dependency: ${binary}`,
          cause,
        });
      }
    }
  }

  ensureKvmAccess(): void {
    try {
      if (!this.client.hasKvmAccess()) {
        throw new HostKvmAccessDeniedError();
      }
    } catch (cause) {
      if (cause instanceof HostKvmAccessDeniedError) {
        throw cause;
      }
      throw new HostPrerequisiteCheckFailedError({
        message: "Failed while checking /dev/kvm access.",
        cause,
      });
    }
  }

  ensureSudoSession(): void {
    try {
      this.client.ensureSudoSession();
    } catch (cause) {
      throw new HostPrerequisiteCheckFailedError({
        message: "Failed to establish sudo session.",
        cause,
      });
    }
  }
}

export const hostService = new HostService();
