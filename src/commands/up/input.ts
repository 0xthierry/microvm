import { z } from "zod";
import { parseBooleanOption, type BooleanOptionValue } from "../../cli/options";
import { UpInputValidationError } from "./errors";

export type UpCommandParams = {
  idOrName: string;
  noAttach?: BooleanOptionValue;
  json?: BooleanOptionValue;
};

export const upInputSchema = z.object({
  nameOrId: z.string().min(1),
  attach: z.boolean(),
  outputJson: z.boolean().optional(),
});

export type UpInput = z.infer<typeof upInputSchema>;

export const parseUpInput = (params: UpCommandParams): UpInput => {
  const createError = (message: string): UpInputValidationError =>
    new UpInputValidationError(message);

  const noAttach = parseBooleanOption(params.noAttach, "no-attach", createError);
  const outputJson = parseBooleanOption(params.json, "json", createError);

  return upInputSchema.parse({
    nameOrId: params.idOrName,
    attach: !noAttach,
    outputJson,
  });
};
