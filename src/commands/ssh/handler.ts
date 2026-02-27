import { VmStatus } from "../../model/microvm/vm-status";
import { vmRepository } from "../../services/repository/vm/vm.repository";
import { sshService } from "../../services/ssh/ssh.service";
import type { SshInput } from "./input";
import { SshVmNotRunningError } from "./errors";

export const handleSsh = async (input: SshInput): Promise<void> => {
  const vm = await vmRepository.findByNameOrId(input.nameOrId);

  if (vm.status !== VmStatus.RUNNING) {
    throw new SshVmNotRunningError(vm.id);
  }

  if (input.command) {
    sshService.exec(vm, input.command);
    if (input.outputJson) {
      console.log(
        JSON.stringify(
          {
            command: "ssh",
            vm: {
              id: vm.id,
              name: vm.name,
            },
            executed: input.command,
          },
          null,
          2,
        ),
      );
    }
    return;
  }

  if (input.outputJson) {
    const sshCommand = sshService.renderCommand(vm);
    console.log(
      JSON.stringify(
        {
          command: "ssh",
          vm: {
            id: vm.id,
            name: vm.name,
          },
          sshCommand,
        },
        null,
        2,
      ),
    );
    return;
  }

  sshService.connect(vm);
};
