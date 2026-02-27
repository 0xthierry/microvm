import { Command } from "../../cli/command";
import { noFlagsSchema, positionalsSchema } from "../schemas";
import type { CommandDeps } from "../types";

export const statusCommand = (deps: CommandDeps) =>
  new Command({
    name: "status",
    usage: "bun src/index.ts status [vm-id]",
    summary: "Print VM status",
    schemas: {
      positionals: positionalsSchema("status", 1),
      flags: noFlagsSchema,
    },
    execute: async ({ parsed }) => {
      await deps.vmLifecycle.runStatus(parsed.positionals[0]);
    },
  });
