import { Command } from "../../cli/command";
import { noFlagsSchema, positionalsSchema } from "../schemas";
import type { CommandDeps } from "../types";

export const helpCommand = (deps: CommandDeps) =>
  new Command({
    name: "help",
    aliases: ["--help", "-h"],
    usage: "bun src/index.ts help",
    summary: "Show help",
    schemas: {
      positionals: positionalsSchema("help", 0),
      flags: noFlagsSchema,
    },
    execute: async () => {
      console.log(deps.helpRenderer.renderHelp());
    },
  });
