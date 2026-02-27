import { z } from "zod";

import { Command } from "../../cli/command";
import {
  assertJailerSafeVmIdMiddleware,
  assertVmIdMiddleware,
} from "../middlewares/vm-id";
import { flagValueSchema, positionalsSchema } from "../schemas";
import type { CommandDeps } from "../types";
import { parseStartOptions } from "./options";

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
      assertVmIdMiddleware(deps.vmIdPolicy),
      assertJailerSafeVmIdMiddleware(deps.vmIdPolicy),
    ],
    execute: async ({ parsed }) => {
      const vmId = deps.vmIdPolicy.normalizeVmId(parsed.positionals[0]);
      const options = parseStartOptions(parsed.flags, deps.appConfig);
      await deps.vmLifecycle.runStart(vmId, options.attach, false, options.createOptions);
    },
  });
