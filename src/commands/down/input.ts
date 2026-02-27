import { z } from "zod";
import { parseBooleanOption, type BooleanOptionValue } from "../../cli/options";
import { DownInputValidationError } from "./errors";

export type DownCommandParams = {
  idOrName: string;
  json?: BooleanOptionValue;
};

export const downInputSchema = z.object({
  nameOrId: z.string().min(1),
  outputJson: z.boolean().optional(),
});

export type DownInput = z.infer<typeof downInputSchema>;

export const parseDownInput = (params: DownCommandParams): DownInput => {
  const createError = (message: string): DownInputValidationError =>
    new DownInputValidationError(message);
  return downInputSchema.parse({
    nameOrId: params.idOrName,
    outputJson: parseBooleanOption(params.json, "json", createError),
  });
};
