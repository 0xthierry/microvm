import { Command } from "../../cli/command";
import { assertVmIdMiddleware } from "../middlewares/vm-id";
import { noFlagsSchema, positionalsSchema } from "../schemas";
import type { CommandDeps } from "../types";

export const stopCommand = (deps: CommandDeps) =>
  new Command({
    name: "stop",
    usage: "bun src/index.ts stop [vm-id]",
    summary: "Stop a running VM",
    schemas: {
      positionals: positionalsSchema("stop", 1),
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
