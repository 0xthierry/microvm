import type { AppConfig } from "../../config/app-config";
import type { SetVmOptions } from "../types";
import {
  getStringFlag,
  parseDiskSizeMiB,
  parsePositiveIntFlag,
  parseSshUser,
  type CommandFlags,
} from "../options/shared";

export const parseSetOptions = (flags: CommandFlags, appConfig: AppConfig): SetVmOptions => {
  const cpus = getStringFlag(flags, "cpus");
  const memoryMib = getStringFlag(flags, "memory-mib");
  const sshUser = getStringFlag(flags, "ssh-user");
  const hasDiskFlag = flags.has("disk-mib") || flags.has("disk-gib");
  const options: SetVmOptions = {};

  if (cpus) {
    options.vcpuCount = parsePositiveIntFlag(cpus, "cpus");
  }
  if (memoryMib) {
    options.memSizeMib = parsePositiveIntFlag(memoryMib, "memory-mib");
  }
  if (hasDiskFlag) {
    options.diskSizeMib = parseDiskSizeMiB(flags, appConfig.defaults.vm.diskSizeMib);
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
