import { z } from "zod";
import { parseBooleanOption, type BooleanOptionValue } from "../../cli/options";
import { StatusInputValidationError } from "./errors";

export type StatusCommandParams = {
  idOrName: string;
  json?: BooleanOptionValue;
};

export const statusInputSchema = z.object({
  nameOrId: z.string().min(1),
  outputJson: z.boolean().optional(),
});

export type StatusInput = z.infer<typeof statusInputSchema>;

export const parseStatusInput = (params: StatusCommandParams): StatusInput => {
  const createError = (message: string): StatusInputValidationError =>
    new StatusInputValidationError(message);
  return statusInputSchema.parse({
    nameOrId: params.idOrName,
    outputJson: parseBooleanOption(params.json, "json", createError),
  });
};
