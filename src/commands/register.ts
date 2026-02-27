import type { Command as CommanderCommand } from "commander";
import { registerCreateCommand } from "./create";
import { registerDeleteCommand } from "./delete";
import { registerDoctorCommand } from "./doctor";
import { registerDownCommand } from "./down";
import { registerHelpCommand } from "./help";
import { registerListCommand } from "./list";
import { registerSetCommand } from "./set";
import { registerSshCommand } from "./ssh";
import { registerStatusCommand } from "./status";
import { registerUpCommand } from "./up";

const commandHelpGroups: Record<string, string> = {
  create: "Lifecycle",
  up: "Lifecycle",
  down: "Lifecycle",
  delete: "Lifecycle",
  set: "Configuration",
  ssh: "Access",
  list: "Observe",
  status: "Observe",
  doctor: "Observe",
  help: "Support",
};

export const registerCommands = (program: CommanderCommand): void => {
  registerCreateCommand(program);
  registerUpCommand(program);
  registerDownCommand(program);
  registerSetCommand(program);
  registerDeleteCommand(program);
  registerSshCommand(program);
  registerListCommand(program);
  registerStatusCommand(program);
  registerDoctorCommand(program);
  registerHelpCommand(program);

  for (const command of program.commands) {
    const group = commandHelpGroups[command.name()];
    if (group) {
      command.helpGroup(group);
    }
  }
};
