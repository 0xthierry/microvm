import type { Command as CommanderCommand } from "commander";
import { parseDeleteInput, type DeleteCommandParams } from "./input";
import { handleDelete } from "./handler";

export const registerDeleteCommand = (program: CommanderCommand): void => {
  const command = program.command("delete <idOrName>");
  command.summary("Delete a VM record and its files");
  command.description("Delete a VM record and its on-disk artifacts. Running VMs are stopped first.");
  command.option("--json [value]", "Emit JSON output for scripting");
  command.action(async (idOrName: string, options: Omit<DeleteCommandParams, "idOrName">) => {
    const input = parseDeleteInput({
      idOrName,
      json: options.json,
    });
    await handleDelete(input);
  });
};
