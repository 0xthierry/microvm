import { z } from "zod";

import { Command } from "../../cli/command";
import {
  assertJailerSafeVmIdMiddleware,
  assertJailerSocketPathLengthMiddleware,
  assertVmIdMiddleware,
} from "../middlewares/vm-id";
import { flagValueSchema, positionalsSchema } from "../schemas";
import type { CommandDeps } from "../types";

const createFlagsSchema = z.object({
  cpus: flagValueSchema.optional(),
  "memory-mib": flagValueSchema.optional(),
  "disk-mib": flagValueSchema.optional(),
  "disk-gib": flagValueSchema.optional(),
  dockerfile: flagValueSchema.optional(),
  "ssh-user": flagValueSchema.optional(),
}).strict();

export const createCommand = (deps: CommandDeps) =>
  new Command({
    name: "create",
    usage: "bun src/index.ts create [vm-id] [--cpus N] [--memory-mib N] [--disk-gib N|--disk-mib N] [--dockerfile PATH] [--ssh-user USER]",
    summary: "Create a VM",
    schemas: {
      positionals: positionalsSchema("create", 1),
      flags: createFlagsSchema,
    },
    middlewares: [
      assertVmIdMiddleware(deps.normalizeVmId, deps.assertVmId),
      assertJailerSafeVmIdMiddleware(deps.normalizeVmId, deps.assertJailerSafeVmId),
      assertJailerSocketPathLengthMiddleware(deps.normalizeVmId, deps.assertJailerSocketPathLength),
    ],
    execute: async ({ parsed }) => {
      const vmId = deps.normalizeVmId(parsed.positionals[0]);
      await deps.runCreate(vmId, deps.parseCreateOptions(parsed.flags));
    },
  });
