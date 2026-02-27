import { getAppConfig } from "../../config/runtime-context";
import {
  buildBootArgs,
  buildFirecrackerLogPath,
  resolveHostArch,
} from "../../model/microvm/planning";
import { UpCheckpoint } from "../../model/operation/checkpoints";
import { VmOperation } from "../../model/operation/vm-operation";
import { firecrackerService } from "../../services/firecracker/firecracker.service";
import { hostService } from "../../services/host/host.service";
import { jailerService } from "../../services/jailer/jailer.service";
import { kernelService } from "../../services/kernel/kernel.service";
import { networkService } from "../../services/network/network.service";
import { vmEventLogRepository } from "../../services/repository/vm-event-log/vm-event-log.repository";
import { vmRepository } from "../../services/repository/vm/vm.repository";
import { sshService } from "../../services/ssh/ssh.service";
import { formatInfoLine } from "../../lib/terminal-output";
import type { UpInput } from "./input";
import { UpRollbackFailedError } from "./errors";

export const handleUp = async (input: UpInput): Promise<void> => {
  let vm = await vmRepository.findByNameOrId(input.nameOrId);

  const operation = await VmOperation.start(vm.id, "up", vmEventLogRepository);
  await operation.checkpoint(UpCheckpoint.VALIDATED_INPUT, {
    nameOrId: input.nameOrId,
  });

  let jailerVmDir: string | undefined;
  let networkHostIface: string | undefined;
  let runtimeStopCompleted = vm.runtime?.firecrackerPid === undefined;

  try {
    const upAt = new Date().toISOString();
    const startingVm = vm.up(upAt);
    await operation.stateChanged(vm.status, startingVm.status);
    await vmRepository.update(startingVm);
    vm = startingVm;

    hostService.prepareUpEnvironment();

    networkHostIface = await networkService.setup(vm);
    await operation.checkpoint(UpCheckpoint.NETWORK_READY);

    const firecrackerBinaryPath = jailerService.resolveBinaryPath("firecracker");
    const jailerBinaryPath = jailerService.resolveBinaryPath("jailer");

    const layout = jailerService.prepareLayout({
      vmId: vm.id,
      firecrackerBinaryPath,
    });
    jailerVmDir = layout.vmDir;

    const kernelArtifact = await kernelService.ensureKernelArtifact();
    const kernelPath = kernelArtifact.path;
    const runtimeUid = String(jailerService.getRuntimeUid());
    const runtimeGid = String(jailerService.getRuntimeGid());

    jailerService.stageAssets({
      vm,
      layout,
      kernelSourcePath: kernelPath,
      runtimeUid,
      runtimeGid,
    });
    jailerService.stageRuntimeDeps(firecrackerBinaryPath, layout.rootDir);

    const vmConfig = vm.toDto();
    const profile = jailerService.resolveProfile({
      requiredFsizeBytes: vmConfig.diskSizeMib * 1024 * 1024,
      requiredMemoryBytes: vmConfig.memSizeMib * 1024 * 1024,
    });

    const logPath = buildFirecrackerLogPath(getAppConfig().paths.runtimeDir, vm.id);
    const firecrackerPid = jailerService.launch({
      vm,
      jailerBinaryPath,
      firecrackerBinaryPath,
      runtimeUid,
      runtimeGid,
      profile,
      logPath,
    });

    await operation.checkpoint(UpCheckpoint.JAILER_STARTED, {
      firecrackerPid,
    });

    const arch = resolveHostArch(process.arch);
    const bootArgs = buildBootArgs({
      guestIp: vmConfig.guestIp,
      hostIp: vmConfig.hostIp,
      maskLong: vmConfig.maskLong,
      vmId: vmConfig.id,
      arch,
    });

    vm = vm.withRuntime(
      {
        firecrackerPid,
        hostIface: networkHostIface,
        apiSocketPath: layout.apiSocketHostPath,
        bootArgs,
        kernelPath,
        jailerVmDir: layout.vmDir,
        firecrackerBinaryPath,
        jailerBinaryPath,
        releaseTag: kernelArtifact.releaseTag,
        kernelCiVersion: kernelArtifact.ciVersion,
        kernelVersion: kernelArtifact.version,
        startedAt: new Date().toISOString(),
      },
      new Date().toISOString(),
    );

    await vmRepository.update(vm);

    await firecrackerService.configure(vm);
    await firecrackerService.start(vm);
    await operation.checkpoint(UpCheckpoint.VM_BOOTED);

    const runningVm = vm.run(new Date().toISOString());
    await operation.stateChanged(vm.status, runningVm.status);
    await vmRepository.update(runningVm);
    vm = runningVm;

    await operation.checkpoint(UpCheckpoint.RUNTIME_PERSISTED);
    await operation.succeeded();

    // Match prior behavior: `up` returns only after SSH is reachable, even with `--no-attach`.
    await sshService.waitUntilReady(vm);

    let sshCommand: string | undefined;
    if (input.attach) {
      sshCommand = sshService.renderCommand(vm);
      if (!input.outputJson) {
        console.log(formatInfoLine("SSH", sshCommand));
      }
    }

    const dto = vm.toDto();
    if (input.outputJson) {
      console.log(
        JSON.stringify(
          {
            command: "up",
            vm: {
              id: dto.id,
              name: dto.name,
              status: dto.status,
              guestIp: dto.guestIp,
            },
            ...(sshCommand ? { sshCommand } : {}),
          },
          null,
          2,
        ),
      );
    } else {
      console.log(`[microvm] VM "${vm.name}" is running (id: ${vm.id}, ip: ${dto.guestIp}).`);
    }
  } catch (error) {
    await operation.rollbackStarted(error);

    try {
      if (vm.runtime?.firecrackerPid) {
        jailerService.stopVmProcess(vm);
      }
      runtimeStopCompleted = true;

      await networkService.teardown(
        vm,
        networkHostIface
          ? {
              hostIface: networkHostIface,
            }
          : {},
      );
      await operation.rollbackCheckpoint(UpCheckpoint.NETWORK_READY);

      jailerService.cleanup(vm, jailerVmDir);

      const failedAt = new Date().toISOString();
      const failedVm = (runtimeStopCompleted ? vm.clearRuntime(failedAt) : vm).fail(
        failedAt,
        "up_failed",
      );
      await vmRepository.update(failedVm);
      vm = failedVm;

      await operation.failed(error);
    } catch (rollbackError) {
      try {
        const failedAt = new Date().toISOString();
        const failedVm = (runtimeStopCompleted ? vm.clearRuntime(failedAt) : vm).fail(
          failedAt,
          "up_failed",
        );
        await vmRepository.update(failedVm);
        vm = failedVm;
      } catch {
        // Preserve original rollback failure error below.
      }
      await operation.rollbackFailed(rollbackError);
      throw new UpRollbackFailedError({
        vmId: vm.id,
        cause: rollbackError,
      });
    }

    throw error;
  }
};
