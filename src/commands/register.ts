import { CommandRegistry } from "../cli/registry";
import type { CommandDeps } from "./types";

import { createCommand } from "./create";
import { deleteCommand } from "./delete";
import { downCommand } from "./down";
import { helpCommand } from "./help";
import { listCommand } from "./list";
import { setCommand } from "./set";
import { sshCommand } from "./ssh";
import { startCommand } from "./start";
import { statusCommand } from "./status";
import { stopCommand } from "./stop";
import { upCommand } from "./up";

export const createCommandRegistry = (deps: CommandDeps): CommandRegistry => {
  const registry = new CommandRegistry();

  registry.register(createCommand(deps));
  registry.register(startCommand(deps));
  registry.register(setCommand(deps));
  registry.register(stopCommand(deps));
  registry.register(deleteCommand(deps));
  registry.register(sshCommand(deps));
  registry.register(statusCommand(deps));
  registry.register(listCommand(deps));
  registry.register(upCommand(deps));
  registry.register(downCommand(deps));
  registry.register(helpCommand(deps));

  return registry;
};
