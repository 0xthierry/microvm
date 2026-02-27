import { Option, type Command as CommanderCommand } from "commander";
import { parsePositiveIntegerOption } from "../../cli/options";
import { getAppConfig } from "../../config/runtime-context";
import { parseCreateInput, type CreateCommandOptions } from "./input";
import { handleCreate } from "./handler";

export const registerCreateCommand = (program: CommanderCommand): void => {
  const defaults = getAppConfig().defaults.vm;
  const command = program.command("create");
  command.summary("Create a stopped VM record and rootfs");
  command.description("Create a stopped VM record and rootfs from a Dockerfile. Does not boot the VM.");
  command.requiredOption("--name <name>", "VM name");
  command.option(
    "--cpus <count>",
    `vCPU count (default: ${defaults.vcpuCount})`,
    parsePositiveIntegerOption("cpus"),
  );
  command.option(
    "--memory-mib <size>",
    `Memory size in MiB (default: ${defaults.memSizeMib})`,
    parsePositiveIntegerOption("memory-mib"),
  );
  command.addOption(
    new Option("--disk-mib <size>", `Disk size in MiB (default VM disk: ${defaults.diskSizeMib})`)
      .argParser(parsePositiveIntegerOption("disk-mib"))
      .conflicts("diskGib"),
  );
  command.addOption(
    new Option("--disk-gib <size>", `Disk size in GiB (default VM disk: ${defaults.diskSizeMib / 1024})`)
      .argParser(parsePositiveIntegerOption("disk-gib"))
      .conflicts("diskMib"),
  );
  command.requiredOption("--dockerfile <path>", "Dockerfile path used to build the rootfs");
  command.option("--ssh-user <user>", `Guest SSH user (default: ${defaults.sshUser})`);
  command.option("--json [value]", "Emit JSON output for scripting");
  command.action(async (options: CreateCommandOptions) => {
    const input = parseCreateInput(options);
    await handleCreate(input);
  });
};
