import type { Command as CommanderCommand } from "commander";
import { parseUpInput, type UpCommandParams } from "./input";
import { handleUp } from "./handler";

export const registerUpCommand = (program: CommanderCommand): void => {
  const command = program.command("up <idOrName>");
  command.summary("Boot a VM and wait for SSH");
  command.description("Boot a VM and wait until SSH is reachable.");
  command.option("--no-attach [value]", "Wait for SSH readiness, but do not print the SSH command");
  command.option("--json [value]", "Emit JSON output for scripting");
  command.action(async (idOrName: string, options: Omit<UpCommandParams, "idOrName">) => {
    const input = parseUpInput({
      idOrName,
      noAttach: options.noAttach,
      json: options.json,
    });
    await handleUp(input);
  });
};
