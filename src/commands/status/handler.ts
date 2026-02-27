import { VmStatus } from "../../model/microvm/vm-status";
import { formatVmDetails } from "../../lib/terminal-output";
import { vmRepository } from "../../services/repository/vm/vm.repository";
import type { StatusInput } from "./input";

export const handleStatus = async (input: StatusInput): Promise<void> => {
  const vm = await vmRepository.findByNameOrId(input.nameOrId);
  const dto = vm.toDto();

  if (input.outputJson) {
    console.log(
      JSON.stringify(
        {
          command: "status",
          running: dto.status === VmStatus.RUNNING,
          vm: {
            ...dto,
            vmId: dto.id,
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  const runtimeFields = dto.runtime
    ? [
        { label: "Firecracker PID", value: dto.runtime.firecrackerPid },
        { label: "API Socket", value: dto.runtime.apiSocketPath },
      ]
    : undefined;

  console.log(
    formatVmDetails({
      title: `VM ${dto.name} (${dto.id})`,
      fields: [
        { label: "Status", value: dto.status },
        { label: "Guest IP", value: dto.guestIp },
        { label: "vCPUs", value: dto.vcpuCount },
        { label: "Memory MiB", value: dto.memSizeMib },
        { label: "Disk MiB", value: dto.diskSizeMib },
        { label: "SSH User", value: dto.sshUser },
        { label: "Rootfs", value: dto.rootfsPath },
      ],
      ...(runtimeFields ? { runtimeFields } : {}),
    }),
  );
};
