import { DownCheckpoint } from "../../model/operation/checkpoints";
import { VmOperation } from "../../model/operation/vm-operation";
import { jailerService } from "../../services/jailer/jailer.service";
import { networkService } from "../../services/network/network.service";
import { vmEventLogRepository } from "../../services/repository/vm-event-log/vm-event-log.repository";
import { vmRepository } from "../../services/repository/vm/vm.repository";
import type { DownInput } from "./input";
import { DownRollbackFailedError } from "./errors";

export const handleDown = async (input: DownInput): Promise<void> => {
  let vm = await vmRepository.findByNameOrId(input.nameOrId);

  const operation = await VmOperation.start(vm.id, "down", vmEventLogRepository);
  await operation.checkpoint(DownCheckpoint.VALIDATED_INPUT, {
    nameOrId: input.nameOrId,
  });

  let vmStoppingPersisted = false;
  let networkTornDown = false;
  let runtimeClearedPersisted = false;
  let runtimeStopCompleted = vm.runtime?.firecrackerPid === undefined;

  try {
    const stoppingVm = vm.down(new Date().toISOString());
    await operation.stateChanged(vm.status, stoppingVm.status);
    await vmRepository.update(stoppingVm);
    vm = stoppingVm;
    vmStoppingPersisted = true;

    if (vm.runtime?.firecrackerPid) {
      jailerService.stopVmProcess(vm);
    }
    runtimeStopCompleted = true;
    await operation.checkpoint(DownCheckpoint.VM_STOPPING);

    await networkService.teardown(vm);
    networkTornDown = true;
    await operation.checkpoint(DownCheckpoint.NETWORK_TORN_DOWN);

    jailerService.cleanup(vm, vm.runtime?.jailerVmDir);

    const stoppedVm = vm.stop(new Date().toISOString());
    await operation.stateChanged(vm.status, stoppedVm.status);
    await vmRepository.update(stoppedVm);
    vm = stoppedVm;
    runtimeClearedPersisted = true;

    await operation.checkpoint(DownCheckpoint.RUNTIME_CLEARED);
    await operation.succeeded();

    if (input.outputJson) {
      console.log(JSON.stringify({
        command: "down",
        vm: {
          id: vm.id,
          name: vm.name,
          status: vm.status,
        },
      }, null, 2));
    } else {
      console.log(`[microvm] VM "${vm.name}" is stopped (id: ${vm.id}).`);
    }
  } catch (error) {
    await operation.rollbackStarted(error);

    try {
      if (networkTornDown && !runtimeClearedPersisted) {
        await networkService.setup(vm);
        await operation.rollbackCheckpoint(DownCheckpoint.NETWORK_TORN_DOWN, {
          tapDev: vm.toDto().tapDev,
        });
      }

      const failedAt = new Date().toISOString();
      const failedVm = (runtimeStopCompleted ? vm.clearRuntime(failedAt) : vm)
        .fail(failedAt, "down_failed");
      await vmRepository.update(failedVm);
      vm = failedVm;

      if (vmStoppingPersisted && !runtimeClearedPersisted) {
        await operation.rollbackCheckpoint(DownCheckpoint.VM_STOPPING, {
          status: vm.status,
        });
      }

      await operation.failed(error);
    } catch (rollbackError) {
      try {
        const failedAt = new Date().toISOString();
        const failedVm = (runtimeStopCompleted ? vm.clearRuntime(failedAt) : vm)
          .fail(failedAt, "down_failed");
        await vmRepository.update(failedVm);
        vm = failedVm;
      } catch {
        // Preserve original rollback failure error below.
      }
      await operation.rollbackFailed(rollbackError);
      throw new DownRollbackFailedError({
        vmId: vm.id,
        cause: rollbackError,
      });
    }

    throw error;
  }
};
