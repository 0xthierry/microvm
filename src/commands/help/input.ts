import { z } from "zod";
import { parseBooleanOption, type BooleanOptionValue } from "../../cli/options";
import { HelpInputValidationError } from "./errors";

export type HelpCommandParams = {
  topic?: string;
  json?: BooleanOptionValue;
};

export const helpInputSchema = z.object({
  topic: z.string().optional(),
  outputJson: z.boolean().optional(),
});

export type HelpInput = z.infer<typeof helpInputSchema>;

export const parseHelpInput = (params: HelpCommandParams): HelpInput => {
  const createError = (message: string): HelpInputValidationError =>
    new HelpInputValidationError(message);
  return helpInputSchema.parse({
    topic: params.topic,
    outputJson: parseBooleanOption(params.json, "json", createError),
  });
};
