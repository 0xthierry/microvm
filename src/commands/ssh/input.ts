import { z } from "zod";
import { parseBooleanOption, type BooleanOptionValue } from "../../cli/options";
import { SshInputValidationError } from "./errors";

export type SshCommandParams = {
  idOrName: string;
  command?: string[];
  json?: BooleanOptionValue;
};

export const sshInputSchema = z.object({
  nameOrId: z.string().min(1),
  command: z.string().optional(),
  outputJson: z.boolean().optional(),
});

export type SshInput = z.infer<typeof sshInputSchema>;

export const parseSshInput = (params: SshCommandParams): SshInput => {
  const createError = (message: string): SshInputValidationError =>
    new SshInputValidationError(message);
  return sshInputSchema.parse({
    nameOrId: params.idOrName,
    ...(params.command && params.command.length > 0 ? { command: params.command.join(" ") } : {}),
    outputJson: parseBooleanOption(params.json, "json", createError),
  });
};
