import type { CommandDeps } from "../types";
import { parseStartOptions } from "../start/options";
import { createStartLikeCommand } from "../start/shared";

export const upCommand = (deps: CommandDeps) =>
  createStartLikeCommand(deps, {
    name: "up",
    usage: "bun src/index.ts up [vm-id] [--no-attach] [create flags...]",
    summary: "Start VM and auto-create if missing",
    autoCreate: true,
    parseOptions: parseStartOptions,
  });
