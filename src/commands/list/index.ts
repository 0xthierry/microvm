import type { Command as CommanderCommand } from "commander";
import { parseListInput, type ListCommandOptions } from "./input";
import { handleList } from "./handler";

export const registerListCommand = (program: CommanderCommand): void => {
  const command = program.command("list");
  command.summary("List tracked VMs");
  command.description("List tracked VMs and their current stored status.");
  command.option("--json [value]", "Emit JSON output for scripting");
  command.action(async (options: ListCommandOptions) => {
    const input = parseListInput(options);
    await handleList(input);
  });
};
