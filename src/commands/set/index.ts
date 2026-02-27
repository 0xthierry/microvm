import { z } from "zod";

import { Command } from "../../cli/command";
import { assertVmIdMiddleware } from "../middlewares/vm-id";
import { flagValueSchema, positionalsSchema } from "../schemas";
import type { CommandDeps } from "../types";

const setFlagsSchema = z.object({
  cpus: flagValueSchema.optional(),
  "memory-mib": flagValueSchema.optional(),
  "disk-mib": flagValueSchema.optional(),
  "disk-gib": flagValueSchema.optional(),
  "ssh-user": flagValueSchema.optional(),
}).strict();

export const setCommand = (deps: CommandDeps) =>
  new Command({
    name: "set",
    usage: "bun src/index.ts set [vm-id] [--cpus N] [--memory-mib N] [--disk-gib N|--disk-mib N] [--ssh-user USER]",
    summary: "Update VM configuration",
    schemas: {
      positionals: positionalsSchema("set", 1),
      flags: setFlagsSchema,
    },
    middlewares: [
      assertVmIdMiddleware(deps.normalizeVmId, deps.assertVmId),
    ],
    execute: async ({ parsed }) => {
      const vmId = deps.normalizeVmId(parsed.positionals[0]);
      await deps.runSet(vmId, deps.parseSetOptions(parsed.flags));
    },
  });
