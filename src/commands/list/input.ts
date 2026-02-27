import { z } from "zod";
import { parseBooleanOption, type BooleanOptionValue } from "../../cli/options";
import { ListInputValidationError } from "./errors";

export type ListCommandOptions = {
  json?: BooleanOptionValue;
};

export const listInputSchema = z.object({
  outputJson: z.boolean().optional(),
});

export type ListInput = z.infer<typeof listInputSchema>;

export const parseListInput = (options: ListCommandOptions): ListInput => {
  const createError = (message: string): ListInputValidationError =>
    new ListInputValidationError(message);
  return listInputSchema.parse({
    outputJson: parseBooleanOption(options.json, "json", createError),
  });
};
