import { z } from "zod";

import { Command } from "../../cli/command";
import {
  assertJailerSafeVmIdMiddleware,
  assertVmIdMiddleware,
} from "../middlewares/vm-id";
import type { CommandFlags } from "../options/shared";
import { flagValueSchema, positionalsSchema } from "../schemas";
import type { CommandDeps } from "../types";
import type { StartLikeOptions } from "./options";

export const startLikeFlagsSchema = z.object({
  "no-attach": flagValueSchema.optional(),
  cpus: flagValueSchema.optional(),
  "memory-mib": flagValueSchema.optional(),
  "disk-mib": flagValueSchema.optional(),
  "disk-gib": flagValueSchema.optional(),
  dockerfile: flagValueSchema.optional(),
  "ssh-user": flagValueSchema.optional(),
}).strict();

type StartLikeCommandConfig = {
  name: "start" | "up";
  usage: string;
  summary: string;
  autoCreate: boolean;
  parseOptions: (flags: CommandFlags, appConfig: CommandDeps["appConfig"]) => StartLikeOptions;
};

export const createStartLikeCommand = (deps: CommandDeps, config: StartLikeCommandConfig) =>
  new Command({
    name: config.name,
    usage: config.usage,
    summary: config.summary,
    schemas: {
      positionals: positionalsSchema(config.name, 1),
      flags: startLikeFlagsSchema,
    },
    middlewares: [
      assertVmIdMiddleware(deps.vmIdPolicy),
      assertJailerSafeVmIdMiddleware(deps.vmIdPolicy),
    ],
    execute: async ({ parsed }) => {
      const vmId = deps.vmIdPolicy.normalizeVmId(parsed.positionals[0]);
      const options = config.parseOptions(parsed.flags, deps.appConfig);
      await deps.vmLifecycle.runStart(vmId, options.attach, config.autoCreate, options.createOptions);
    },
  });
