import { Command } from "../../cli/command";
import { noFlagsSchema, positionalsSchema } from "../schemas";
import type { CommandDeps } from "../types";

export const listCommand = (deps: CommandDeps) =>
  new Command({
    name: "list",
    usage: "bun src/index.ts list",
    summary: "Alias for status",
    schemas: {
      positionals: positionalsSchema("list", 0),
      flags: noFlagsSchema,
    },
    execute: async () => {
      await deps.runList();
    },
  });
