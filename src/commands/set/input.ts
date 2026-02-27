import { z } from "zod";
import { parseBooleanOption, readStringOption, type BooleanOptionValue } from "../../cli/options";
import { SetInputValidationError, SetNoChangesRequestedError } from "./errors";

export type SetCommandParams = {
  idOrName: string;
  cpus?: number;
  memoryMib?: number;
  diskMib?: number;
  diskGib?: number;
  sshUser?: string;
  json?: BooleanOptionValue;
};

export const setInputSchema = z.object({
  nameOrId: z.string().min(1),
  vcpuCount: z.number().int().positive().optional(),
  memSizeMib: z.number().int().positive().optional(),
  diskSizeMib: z.number().int().positive().optional(),
  sshUser: z.string().min(1).optional(),
  outputJson: z.boolean().optional(),
});

export type SetInput = z.infer<typeof setInputSchema>;

export const parseSetInput = (params: SetCommandParams): SetInput => {
  const createError = (message: string): SetInputValidationError =>
    new SetInputValidationError(message);

  const cpus = params.cpus;
  const memoryMib = params.memoryMib;
  const diskMib = params.diskMib;
  const diskGib = params.diskGib;
  const sshUser = readStringOption(params.sshUser, "ssh-user", createError);
  const outputJson = parseBooleanOption(params.json, "json", createError);

  const changesRequested =
    cpus !== undefined ||
    memoryMib !== undefined ||
    diskMib !== undefined ||
    diskGib !== undefined ||
    sshUser !== undefined;
  if (!changesRequested) {
    throw new SetNoChangesRequestedError();
  }

  const payload = {
    nameOrId: params.idOrName,
    ...(cpus !== undefined ? { vcpuCount: cpus } : {}),
    ...(memoryMib !== undefined ? { memSizeMib: memoryMib } : {}),
    ...(diskMib
      ? { diskSizeMib: diskMib }
      : diskGib
        ? { diskSizeMib: diskGib * 1024 }
        : {}),
    ...(sshUser ? { sshUser } : {}),
    ...(outputJson ? { outputJson: true } : {}),
  };

  return setInputSchema.parse(payload);
};
