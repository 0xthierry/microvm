import { VmStatus } from "../../model/microvm/vm-status";
import { diskService } from "../../services/disk/disk.service";
import { vmRepository } from "../../services/repository/vm/vm.repository";
import type { SetInput } from "./input";
import { SetDiskResizeWhileRunningError } from "./errors";

export const handleSet = async (input: SetInput): Promise<void> => {
  const vm = await vmRepository.findByNameOrId(input.nameOrId);
  const dto = vm.toDto();
  const restartRecommended =
    (
      dto.status === VmStatus.RUNNING
      || dto.status === VmStatus.STARTING
      || dto.status === VmStatus.STOPPING
    )
    && (
      input.vcpuCount !== undefined
      || input.memSizeMib !== undefined
      || input.sshUser !== undefined
    );

  if (input.diskSizeMib !== undefined && input.diskSizeMib !== dto.diskSizeMib) {
    if (dto.status === VmStatus.RUNNING || dto.status === VmStatus.STARTING || dto.status === VmStatus.STOPPING) {
      throw new SetDiskResizeWhileRunningError(dto.id);
    }

    diskService.growDiskIfNeeded(dto.rootfsPath, input.diskSizeMib);
  }

  const updated = vm.withPatch({
    ...(input.vcpuCount !== undefined ? { vcpuCount: input.vcpuCount } : {}),
    ...(input.memSizeMib !== undefined ? { memSizeMib: input.memSizeMib } : {}),
    ...(input.diskSizeMib !== undefined ? { diskSizeMib: input.diskSizeMib } : {}),
    ...(input.sshUser !== undefined ? { sshUser: input.sshUser } : {}),
  }, new Date().toISOString());

  await vmRepository.update(updated);

  if (input.outputJson) {
    console.log(JSON.stringify({
      command: "set",
      vm: updated.toDto(),
    }, null, 2));
  } else {
    console.log(`[microvm] VM "${updated.name}" stored configuration updated.`);
    if (restartRecommended) {
      console.log("[microvm] Restart the VM for CPU, memory, or SSH user changes to affect the guest.");
    }
  }
};
