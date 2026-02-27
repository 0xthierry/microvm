import { Option, type Command as CommanderCommand } from "commander";
import { parsePositiveIntegerOption } from "../../cli/options";
import { parseSetInput, type SetCommandParams } from "./input";
import { handleSet } from "./handler";

export const registerSetCommand = (program: CommanderCommand): void => {
  const command = program.command("set <idOrName>");
  command.summary("Update stored VM configuration");
  command.description(
    "Update stored VM configuration. CPU and memory changes apply on the next boot; disk growth requires the VM to be stopped.",
  );
  command.option("--cpus <count>", "vCPU count to store for the next boot", parsePositiveIntegerOption("cpus"));
  command.option(
    "--memory-mib <size>",
    "Memory size in MiB to store for the next boot",
    parsePositiveIntegerOption("memory-mib"),
  );
  command.addOption(
    new Option("--disk-mib <size>", "Disk size in MiB (grow-only; requires a stopped VM)")
      .argParser(parsePositiveIntegerOption("disk-mib"))
      .conflicts("diskGib"),
  );
  command.addOption(
    new Option("--disk-gib <size>", "Disk size in GiB (grow-only; requires a stopped VM)")
      .argParser(parsePositiveIntegerOption("disk-gib"))
      .conflicts("diskMib"),
  );
  command.option("--ssh-user <user>", "SSH user to store for future SSH commands");
  command.option("--json [value]", "Emit JSON output for scripting");
  command.action(async (idOrName: string, options: Omit<SetCommandParams, "idOrName">) => {
    const input = parseSetInput({
      idOrName,
      ...(options.cpus === undefined ? {} : { cpus: options.cpus }),
      ...(options.memoryMib === undefined ? {} : { memoryMib: options.memoryMib }),
      ...(options.diskMib === undefined ? {} : { diskMib: options.diskMib }),
      ...(options.diskGib === undefined ? {} : { diskGib: options.diskGib }),
      ...(options.sshUser === undefined ? {} : { sshUser: options.sshUser }),
      ...(options.json === undefined ? {} : { json: options.json }),
    });
    await handleSet(input);
  });
};
