import { z } from "zod";
import { parseBooleanOption, type BooleanOptionValue } from "../../cli/options";
import { DoctorInputValidationError } from "./errors";

export type DoctorCommandOptions = {
  json?: BooleanOptionValue;
};

export const doctorInputSchema = z.object({
  outputJson: z.boolean().optional(),
});

export type DoctorInput = z.infer<typeof doctorInputSchema>;

export const parseDoctorInput = (options: DoctorCommandOptions): DoctorInput => {
  const createError = (message: string): DoctorInputValidationError =>
    new DoctorInputValidationError(message);
  return doctorInputSchema.parse({
    outputJson: parseBooleanOption(options.json, "json", createError),
  });
};
