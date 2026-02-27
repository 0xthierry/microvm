import { Command } from "../../cli/command";
import { assertVmIdMiddleware } from "../middlewares/vm-id";
import { noFlagsSchema, positionalsSchema } from "../schemas";
import type { CommandDeps } from "../types";

export const deleteCommand = (deps: CommandDeps) =>
  new Command({
    name: "delete",
    usage: "bun src/index.ts delete [vm-id]",
    summary: "Delete VM and disk",
    schemas: {
      positionals: positionalsSchema("delete", 1),
      flags: noFlagsSchema,
    },
    middlewares: [
      assertVmIdMiddleware(deps.vmIdPolicy),
    ],
    execute: async ({ parsed }) => {
      const vmId = deps.vmIdPolicy.normalizeVmId(parsed.positionals[0]);
      await deps.vmLifecycle.runDelete(vmId);
    },
  });
