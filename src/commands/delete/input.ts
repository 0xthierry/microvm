import { z } from "zod";
import { parseBooleanOption, type BooleanOptionValue } from "../../cli/options";
import { DeleteInputValidationError } from "./errors";

export type DeleteCommandParams = {
  idOrName: string;
  json?: BooleanOptionValue;
};

export const deleteInputSchema = z.object({
  nameOrId: z.string().min(1),
  outputJson: z.boolean().optional(),
});

export type DeleteInput = z.infer<typeof deleteInputSchema>;

export const parseDeleteInput = (params: DeleteCommandParams): DeleteInput => {
  const createError = (message: string): DeleteInputValidationError =>
    new DeleteInputValidationError(message);
  return deleteInputSchema.parse({
    nameOrId: params.idOrName,
    outputJson: parseBooleanOption(params.json, "json", createError),
  });
};
