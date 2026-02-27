import type { MicroVM } from "../../model/microvm/microvm";
import { getAppConfig } from "../../config/runtime-context";
import { FirecrackerClient } from "./firecracker.client";
import {
  FirecrackerConfigurationFailedError,
  FirecrackerStartFailedError,
} from "./errors";

export class FirecrackerService {
  constructor(private readonly client: FirecrackerClient = new FirecrackerClient()) {}

  async configure(vm: MicroVM): Promise<void> {
    const dto = vm.toDto();
    const runtime = dto.runtime;

    if (!runtime) {
      throw new FirecrackerConfigurationFailedError({
        vmId: dto.id,
        cause: new Error("Missing VM runtime metadata for Firecracker configuration."),
      });
    }

    try {
      const jailerDefaults = getAppConfig().defaults.jailer;
      await this.client.waitForApi(runtime.apiSocketPath);
      this.client.configure({
        socketPath: runtime.apiSocketPath,
        vcpuCount: dto.vcpuCount,
        memSizeMib: dto.memSizeMib,
        tapDev: dto.tapDev,
        guestMac: dto.guestMac,
        // Firecracker runs inside jailer chroot; API paths must be jail-internal.
        kernelPath: jailerDefaults.kernelPathInJail,
        rootfsPath: jailerDefaults.rootfsPathInJail,
        bootArgs: runtime.bootArgs,
      });
    } catch (cause) {
      throw new FirecrackerConfigurationFailedError({
        vmId: dto.id,
        cause,
      });
    }
  }

  async start(vm: MicroVM): Promise<void> {
    const dto = vm.toDto();
    const runtime = dto.runtime;

    if (!runtime) {
      throw new FirecrackerStartFailedError({
        vmId: dto.id,
        cause: new Error("Missing VM runtime metadata for Firecracker start."),
      });
    }

    try {
      await this.client.waitForApi(runtime.apiSocketPath);
      this.client.instanceStart(runtime.apiSocketPath);
    } catch (cause) {
      throw new FirecrackerStartFailedError({
        vmId: dto.id,
        cause,
      });
    }
  }
}

export const firecrackerService = new FirecrackerService();
