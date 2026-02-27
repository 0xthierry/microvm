import type { AppConfig } from "../../config/app-config";
import { parseCreateOptions } from "../create/options";
import { parseBooleanFlag, type CommandFlags } from "../options/shared";

export type StartLikeOptions = {
  attach: boolean;
  createOptions: ReturnType<typeof parseCreateOptions>;
};

export const parseStartOptions = (flags: CommandFlags, appConfig: AppConfig): StartLikeOptions => ({
  attach: !parseBooleanFlag(flags, "no-attach"),
  createOptions: parseCreateOptions(flags, appConfig),
});
