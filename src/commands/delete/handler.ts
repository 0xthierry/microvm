import { dirname, join, resolve, sep } from "node:path";
import { rmSync } from "node:fs";
import { getAppConfig } from "../../config/runtime-context";
import { DeleteCheckpoint } from "../../model/operation/checkpoints";
import { VmOperation } from "../../model/operation/vm-operation";
import { jailerService } from "../../services/jailer/jailer.service";
import { networkService } from "../../services/network/network.service";
import { vmEventLogRepository } from "../../services/repository/vm-event-log/vm-event-log.repository";
import { vmRepository } from "../../services/repository/vm/vm.repository";
import type { DeleteInput } from "./input";
import { DeleteRollbackFailedError, DeleteUnsafePathError } from "./errors";

const assertContainedPath = (params: {
  vmId: string;
  pathRole: "vmDir" | "runtimeVmDir";
  candidatePath: string;
  expectedRoot: string;
}): void => {
  const resolvedPath = resolve(params.candidatePath);
  const resolvedRoot = resolve(params.expectedRoot);
  const contained = resolvedPath === resolvedRoot
    || resolvedPath.startsWith(`${resolvedRoot}${sep}`);

  if (!contained) {
    throw new DeleteUnsafePathError({
      vmId: params.vmId,
      pathRole: params.pathRole,
      expectedRoot: resolvedRoot,
      resolvedPath,
    });
  }
};

export const handleDelete = async (input: DeleteInput): Promise<void> => {
  let vm = await vmRepository.findByNameOrId(input.nameOrId);

  const operation = await VmOperation.start(vm.id, "delete", vmEventLogRepository);
  await operation.checkpoint(DeleteCheckpoint.VALIDATED_INPUT, {
    nameOrId: input.nameOrId,
  });

  const config = getAppConfig();
  const runtimeVmDir = join(config.paths.runtimeDir, vm.id);
  const vmDir = dirname(vm.toDto().rootfsPath);
  let runtimeStopCompleted = vm.runtime?.firecrackerPid === undefined;

  try {
    assertContainedPath({
      vmId: vm.id,
      pathRole: "vmDir",
      candidatePath: vmDir,
      expectedRoot: config.paths.vmsDir,
    });
    assertContainedPath({
      vmId: vm.id,
      pathRole: "runtimeVmDir",
      candidatePath: runtimeVmDir,
      expectedRoot: config.paths.runtimeDir,
    });

    const deletingVm = vm.del(new Date().toISOString());
    await operation.stateChanged(vm.status, deletingVm.status);
    await vmRepository.update(deletingVm);
    vm = deletingVm;

    if (vm.runtime?.firecrackerPid) {
      jailerService.stopVmProcess(vm);
      await networkService.teardown(vm);
      jailerService.cleanup(vm, vm.runtime.jailerVmDir);
    }
    runtimeStopCompleted = true;

    await operation.checkpoint(DeleteCheckpoint.RUNTIME_STOPPED);

    rmSync(vmDir, {
      recursive: true,
      force: true,
    });
    rmSync(runtimeVmDir, {
      recursive: true,
      force: true,
    });

    await operation.checkpoint(DeleteCheckpoint.ASSETS_REMOVED, {
      vmDir,
      runtimeVmDir,
    });

    await vmRepository.delete(vm.id);
    await operation.checkpoint(DeleteCheckpoint.RECORD_DELETED);

    await operation.succeeded();
    await vmEventLogRepository.deleteLog(vm.id);

    if (input.outputJson) {
      console.log(JSON.stringify({
        command: "delete",
        vm: {
          id: vm.id,
          name: vm.name,
        },
      }, null, 2));
    } else {
      console.log(`[microvm] VM "${vm.name}" deleted (id: ${vm.id}).`);
    }
  } catch (error) {
    await operation.rollbackStarted(error);

    try {
      try {
        const current = await vmRepository.getById(vm.id);
        const failedAt = new Date().toISOString();
        const failed = (runtimeStopCompleted ? current.clearRuntime(failedAt) : current)
          .fail(failedAt, "delete_failed");
        await vmRepository.update(failed);
      } catch {
        // VM record may already be gone; ignore.
      }
      await operation.failed(error);
    } catch (rollbackError) {
      await operation.rollbackFailed(rollbackError);
      throw new DeleteRollbackFailedError({
        vmId: vm.id,
        cause: rollbackError,
      });
    }

    throw error;
  }
};
