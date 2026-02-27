import type { AppConfig } from "../../config/app-config";
import type { ParsedArgs } from "../../cli/command";
import { parseCreateOptions } from "../create/options";

type CommandFlags = ParsedArgs["flags"];

const getBooleanFlag = (flags: CommandFlags, key: string): boolean => {
  const value = flags.get(key);
  if (value === undefined) return false;
  if (value === true) return true;

  const normalized = value.toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") return true;
  if (normalized === "0" || normalized === "false" || normalized === "no") return false;
  throw new Error(`Flag --${key} expects a boolean value (true/false), got "${value}".`);
};

export const parseStartOptions = (flags: CommandFlags, appConfig: AppConfig) => ({
  attach: !getBooleanFlag(flags, "no-attach"),
  createOptions: parseCreateOptions(flags, appConfig),
});
