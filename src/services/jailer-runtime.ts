import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";

import type { AppConfig } from "../config/app-config";
import type { ProcessService } from "./process";

export type JailerLayout = {
  vmDir: string;
  rootDir: string;
  apiSocketHostPath: string;
};

export type JailerProfile = {
  cgroupVersion: "2";
  parentCgroup: string;
  cgroups: string[];
  resourceLimits: string[];
};

export type JailerRuntimeService = {
  resolveBinaryPath: (binary: string) => string;
  getRuntimeUid: () => number;
  getRuntimeGid: () => number;
  prepareJailerLayout: (params: {
    vmId: string;
    firecrackerBinaryPath: string;
  }) => JailerLayout;
  stageJailerVmAssets: (params: {
    jailerLayout: JailerLayout;
    kernelSourcePath: string;
    rootfsSourcePath: string;
    runtimeUid: string;
    runtimeGid: string;
  }) => void;
  stageJailerExecRuntimeDeps: (execPath: string, jailRootDir: string) => void;
  launchJailedFirecracker: (params: {
    vmId: string;
    jailerBinaryPath: string;
    firecrackerBinaryPath: string;
    runtimeUid: string;
    runtimeGid: string;
    jailerProfile: JailerProfile;
    logPath: string;
  }) => number;
  cleanupJailerVmDir: (vmDir: string | undefined) => void;
  resolveJailerProfile: (requiredFsizeBytes: number) => JailerProfile;
};

export const createJailerRuntimeService = ({
  runner,
  appConfig,
  logStep,
}: {
  runner: ProcessService;
  appConfig: AppConfig;
  logStep: (message: string) => void;
}): JailerRuntimeService => {
  const env = appConfig.env;
  const jailerBaseDir = appConfig.paths.jailerBaseDir;
  const jailerApiSocketInJail = appConfig.defaults.jailer.apiSocketInJail;
  const jailerKernelPathInJail = appConfig.defaults.jailer.kernelPathInJail;
  const jailerRootfsPathInJail = appConfig.defaults.jailer.rootfsPathInJail;
  const defaultParentCgroup = appConfig.defaults.jailer.parentCgroup;
  const defaultCgroupMemoryMax = appConfig.defaults.jailer.cgroupMemoryMax;
  const defaultCgroupMemorySwapMax = appConfig.defaults.jailer.cgroupMemorySwapMax;
  const defaultCgroupCpuMax = appConfig.defaults.jailer.cgroupCpuMax;
  const defaultCgroupPidsMax = appConfig.defaults.jailer.cgroupPidsMax;
  const defaultRlimitNofile = appConfig.defaults.jailer.rlimitNofile;
  const defaultRlimitFsize = appConfig.defaults.jailer.rlimitFsize;

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

  const envOrDefault = (value: string | undefined, fallback: string): string => {
    return value ?? fallback;
  };

  const ensureCgroupV2Available = (): void => {
    if (!existsSync("/sys/fs/cgroup/cgroup.controllers")) {
      throw new Error(
        "cgroup v2 was requested for jailer profile but /sys/fs/cgroup/cgroup.controllers is missing.",
      );
    }
  };

  const resolveBinaryPath = (binary: string): string => {
    const resolved = runner.run(["bash", "-lc", `command -v ${binary}`]).stdout.trim();
    if (!resolved) {
      throw new Error(`Cannot resolve binary path for: ${binary}`);
    }
    return resolved;
  };

  const getRuntimeUid = (): number => {
    return env.SUDO_UID ?? process.getuid();
  };

  const getRuntimeGid = (): number => {
    return env.SUDO_GID ?? process.getgid();
  };

  const prepareJailerLayout = ({
    vmId,
    firecrackerBinaryPath,
  }: {
    vmId: string;
    firecrackerBinaryPath: string;
  }): JailerLayout => {
    const execName = basename(firecrackerBinaryPath);
    const vmDir = join(jailerBaseDir, execName, vmId);
    const rootDir = join(vmDir, "root");
    const apiSocketHostPath = join(rootDir, jailerApiSocketInJail.slice(1));
    return { vmDir, rootDir, apiSocketHostPath };
  };

  const stageFileIntoJail = (sourcePath: string, targetPath: string): void => {
    runner.runRoot(["rm", "-f", targetPath], { allowFailure: true });
    const linked = runner.runRoot(["ln", sourcePath, targetPath], { allowFailure: true });
    if (linked.exitCode === 0) return;
    runner.runRoot(["cp", "-f", sourcePath, targetPath]);
  };

  const stageJailerVmAssets = ({
    jailerLayout,
    kernelSourcePath,
    rootfsSourcePath,
    runtimeUid,
    runtimeGid,
  }: {
    jailerLayout: JailerLayout;
    kernelSourcePath: string;
    rootfsSourcePath: string;
    runtimeUid: string;
    runtimeGid: string;
  }): void => {
    const kernelTargetPath = join(jailerLayout.rootDir, jailerKernelPathInJail.slice(1));
    const rootfsTargetPath = join(jailerLayout.rootDir, jailerRootfsPathInJail.slice(1));

    runner.runRoot(["mkdir", "-p", dirname(kernelTargetPath)]);
    runner.runRoot(["mkdir", "-p", dirname(rootfsTargetPath)]);
    runner.runRoot(["rm", "-f", jailerLayout.apiSocketHostPath], { allowFailure: true });

    stageFileIntoJail(kernelSourcePath, kernelTargetPath);
    stageFileIntoJail(rootfsSourcePath, rootfsTargetPath);

    runner.runRoot(["chown", `${runtimeUid}:${runtimeGid}`, kernelTargetPath, rootfsTargetPath]);
    runner.runRoot(["chmod", "0644", kernelTargetPath, rootfsTargetPath]);
  };

  const stageJailerExecRuntimeDeps = (execPath: string, jailRootDir: string): void => {
    const ldd = runner.run(["ldd", execPath], { allowFailure: true });
    if (ldd.exitCode !== 0) {
      return;
    }
    if (ldd.stdout.includes("not a dynamic executable")) {
      return;
    }

    const hostPaths = new Set<string>();
    ldd.stdout
      .split("\n")
      .flatMap((line) => line.match(/\/[A-Za-z0-9._+\-/]+/g) ?? [])
      .forEach((path) => {
        if (existsSync(path)) {
          hostPaths.add(path);
        }
      });

    if (hostPaths.size === 0) {
      return;
    }

    logStep(`staging ${hostPaths.size} runtime linker/library file(s) for jailed firecracker`);
    [...hostPaths]
      .sort()
      .forEach((hostPath) => {
        const jailedPath = join(jailRootDir, hostPath.slice(1));
        runner.runRoot(["mkdir", "-p", dirname(jailedPath)]);
        runner.runRoot(["cp", "-f", hostPath, jailedPath]);
        runner.runRoot(["chmod", "0755", jailedPath], { allowFailure: true });
      });
  };

  const launchJailedFirecracker = ({
    vmId,
    jailerBinaryPath,
    firecrackerBinaryPath,
    runtimeUid,
    runtimeGid,
    jailerProfile,
    logPath,
  }: {
    vmId: string;
    jailerBinaryPath: string;
    firecrackerBinaryPath: string;
    runtimeUid: string;
    runtimeGid: string;
    jailerProfile: JailerProfile;
    logPath: string;
  }): number => {
    mkdirSync(dirname(logPath), { recursive: true });

    const jailerArgs = [
      jailerBinaryPath,
      "--id",
      vmId,
      "--exec-file",
      firecrackerBinaryPath,
      "--uid",
      runtimeUid,
      "--gid",
      runtimeGid,
      "--cgroup-version",
      jailerProfile.cgroupVersion,
      "--parent-cgroup",
      jailerProfile.parentCgroup,
      ...jailerProfile.cgroups.flatMap((cgroup) => ["--cgroup", cgroup]),
      ...jailerProfile.resourceLimits.flatMap((resource) => ["--resource-limit", resource]),
      "--chroot-base-dir",
      jailerBaseDir,
      "--",
      "--api-sock",
      jailerApiSocketInJail,
    ];

    const command = `nohup ${runner.shellJoin(jailerArgs)} > ${runner.shellQuote(logPath)} 2>&1 & echo $!`;
    const result = runner.runRoot(["bash", "-lc", command]);
    const pid = Number(result.stdout.trim());
    if (!Number.isFinite(pid) || pid <= 0) {
      throw new Error(`Failed to launch jailer. Output: ${result.stdout}`);
    }
    return pid;
  };

  const cleanupJailerVmDir = (vmDir: string | undefined): void => {
    if (!vmDir) return;
    const resolved = resolve(vmDir);
    const safeBase = resolve(jailerBaseDir);
    if (!(resolved === safeBase || resolved.startsWith(`${safeBase}/`))) {
      return;
    }
    runner.runRoot(["rm", "-rf", resolved], { allowFailure: true });
  };

  const resolveJailerProfile = (requiredFsizeBytes: number): JailerProfile => {
    ensureCgroupV2Available();

    const parentCgroup = envOrDefault(env.MICROVM_CGROUP_PARENT, defaultParentCgroup);
    const memoryMax = envOrDefault(env.MICROVM_CGROUP_MEMORY_MAX, defaultCgroupMemoryMax);
    const memorySwapMax = envOrDefault(env.MICROVM_CGROUP_MEMORY_SWAP_MAX, defaultCgroupMemorySwapMax);
    const cpuMax = envOrDefault(env.MICROVM_CGROUP_CPU_MAX, defaultCgroupCpuMax);
    const pidsMax = envOrDefault(env.MICROVM_CGROUP_PIDS_MAX, defaultCgroupPidsMax);
    const rlimitNoFile = envOrDefault(env.MICROVM_RLIMIT_NOFILE, defaultRlimitNofile);
    const configuredFsize = parsePositiveInt(
      envOrDefault(env.MICROVM_RLIMIT_FSIZE, defaultRlimitFsize),
      "MICROVM_RLIMIT_FSIZE",
    );
    const rlimitFsize = Math.max(configuredFsize, requiredFsizeBytes);
    if (rlimitFsize > configuredFsize) {
      logStep(
        `raising jailer fsize limit from ${configuredFsize} to ${rlimitFsize} bytes to support disk size`,
      );
    }

    return {
      cgroupVersion: "2",
      parentCgroup,
      cgroups: [
        `memory.max=${memoryMax}`,
        `memory.swap.max=${memorySwapMax}`,
        `cpu.max=${cpuMax}`,
        `pids.max=${pidsMax}`,
      ],
      resourceLimits: [
        `no-file=${rlimitNoFile}`,
        `fsize=${String(rlimitFsize)}`,
      ],
    };
  };

  return {
    resolveBinaryPath,
    getRuntimeUid,
    getRuntimeGid,
    prepareJailerLayout,
    stageJailerVmAssets,
    stageJailerExecRuntimeDeps,
    launchJailedFirecracker,
    cleanupJailerVmDir,
    resolveJailerProfile,
  };
};
