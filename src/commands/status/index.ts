import type { Command as CommanderCommand } from "commander";
import { parseStatusInput, type StatusCommandParams } from "./input";
import { handleStatus } from "./handler";

export const registerStatusCommand = (program: CommanderCommand): void => {
  const command = program.command("status <idOrName>");
  command.summary("Show stored VM config and tracked runtime");
  command.description("Show stored VM configuration and tracked runtime metadata.");
  command.option("--json [value]", "Emit JSON output for scripting");
  command.action(async (idOrName: string, options: Omit<StatusCommandParams, "idOrName">) => {
    const input = parseStatusInput({
      idOrName,
      json: options.json,
    });
    await handleStatus(input);
  });
};
