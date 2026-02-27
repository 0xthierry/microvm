import type { ParsedArgs } from "../cli/command";

export type CreateVmOptions = {
  vcpuCount: number;
  memSizeMib: number;
  diskSizeMib: number;
  dockerfilePath: string;
  sshUser: string;
};

export type SetVmOptions = {
  vcpuCount?: number;
  memSizeMib?: number;
  diskSizeMib?: number;
  sshUser?: string;
};

export type CommandDeps = {
  normalizeVmId: (vmId: string | undefined) => string;
  assertVmId: (vmId: string) => void;
  assertJailerSafeVmId: (vmId: string) => void;
  assertJailerSocketPathLength: (vmId: string) => void;
  parseCreateOptions: (flags: ParsedArgs["flags"]) => CreateVmOptions;
  parseSetOptions: (flags: ParsedArgs["flags"]) => SetVmOptions;
  getBooleanFlag: (flags: ParsedArgs["flags"], key: string) => boolean;
  runCreate: (vmId: string, options: CreateVmOptions) => Promise<void>;
  runStart: (
    vmId: string,
    attach: boolean,
    autoCreate: boolean,
    createOptions: CreateVmOptions,
  ) => Promise<void>;
  runStop: (vmId: string) => Promise<void>;
  runSet: (vmId: string, options: SetVmOptions) => Promise<void>;
  runDelete: (vmId: string) => Promise<void>;
  runSsh: (vmId: string) => Promise<void>;
  runStatus: (vmIdArg?: string) => Promise<void>;
  runList: () => Promise<void>;
  renderHelp: () => string;
};
