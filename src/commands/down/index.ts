import type { Command as CommanderCommand } from "commander";
import { parseDownInput, type DownCommandParams } from "./input";
import { handleDown } from "./handler";

export const registerDownCommand = (program: CommanderCommand): void => {
  const command = program.command("down <idOrName>");
  command.summary("Stop a VM and clear runtime state");
  command.description("Stop a VM and tear down its runtime networking and process state.");
  command.option("--json [value]", "Emit JSON output for scripting");
  command.action(async (idOrName: string, options: Omit<DownCommandParams, "idOrName">) => {
    const input = parseDownInput({
      idOrName,
      json: options.json,
    });
    await handleDown(input);
  });
};
