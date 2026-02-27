import { resolve } from "node:path";
import { z } from "zod";
import { getAppConfig } from "../../config/runtime-context";
import { parseBooleanOption, readStringOption, type BooleanOptionValue } from "../../cli/options";
import { CreateInputValidationError } from "./errors";

export type CreateCommandOptions = {
  name?: string;
  cpus?: number;
  memoryMib?: number;
  diskMib?: number;
  diskGib?: number;
  dockerfile?: string;
  sshUser?: string;
  json?: BooleanOptionValue;
};

export const createInputSchema = z.object({
  name: z.string().min(1),
  vcpuCount: z.number().int().positive(),
  memSizeMib: z.number().int().positive(),
  diskSizeMib: z.number().int().positive(),
  dockerfilePath: z.string().min(1),
  sshUser: z.string().min(1),
  outputJson: z.boolean().optional(),
});

export type CreateInput = z.infer<typeof createInputSchema>;

export const parseCreateInput = (options: CreateCommandOptions): CreateInput => {
  const appConfig = getAppConfig();

  const createError = (message: string): CreateInputValidationError =>
    new CreateInputValidationError(message);

  const name = readStringOption(options.name, "name", createError);
  if (!name) {
    throw new CreateInputValidationError('"create" requires --name NAME.');
  }

  const cpus = options.cpus;
  const memoryMib = options.memoryMib;
  const diskMib = options.diskMib;
  const diskGib = options.diskGib;
  const dockerfile = readStringOption(options.dockerfile, "dockerfile", createError);
  if (!dockerfile) {
    throw new CreateInputValidationError('"create" requires --dockerfile PATH.');
  }
  const sshUser = readStringOption(options.sshUser, "ssh-user", createError);

  const outputJson = parseBooleanOption(options.json, "json", createError);

  const diskSizeMib = diskMib
    ? diskMib
    : diskGib
      ? diskGib * 1024
      : appConfig.defaults.vm.diskSizeMib;

  return createInputSchema.parse({
    name,
    vcpuCount: cpus ?? appConfig.defaults.vm.vcpuCount,
    memSizeMib: memoryMib ?? appConfig.defaults.vm.memSizeMib,
    diskSizeMib,
    dockerfilePath: resolve(appConfig.paths.projectRoot, dockerfile),
    sshUser: sshUser ?? appConfig.defaults.vm.sshUser,
    outputJson,
  });
};
