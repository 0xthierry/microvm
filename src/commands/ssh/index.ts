import { Command } from "../../cli/command";
import { assertVmIdMiddleware } from "../middlewares/vm-id";
import { noFlagsSchema, positionalsSchema } from "../schemas";
import type { CommandDeps } from "../types";

export const sshCommand = (deps: CommandDeps) =>
  new Command({
    name: "ssh",
    usage: "bun src/index.ts ssh [vm-id]",
    summary: "Attach SSH to running VM",
    schemas: {
      positionals: positionalsSchema("ssh", 1),
      flags: noFlagsSchema,
    },
    middlewares: [
      assertVmIdMiddleware(deps.normalizeVmId, deps.assertVmId),
    ],
    execute: async ({ parsed }) => {
      const vmId = deps.normalizeVmId(parsed.positionals[0]);
      await deps.runSsh(vmId);
    },
  });
