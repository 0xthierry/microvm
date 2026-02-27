import { Command } from "../../cli/command";
import { assertVmIdMiddleware } from "../middlewares/vm-id";
import { noFlagsSchema, positionalsSchema } from "../schemas";
import type { CommandDeps } from "../types";

export const downCommand = (deps: CommandDeps) =>
  new Command({
    name: "down",
    usage: "bun src/index.ts down [vm-id]",
    summary: "Alias for stop",
    schemas: {
      positionals: positionalsSchema("down", 1),
      flags: noFlagsSchema,
    },
    middlewares: [
      assertVmIdMiddleware(deps.normalizeVmId, deps.assertVmId),
    ],
    execute: async ({ parsed }) => {
      const vmId = deps.normalizeVmId(parsed.positionals[0]);
      await deps.runStop(vmId);
    },
  });
