import type { CommandDeps } from "../types";
import { parseStartOptions } from "./options";
import { createStartLikeCommand } from "./shared";

export const startCommand = (deps: CommandDeps) =>
  createStartLikeCommand(deps, {
    name: "start",
    usage: "bun src/index.ts start [vm-id] [--no-attach]",
    summary: "Start an existing VM",
    autoCreate: false,
    parseOptions: parseStartOptions,
  });
