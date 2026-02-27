import { z } from "zod";

import { Command } from "../../cli/command";
import {
  assertJailerSafeVmIdMiddleware,
  assertVmIdMiddleware,
} from "../middlewares/vm-id";
import { flagValueSchema, positionalsSchema } from "../schemas";
import type { CommandDeps } from "../types";

const upFlagsSchema = z.object({
  "no-attach": flagValueSchema.optional(),
  cpus: flagValueSchema.optional(),
  "memory-mib": flagValueSchema.optional(),
  "disk-mib": flagValueSchema.optional(),
  "disk-gib": flagValueSchema.optional(),
  dockerfile: flagValueSchema.optional(),
  "ssh-user": flagValueSchema.optional(),
}).strict();

export const upCommand = (deps: CommandDeps) =>
  new Command({
    name: "up",
    usage: "bun src/index.ts up [vm-id] [--no-attach] [create flags...]",
    summary: "Start VM and auto-create if missing",
    schemas: {
      positionals: positionalsSchema("up", 1),
      flags: upFlagsSchema,
    },
    middlewares: [
      assertVmIdMiddleware(deps.normalizeVmId, deps.assertVmId),
      assertJailerSafeVmIdMiddleware(deps.normalizeVmId, deps.assertJailerSafeVmId),
    ],
    execute: async ({ parsed }) => {
      const vmId = deps.normalizeVmId(parsed.positionals[0]);
      const attach = !deps.getBooleanFlag(parsed.flags, "no-attach");
      await deps.runStart(vmId, attach, true, deps.parseCreateOptions(parsed.flags));
    },
  });
