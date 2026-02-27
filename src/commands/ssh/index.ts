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
      assertVmIdMiddleware(deps.vmIdPolicy),
    ],
    execute: async ({ parsed }) => {
      const vmId = deps.vmIdPolicy.normalizeVmId(parsed.positionals[0]);
      await deps.vmLifecycle.runSsh(vmId);
    },
  });
