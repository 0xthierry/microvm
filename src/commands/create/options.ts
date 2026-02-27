import { resolve } from "node:path";

import type { AppConfig } from "../../config/app-config";
import type { ParsedArgs } from "../../cli/command";
import type { CreateVmOptions } from "../types";

type CommandFlags = ParsedArgs["flags"];

const getStringFlag = (flags: CommandFlags, key: string): string | undefined => {
  const value = flags.get(key);
  if (value === undefined) return undefined;
  if (value === true) {
    throw new Error(`Flag --${key} expects a value.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Flag --${key} cannot be empty.`);
  }
  return trimmed;
};

const parsePositiveInt = (raw: string, flagName: string): number => {
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Flag --${flagName} expects a positive integer, got "${raw}".`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Flag --${flagName} expects a positive integer, got "${raw}".`);
  }
  return value;
};

const parseDiskSizeMib = (flags: CommandFlags, fallbackMib: number): number => {
  const diskMib = getStringFlag(flags, "disk-mib");
  const diskGib = getStringFlag(flags, "disk-gib");
  if (diskMib && diskGib) {
    throw new Error("Use either --disk-mib or --disk-gib, not both.");
  }
  if (diskMib) return parsePositiveInt(diskMib, "disk-mib");
  if (diskGib) return parsePositiveInt(diskGib, "disk-gib") * 1024;
  return fallbackMib;
};

const parseSshUser = (raw: string): string => {
  if (/^[a-z_][a-z0-9_-]{0,31}$/.test(raw)) {
    return raw;
  }
  throw new Error(
    `Invalid ssh user "${raw}". Use lowercase letters, digits, '_' and '-' (max 32 chars).`,
  );
};

export const parseCreateOptions = (flags: CommandFlags, appConfig: AppConfig): CreateVmOptions => {
  const vmDefaults = appConfig.defaults.vm;
  const cpus = getStringFlag(flags, "cpus");
  const memoryMib = getStringFlag(flags, "memory-mib");
  const dockerfile = getStringFlag(flags, "dockerfile");
  const sshUser = getStringFlag(flags, "ssh-user");

  return {
    vcpuCount: cpus ? parsePositiveInt(cpus, "cpus") : vmDefaults.vcpuCount,
    memSizeMib: memoryMib ? parsePositiveInt(memoryMib, "memory-mib") : vmDefaults.memSizeMib,
    diskSizeMib: parseDiskSizeMib(flags, vmDefaults.diskSizeMib),
    dockerfilePath: dockerfile
      ? resolve(appConfig.paths.projectRoot, dockerfile)
      : vmDefaults.dockerfilePath,
    sshUser: parseSshUser(sshUser ?? vmDefaults.sshUser),
  };
};
