import type { ParsedArgs } from "../../cli/command";

export type CommandFlags = ParsedArgs["flags"];

export const getStringFlag = (flags: CommandFlags, key: string): string | undefined => {
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

const parsePositiveInt = (raw: string, descriptor: string): number => {
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${descriptor} expects a positive integer, got "${raw}".`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${descriptor} expects a positive integer, got "${raw}".`);
  }
  return value;
};

export const parsePositiveIntFlag = (raw: string, flagName: string): number =>
  parsePositiveInt(raw, `Flag --${flagName}`);

export const parseBooleanFlag = (flags: CommandFlags, key: string): boolean => {
  const value = flags.get(key);
  if (value === undefined) return false;
  if (value === true) return true;

  const normalized = value.toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") return true;
  if (normalized === "0" || normalized === "false" || normalized === "no") return false;
  throw new Error(`Flag --${key} expects a boolean value (true/false), got "${value}".`);
};

export const parseDiskSizeMiB = (flags: CommandFlags, fallbackMiB: number): number => {
  const diskMiB = getStringFlag(flags, "disk-mib");
  const diskGiB = getStringFlag(flags, "disk-gib");
  if (diskMiB && diskGiB) {
    throw new Error("Use either --disk-mib or --disk-gib, not both.");
  }
  if (diskMiB) return parsePositiveIntFlag(diskMiB, "disk-mib");
  if (diskGiB) return parsePositiveIntFlag(diskGiB, "disk-gib") * 1024;
  return fallbackMiB;
};

export const parseSshUser = (raw: string): string => {
  if (/^[a-z_][a-z0-9_-]{0,31}$/.test(raw)) {
    return raw;
  }
  throw new Error(
    `Invalid ssh user "${raw}". Use lowercase letters, digits, '_' and '-' (max 32 chars).`,
  );
};
