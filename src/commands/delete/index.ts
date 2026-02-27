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
      assertVmIdMiddleware(deps.normalizeVmId, deps.assertVmId),
    ],
    execute: async ({ parsed }) => {
      const vmId = deps.normalizeVmId(parsed.positionals[0]);
      await deps.runDelete(vmId);
    },
  });
