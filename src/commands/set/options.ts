import type { AppConfig } from "../../config/app-config";
import type { ParsedArgs } from "../../cli/command";
import type { SetVmOptions } from "../types";

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

export const parseSetOptions = (flags: CommandFlags, appConfig: AppConfig): SetVmOptions => {
  const cpus = getStringFlag(flags, "cpus");
  const memoryMib = getStringFlag(flags, "memory-mib");
  const sshUser = getStringFlag(flags, "ssh-user");
  const hasDiskFlag = flags.has("disk-mib") || flags.has("disk-gib");
  const options: SetVmOptions = {};

  if (cpus) {
    options.vcpuCount = parsePositiveInt(cpus, "cpus");
  }
  if (memoryMib) {
    options.memSizeMib = parsePositiveInt(memoryMib, "memory-mib");
  }
  if (hasDiskFlag) {
    options.diskSizeMib = parseDiskSizeMib(flags, appConfig.defaults.vm.diskSizeMib);
  }
  if (sshUser) {
    options.sshUser = parseSshUser(sshUser);
  }
  if (Object.keys(options).length === 0) {
    throw new Error(
      "No changes requested. Pass at least one of --cpus, --memory-mib, --disk-gib/--disk-mib, --ssh-user.",
    );
  }
  return options;
};
