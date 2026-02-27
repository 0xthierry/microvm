import { vmRepository } from "../../services/repository/vm/vm.repository";
import { formatHeading, formatVmList } from "../../lib/terminal-output";
import type { ListInput } from "./input";

export const handleList = async (_input: ListInput): Promise<void> => {
  const vms = await vmRepository.list();
  const dtoList = vms.map((vm) => vm.toDto());

  if (_input.outputJson) {
    console.log(
      JSON.stringify(
        {
          command: "list",
          vms: dtoList,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (vms.length === 0) {
    console.log("[microvm] No VMs found.");
    return;
  }

  console.log(
    [
      formatHeading("VMs"),
      "",
      formatVmList(
        dtoList.map((vm) => ({
          name: vm.name,
          id: vm.id,
          status: vm.status,
          guestIp: vm.guestIp,
          ...(vm.runtime ? { firecrackerPid: vm.runtime.firecrackerPid } : {}),
        })),
      ),
    ].join("\n"),
  );
};
