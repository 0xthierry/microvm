import { z } from "zod";

import { Command } from "../../cli/command";
import {
  assertJailerSafeVmIdMiddleware,
  assertVmIdMiddleware,
} from "../middlewares/vm-id";
import { flagValueSchema, positionalsSchema } from "../schemas";
import type { CommandDeps } from "../types";

const startFlagsSchema = z.object({
  "no-attach": flagValueSchema.optional(),
  cpus: flagValueSchema.optional(),
  "memory-mib": flagValueSchema.optional(),
  "disk-mib": flagValueSchema.optional(),
  "disk-gib": flagValueSchema.optional(),
  dockerfile: flagValueSchema.optional(),
  "ssh-user": flagValueSchema.optional(),
}).strict();

export const startCommand = (deps: CommandDeps) =>
  new Command({
    name: "start",
    usage: "bun src/index.ts start [vm-id] [--no-attach]",
    summary: "Start an existing VM",
    schemas: {
      positionals: positionalsSchema("start", 1),
      flags: startFlagsSchema,
    },
    middlewares: [
      assertVmIdMiddleware(deps.normalizeVmId, deps.assertVmId),
      assertJailerSafeVmIdMiddleware(deps.normalizeVmId, deps.assertJailerSafeVmId),
    ],
    execute: async ({ parsed }) => {
      const vmId = deps.normalizeVmId(parsed.positionals[0]);
      const attach = !deps.getBooleanFlag(parsed.flags, "no-attach");
      await deps.runStart(vmId, attach, false, deps.parseCreateOptions(parsed.flags));
    },
  });
