import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { getAppConfig } from "../../config/runtime-context";
import { processRunner } from "../../lib/process/process-runner";

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

const parsePositiveInt = (raw: string, settingName: string): number => {
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Setting ${settingName} expects a positive integer, got "${raw}".`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Setting ${settingName} expects a positive integer, got "${raw}".`);
  }
  return value;
};

export class JailerClient {
  private readonly config = getAppConfig();

  private stageFileIntoJail(sourcePath: string, targetPath: string): void {
    processRunner.run(["rm", "-f", targetPath], {
      allowFailure: true,
    });

    const linked = processRunner.run(["ln", sourcePath, targetPath], {
      allowFailure: true,
    });
    if (linked.exitCode === 0) {
      return;
    }

    processRunner.run(["cp", "-f", sourcePath, targetPath]);
  }

  resolveBinaryPath(binary: string): string {
    const resolved = processRunner.run(
      ["bash", "-lc", `command -v -- ${processRunner.shellQuote(binary)}`],
      { allowFailure: true },
    );

    const value = resolved.stdout.trim();
    if (resolved.exitCode !== 0 || value.length === 0) {
      throw new Error(`Cannot resolve binary path for: ${binary}`);
    }

    return value;
  }

  getRuntimeUid(): number {
    const sudoUid = process.env["SUDO_UID"];
    if (sudoUid) {
      return Number(sudoUid);
    }
    return typeof process.getuid === "function" ? process.getuid() : 0;
  }

  getRuntimeGid(): number {
    const sudoGid = process.env["SUDO_GID"];
    if (sudoGid) {
      return Number(sudoGid);
    }
    return typeof process.getgid === "function" ? process.getgid() : 0;
  }

  prepareLayout(params: {
    vmId: string;
    firecrackerBinaryPath: string;
  }): JailerLayout {
    const execName = basename(params.firecrackerBinaryPath);
    const vmDir = join(this.config.paths.jailerBaseDir, execName, params.vmId);
    const rootDir = join(vmDir, "root");
    const apiSocketHostPath = join(rootDir, this.config.defaults.jailer.apiSocketInJail.slice(1));

    mkdirSync(rootDir, { recursive: true });

    return {
      vmDir,
      rootDir,
      apiSocketHostPath,
    };
  }

  stageVmAssets(params: {
    layout: JailerLayout;
    kernelSourcePath: string;
    rootfsSourcePath: string;
    runtimeUid: string;
    runtimeGid: string;
  }): void {
    const kernelTarget = join(params.layout.rootDir, this.config.defaults.jailer.kernelPathInJail.slice(1));
    const rootfsTarget = join(params.layout.rootDir, this.config.defaults.jailer.rootfsPathInJail.slice(1));

    mkdirSync(dirname(kernelTarget), { recursive: true });
    mkdirSync(dirname(rootfsTarget), { recursive: true });

    this.stageFileIntoJail(params.kernelSourcePath, kernelTarget);
    this.stageFileIntoJail(params.rootfsSourcePath, rootfsTarget);
    processRunner.runRoot(["chown", `${params.runtimeUid}:${params.runtimeGid}`, kernelTarget, rootfsTarget]);
    processRunner.runRoot(["chmod", "0644", kernelTarget, rootfsTarget]);
  }

  stageExecRuntimeDeps(execPath: string, jailRootDir: string): void {
    const ldd = processRunner.run(["ldd", execPath], {
      allowFailure: true,
    });

    if (ldd.exitCode !== 0 || ldd.stdout.includes("not a dynamic executable")) {
      return;
    }

    const libs = new Set<string>();
    for (const line of ldd.stdout.split("\n")) {
      const matches = line.match(/\/[A-Za-z0-9._+\-/]+/g) ?? [];
      for (const match of matches) {
        if (existsSync(match)) {
          libs.add(match);
        }
      }
    }

    for (const hostPath of libs) {
      const target = join(jailRootDir, hostPath.slice(1));
      mkdirSync(dirname(target), { recursive: true });
      processRunner.run(["cp", "-f", hostPath, target]);
      processRunner.run(["chmod", "0755", target]);
    }
  }

  launch(params: {
    vmId: string;
    jailerBinaryPath: string;
    firecrackerBinaryPath: string;
    runtimeUid: string;
    runtimeGid: string;
    profile: JailerProfile;
    logPath: string;
  }): number {
    mkdirSync(dirname(params.logPath), { recursive: true });

    const args = [
      params.jailerBinaryPath,
      "--id",
      params.vmId,
      "--exec-file",
      params.firecrackerBinaryPath,
      "--uid",
      params.runtimeUid,
      "--gid",
      params.runtimeGid,
      "--cgroup-version",
      params.profile.cgroupVersion,
      "--parent-cgroup",
      params.profile.parentCgroup,
      ...params.profile.cgroups.flatMap((value) => ["--cgroup", value]),
      ...params.profile.resourceLimits.flatMap((value) => ["--resource-limit", value]),
      "--chroot-base-dir",
      this.config.paths.jailerBaseDir,
      "--",
      "--api-sock",
      this.config.defaults.jailer.apiSocketInJail,
    ];

    const command = `nohup ${processRunner.shellJoin(args)} > ${processRunner.shellQuote(params.logPath)} 2>&1 & echo $!`;
    const launched = processRunner.runRoot(["bash", "-lc", command]);
    const pid = Number(launched.stdout.trim());

    if (!Number.isFinite(pid) || pid <= 0) {
      throw new Error(`Failed to launch jailer. Output: ${launched.stdout}`);
    }

    return pid;
  }

  stopVmProcess(params: {
    vmId: string;
    pid: number;
    jailerVmDir?: string;
  }): void {
    const pidString = String(params.pid);
    const procRoot = `/proc/${pidString}`;
    if (!this.isProcessActive(procRoot)) {
      return;
    }

    const cmdlineRaw = this.readProcFile(`${procRoot}/cmdline`);
    if (cmdlineRaw === undefined) {
      throw new Error(`Cannot read process cmdline for PID ${pidString}.`);
    }
    const cgroupRaw = this.readProcFile(`${procRoot}/cgroup`) ?? "";
    const procRootPath = this.readProcSymlink(`${procRoot}/root`);
    const cmdline = cmdlineRaw.replaceAll("\u0000", " ").replace(/\s+/g, " ").trim();

    if (!this.matchesVmIdentity({
      cmdline,
      cgroup: cgroupRaw,
      vmId: params.vmId,
      ...(procRootPath !== undefined ? { procRootPath } : {}),
      ...(params.jailerVmDir ? { jailerVmDir: params.jailerVmDir } : {}),
    })) {
      throw new Error(`Refusing to stop PID ${pidString}: process identity does not match VM ${params.vmId}.`);
    }

    const stopped = processRunner.run(["kill", "-TERM", pidString], {
      allowFailure: true,
    });
    if (stopped.exitCode !== 0 && !this.isMissingProcessResult(stopped.stdout, stopped.stderr)) {
      throw new Error(`Failed to send SIGTERM to PID ${pidString}.`);
    }

    if (this.waitForProcessTermination(procRoot, 1200)) {
      return;
    }

    const killed = processRunner.run(["kill", "-KILL", pidString], {
      allowFailure: true,
    });
    if (killed.exitCode !== 0 && !this.isMissingProcessResult(killed.stdout, killed.stderr)) {
      throw new Error(`Failed to send SIGKILL to PID ${pidString}.`);
    }

    if (!this.waitForProcessTermination(procRoot, 1200)) {
      throw new Error(`Process ${pidString} is still running after termination attempts.`);
    }
  }

  cleanupVmDir(vmDir: string): void {
    const resolved = resolve(vmDir);
    const safeBase = resolve(this.config.paths.jailerBaseDir);
    if (!(resolved === safeBase || resolved.startsWith(`${safeBase}/`))) {
      return;
    }

    processRunner.run(["rm", "-rf", resolved], {
      allowFailure: true,
    });
  }

  resolveProfile(params: {
    requiredFsizeBytes: number;
    requiredMemoryBytes: number;
  }): JailerProfile {
    if (!existsSync("/sys/fs/cgroup/cgroup.controllers")) {
      throw new Error("cgroup v2 was requested but /sys/fs/cgroup/cgroup.controllers is missing.");
    }

    const env = process.env;
    const defaults = this.config.defaults.jailer;

    const parentCgroup = env["MICROVM_CGROUP_PARENT"] ?? defaults.parentCgroup;
    const rawMemoryMax = env["MICROVM_CGROUP_MEMORY_MAX"] ?? defaults.cgroupMemoryMax;
    const memorySwapMax = env["MICROVM_CGROUP_MEMORY_SWAP_MAX"] ?? defaults.cgroupMemorySwapMax;
    const cpuMax = env["MICROVM_CGROUP_CPU_MAX"] ?? defaults.cgroupCpuMax;
    const pidsMax = env["MICROVM_CGROUP_PIDS_MAX"] ?? defaults.cgroupPidsMax;
    const rlimitNoFile = env["MICROVM_RLIMIT_NOFILE"] ?? defaults.rlimitNofile;
    const rawConfiguredFsize = env["MICROVM_RLIMIT_FSIZE"] ?? defaults.rlimitFsize;

    let effectiveMemoryMax = rawMemoryMax;
    if (/^\d+$/.test(rawMemoryMax)) {
      const value = Number(rawMemoryMax);
      if (Number.isFinite(value) && value < params.requiredMemoryBytes) {
        if (env["MICROVM_CGROUP_MEMORY_MAX"] !== undefined) {
          throw new Error(
            `Configured MICROVM_CGROUP_MEMORY_MAX (${value} bytes) is lower than required VM memory (${params.requiredMemoryBytes} bytes).`,
          );
        }
        effectiveMemoryMax = String(params.requiredMemoryBytes);
      }
    }

    const configuredFsize = parsePositiveInt(rawConfiguredFsize, "MICROVM_RLIMIT_FSIZE");
    const effectiveFsize = Math.max(configuredFsize, params.requiredFsizeBytes);

    return {
      cgroupVersion: "2",
      parentCgroup,
      cgroups: [
        `memory.max=${effectiveMemoryMax}`,
        `memory.swap.max=${memorySwapMax}`,
        `cpu.max=${cpuMax}`,
        `pids.max=${pidsMax}`,
      ],
      resourceLimits: [
        `no-file=${rlimitNoFile}`,
        `fsize=${String(effectiveFsize)}`,
      ],
    };
  }

  private processExists(procRoot: string): boolean {
    const exists = processRunner.run(["test", "-d", procRoot], {
      allowFailure: true,
    });
    return exists.exitCode === 0;
  }

  private isProcessActive(procRoot: string): boolean {
    return this.processExists(procRoot) && !this.isZombieProcess(procRoot);
  }

  private waitForProcessTermination(procRoot: string, timeoutMs: number): boolean {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!this.isProcessActive(procRoot)) {
        return true;
      }
      processRunner.run(["sleep", "0.05"], {
        allowFailure: true,
      });
    }
    return !this.isProcessActive(procRoot);
  }

  private isZombieProcess(procRoot: string): boolean {
    const statRaw = this.readProcFile(`${procRoot}/stat`);
    if (!statRaw) {
      return false;
    }

    const closeParen = statRaw.lastIndexOf(")");
    if (closeParen < 0 || closeParen + 2 >= statRaw.length) {
      return false;
    }

    const state = statRaw[closeParen + 2];
    return state === "Z";
  }

  private readProcFile(path: string): string | undefined {
    const output = processRunner.run(["cat", path], {
      allowFailure: true,
    });
    if (output.exitCode !== 0) {
      return undefined;
    }
    return output.stdout;
  }

  private matchesVmIdentity(params: {
    cmdline: string;
    cgroup: string;
    procRootPath?: string;
    vmId: string;
    jailerVmDir?: string;
  }): boolean {
    const cmdline = ` ${params.cmdline} `;
    const vmIdToken = ` ${params.vmId} `;
    const hasVmIdInCmdline = cmdline.includes(` --id ${params.vmId} `)
      || cmdline.includes(vmIdToken)
      || cmdline.includes(`/${params.vmId}/`);

    const cgroupPaths = params.cgroup
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const parts = line.split(":");
        return (parts[2] ?? "").trim();
      })
      .filter((path) => path.length > 0);
    const vmIdCgroupSuffix = `/${params.vmId}`;
    const hasVmIdInCgroup = cgroupPaths.some((path) =>
      path === vmIdCgroupSuffix
      || path.endsWith(vmIdCgroupSuffix)
      || path.includes(`${vmIdCgroupSuffix}/`));

    const resolvedBase = resolve(this.config.paths.jailerBaseDir);
    const resolvedVmDir = params.jailerVmDir ? resolve(params.jailerVmDir) : undefined;
    const resolvedVmRootDir = resolvedVmDir ? resolve(join(resolvedVmDir, "root")) : undefined;
    const resolvedProcRootPath = params.procRootPath ? resolve(params.procRootPath) : undefined;
    const hasJailerPath = cmdline.includes(resolvedBase)
      || (resolvedVmDir ? cmdline.includes(resolvedVmDir) : false);
    const hasVmRootPath = Boolean(
      resolvedVmRootDir
      && resolvedProcRootPath
      && (resolvedProcRootPath === resolvedVmRootDir
        || resolvedProcRootPath.startsWith(`${resolvedVmRootDir}/`)),
    );

    const hasExpectedExecutable = cmdline.includes(" jailer ")
      || cmdline.includes(" firecracker ")
      || cmdline.includes("/jailer ")
      || cmdline.includes("/firecracker ");

    const hasScopedVmIdentity = hasVmRootPath || hasVmIdInCgroup || (hasJailerPath && hasVmIdInCmdline);
    return hasExpectedExecutable && hasScopedVmIdentity;
  }

  private readProcSymlink(path: string): string | undefined {
    const output = processRunner.run(["readlink", "-f", path], {
      allowFailure: true,
    });
    if (output.exitCode !== 0) {
      return undefined;
    }
    return output.stdout.trim();
  }

  private isMissingProcessResult(stdout: string, stderr: string): boolean {
    const merged = `${stdout}\n${stderr}`.toLowerCase();
    return merged.includes("no such process");
  }
}
