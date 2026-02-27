import { z } from "zod";

const optionalTrimmedString = (description: string) =>
  z.preprocess(
    (value) => {
      if (value === undefined || value === null) return undefined;
      if (typeof value !== "string") return value;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    },
    z.string().optional(),
  ).describe(description);

const optionalPositiveInt = (description: string) =>
  z.preprocess(
    (value) => {
      if (value === undefined || value === null) return undefined;
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed.length === 0) return undefined;
        return Number(trimmed);
      }
      return value;
    },
    z.number().int().positive().optional(),
  ).describe(description);

export const sudoIdentityEnvSchema = z.object({
  SUDO_UID: optionalPositiveInt(
    "Numeric UID of the invoking user when running under sudo; used for jailer uid drop.",
  ),
  SUDO_GID: optionalPositiveInt(
    "Numeric GID of the invoking user when running under sudo; used for jailer gid drop.",
  ),
  SUDO_USER: optionalTrimmedString(
    "Invoking username when running under sudo; used for TAP ownership.",
  ),
  USER: optionalTrimmedString(
    "Current shell username fallback when sudo context is unavailable.",
  ),
});

export const cgroupEnvSchema = z.object({
  MICROVM_CGROUP_PARENT: optionalTrimmedString(
    "Parent cgroup name used by jailer for v2 cgroup placement.",
  ),
  MICROVM_CGROUP_MEMORY_MAX: optionalTrimmedString(
    "Value for cgroup v2 memory.max applied to jailed microVMs.",
  ),
  MICROVM_CGROUP_MEMORY_SWAP_MAX: optionalTrimmedString(
    "Value for cgroup v2 memory.swap.max applied to jailed microVMs.",
  ),
  MICROVM_CGROUP_CPU_MAX: optionalTrimmedString(
    "Value for cgroup v2 cpu.max applied to jailed microVMs.",
  ),
  MICROVM_CGROUP_PIDS_MAX: optionalTrimmedString(
    "Value for cgroup v2 pids.max applied to jailed microVMs.",
  ),
});

export const rlimitEnvSchema = z.object({
  MICROVM_RLIMIT_NOFILE: optionalTrimmedString(
    "Value for jailer resource-limit no-file.",
  ),
  MICROVM_RLIMIT_FSIZE: optionalTrimmedString(
    "Value for jailer resource-limit fsize (bytes).",
  ),
});

export const runtimeLocationEnvSchema = z.object({
  MICROVM_HOME: optionalTrimmedString(
    "Explicit microvm state directory override.",
  ),
  XDG_DATA_HOME: optionalTrimmedString(
    "XDG data home used for persistent VM data (disks/keys).",
  ),
  XDG_STATE_HOME: optionalTrimmedString(
    "XDG state home used for persistent runtime state when MICROVM_HOME is not set.",
  ),
  XDG_CACHE_HOME: optionalTrimmedString(
    "XDG cache home used for rebuildable artifacts and temporary files.",
  ),
  XDG_RUNTIME_DIR: optionalTrimmedString(
    "XDG runtime dir used for ephemeral runtime sockets/files.",
  ),
  HOME: optionalTrimmedString(
    "Home directory fallback used to resolve XDG state location defaults.",
  ),
});

export const envSchema = sudoIdentityEnvSchema
  .merge(cgroupEnvSchema)
  .merge(rlimitEnvSchema)
  .merge(runtimeLocationEnvSchema);

export type Environment = z.infer<typeof envSchema>;

export const loadEnvironment = (rawEnv: NodeJS.ProcessEnv = process.env): Environment =>
  envSchema.parse(rawEnv);
