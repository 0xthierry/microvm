import { resolve } from "node:path";

import type { AppConfig } from "../../config/app-config";
import type { CreateVmOptions } from "../types";
import {
  getStringFlag,
  parseDiskSizeMiB,
  parsePositiveIntFlag,
  parseSshUser,
  type CommandFlags,
} from "../options/shared";

export const parseCreateOptions = (flags: CommandFlags, appConfig: AppConfig): CreateVmOptions => {
  const vmDefaults = appConfig.defaults.vm;
  const cpus = getStringFlag(flags, "cpus");
  const memoryMib = getStringFlag(flags, "memory-mib");
  const dockerfile = getStringFlag(flags, "dockerfile");
  const sshUser = getStringFlag(flags, "ssh-user");

  return {
    vcpuCount: cpus ? parsePositiveIntFlag(cpus, "cpus") : vmDefaults.vcpuCount,
    memSizeMib: memoryMib ? parsePositiveIntFlag(memoryMib, "memory-mib") : vmDefaults.memSizeMib,
    diskSizeMib: parseDiskSizeMiB(flags, vmDefaults.diskSizeMib),
    dockerfilePath: dockerfile
      ? resolve(appConfig.paths.projectRoot, dockerfile)
      : vmDefaults.dockerfilePath,
    sshUser: parseSshUser(sshUser ?? vmDefaults.sshUser),
  };
};
