import type { MicroVM } from "../../model/microvm/microvm";
import {
  JailerClient,
  type JailerLayout,
  type JailerProfile,
} from "./jailer.client";
import {
  JailerBinaryNotFoundError,
  JailerCleanupFailedError,
  JailerLaunchFailedError,
  JailerLayoutPreparationFailedError,
  JailerProfileResolveFailedError,
  JailerStopFailedError,
} from "./errors";

export class JailerService {
  constructor(private readonly client: JailerClient = new JailerClient()) {}

  resolveBinaryPath(binary: string): string {
    try {
      return this.client.resolveBinaryPath(binary);
    } catch (cause) {
      throw new JailerBinaryNotFoundError({ binary, cause });
    }
  }

  getRuntimeUid(): number {
    return this.client.getRuntimeUid();
  }

  getRuntimeGid(): number {
    return this.client.getRuntimeGid();
  }

  prepareLayout(params: {
    vmId: string;
    firecrackerBinaryPath: string;
  }): JailerLayout {
    try {
      return this.client.prepareLayout(params);
    } catch (cause) {
      throw new JailerLayoutPreparationFailedError({
        vmId: params.vmId,
        cause,
      });
    }
  }

  resolveProfile(params: {
    requiredFsizeBytes: number;
    requiredMemoryBytes: number;
  }): JailerProfile {
    try {
      return this.client.resolveProfile(params);
    } catch (cause) {
      throw new JailerProfileResolveFailedError({ cause });
    }
  }

  stageAssets(params: {
    vm: MicroVM;
    layout: JailerLayout;
    kernelSourcePath: string;
    runtimeUid: string;
    runtimeGid: string;
  }): void {
    try {
      const dto = params.vm.toDto();
      this.client.stageVmAssets({
        layout: params.layout,
        kernelSourcePath: params.kernelSourcePath,
        rootfsSourcePath: dto.rootfsPath,
        runtimeUid: params.runtimeUid,
        runtimeGid: params.runtimeGid,
      });
    } catch (cause) {
      throw new JailerLayoutPreparationFailedError({
        vmId: params.vm.id,
        cause,
      });
    }
  }

  stageRuntimeDeps(execPath: string, jailRootDir: string): void {
    this.client.stageExecRuntimeDeps(execPath, jailRootDir);
  }

  launch(params: {
    vm: MicroVM;
    jailerBinaryPath: string;
    firecrackerBinaryPath: string;
    runtimeUid: string;
    runtimeGid: string;
    profile: JailerProfile;
    logPath: string;
  }): number {
    try {
      return this.client.launch({
        vmId: params.vm.id,
        jailerBinaryPath: params.jailerBinaryPath,
        firecrackerBinaryPath: params.firecrackerBinaryPath,
        runtimeUid: params.runtimeUid,
        runtimeGid: params.runtimeGid,
        profile: params.profile,
        logPath: params.logPath,
      });
    } catch (cause) {
      throw new JailerLaunchFailedError({
        vmId: params.vm.id,
        cause,
      });
    }
  }

  cleanup(vm: MicroVM, vmDir: string | undefined): void {
    if (!vmDir) {
      return;
    }

    try {
      this.client.cleanupVmDir(vmDir);
    } catch (cause) {
      throw new JailerCleanupFailedError({
        vmId: vm.id,
        cause,
      });
    }
  }

  stopVmProcess(vm: MicroVM): void {
    const dto = vm.toDto();
    const runtime = dto.runtime;
    if (!runtime) {
      return;
    }

    try {
      this.client.stopVmProcess({
        vmId: dto.id,
        pid: runtime.firecrackerPid,
        jailerVmDir: runtime.jailerVmDir,
      });
    } catch (cause) {
      throw new JailerStopFailedError({
        vmId: dto.id,
        pid: runtime.firecrackerPid,
        cause,
      });
    }
  }
}

export const jailerService = new JailerService();
