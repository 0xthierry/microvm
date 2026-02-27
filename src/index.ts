#!/usr/bin/env bun

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type VmConfig = {
  vmId: string;
  tapDev: string;
  hostIp: string;
  guestIp: string;
  maskBits: string;
  maskLong: string;
  guestMac: string;
  apiSocketPath: string;
  logPath: string;
  sshUser: string;
  vcpuCount: number;
  memSizeMib: number;
  diskSizeMib: number;
  dockerfilePath: string;
};

type KernelArtifact = {
  releaseTag: string;
  ciVersion: string;
  arch: string;
  key: string;
  url: string;
  path: string;
  version: string;
};

type RootfsArtifact = {
  source: string;
  ext4Path: string;
  buildHash: string;
};

type SshKeyPair = {
  privateKeyPath: string;
  publicKeyPath: string;
};

type RootfsBuildMeta = {
  formatVersion: number;
  dockerfilePath: string;
  dockerfileSha256: string;
  sshPubKeySha256: string;
  sshUser: string;
  source: string;
  builtAt: string;
};

type JailerLayout = {
  vmDir: string;
  rootDir: string;
  apiSocketHostPath: string;
};

type JailerProfile = {
  cgroupVersion: "2";
  parentCgroup: string;
  cgroups: string[];
  resourceLimits: string[];
};

type VmRuntimeState = {
  firecrackerPid: number;
  hostIface: string;
  apiSocketPath: string;
  bootArgs: string;
  kernelPath: string;
  jailerVmDir: string;
  firecrackerBinaryPath: string;
  jailerBinaryPath: string;
  releaseTag: string;
  kernelCiVersion: string;
  kernelVersion: string;
  startedAt: string;
};

type VmRecord = VmConfig & {
  index: number;
  rootfsPath: string;
  sshKeyPath: string;
  sshPublicKeyPath: string;
  rootfsSource: string;
  rootfsBuildHash?: string;
  createdAt: string;
  runtime?: VmRuntimeState;
};

type VmDatabase = {
  formatVersion: number;
  nextIndex: number;
  vms: Record<string, VmRecord>;
};

type SshTarget = {
  sshUser: string;
  sshKeyPath: string;
  guestIp: string;
};

type ParsedArgs = {
  positionals: string[];
  flags: Map<string, string | boolean>;
};

type CreateVmOptions = {
  vcpuCount: number;
  memSizeMib: number;
  diskSizeMib: number;
  dockerfilePath: string;
  sshUser: string;
};

type SetVmOptions = {
  vcpuCount?: number;
  memSizeMib?: number;
  diskSizeMib?: number;
  sshUser?: string;
};

const PROJECT_ROOT = process.cwd();
const WORK_DIR = resolve(PROJECT_ROOT, ".microvm");
const ARTIFACTS_DIR = join(WORK_DIR, "artifacts");
const RUNTIME_DIR = join(WORK_DIR, "runtime");
const VMS_DIR = join(WORK_DIR, "vms");
const VM_DB_FILE = join(RUNTIME_DIR, "vms.json");
const DEFAULT_ROOTFS_DOCKERFILE = resolve(PROJECT_ROOT, "Dockerfile.arch");
const ROOTFS_TMP_DIR = resolve(WORK_DIR, "tmp");
const ROOTFS_BUILD_FORMAT_VERSION = 2;
const VM_DB_FORMAT_VERSION = 1;
const DEFAULT_VM_ID = "vm0";
const DEFAULT_VM_SSH_USER = "root";
const DEFAULT_VM_VCPU_COUNT = 2;
const DEFAULT_VM_MEM_SIZE_MIB = 1024;
const DEFAULT_VM_DISK_SIZE_MIB = 10 * 1024;
const HOST_ALLOWED_TCP_PORT = "11434";
const JAILER_BASE_DIR = resolve(WORK_DIR, "jailer");
const JAILER_API_SOCKET_IN_JAIL = "/firecracker.socket";
const JAILER_KERNEL_PATH_IN_JAIL = "/kernel/vmlinux";
const JAILER_ROOTFS_PATH_IN_JAIL = "/rootfs.ext4";
const DEFAULT_JAILER_PARENT_CGROUP = "microvm";
const DEFAULT_CGROUP_MEMORY_MAX = "1610612736";
const DEFAULT_CGROUP_MEMORY_SWAP_MAX = "0";
const DEFAULT_CGROUP_CPU_MAX = "200000 100000";
const DEFAULT_CGROUP_PIDS_MAX = "512";
const DEFAULT_RLIMIT_NOFILE = "1024";
const DEFAULT_RLIMIT_FSIZE = "2147483648";
const SHARED_SSH_PRIVATE_KEY_PATH = resolve(ARTIFACTS_DIR, "keys", "microvm.id_ed25519");
const MAX_UNIX_SOCKET_PATH_LENGTH = 107;

const HELP = `
Usage:
  bun src/index.ts create [vm-id] [--cpus N] [--memory-mib N] [--disk-gib N|--disk-mib N] [--dockerfile PATH] [--ssh-user USER]
  bun src/index.ts start [vm-id] [--no-attach]
  bun src/index.ts set [vm-id] [--cpus N] [--memory-mib N] [--disk-gib N|--disk-mib N] [--ssh-user USER]
  bun src/index.ts stop [vm-id]
  bun src/index.ts delete [vm-id]
  bun src/index.ts ssh [vm-id]
  bun src/index.ts status [vm-id]
  bun src/index.ts list
  bun src/index.ts up [vm-id] [--no-attach] [create flags...]   # alias for start with auto-create
  bun src/index.ts down [vm-id]                # alias for stop

Notes:
  - default vm-id is "${DEFAULT_VM_ID}" when omitted
  - defaults: ${DEFAULT_VM_VCPU_COUNT} CPU, ${DEFAULT_VM_MEM_SIZE_MIB} MiB RAM, ${DEFAULT_VM_DISK_SIZE_MIB / 1024} GiB disk, Dockerfile.arch, ssh-user=${DEFAULT_VM_SSH_USER}
  - create builds/reuses a cached Dockerfile-based ext4 and clones per-VM ext4
  - each VM has isolated disk (.microvm/vms/<vm-id>/rootfs.ext4)
  - VM registry persists in .microvm/runtime/vms.json
`.trim();

const decoder = new TextDecoder();

const main = async (): Promise<void> => {
  const rawArgs = process.argv.slice(2);
  const command = rawArgs[0] ?? "up";
  const parsed = parseArgs(rawArgs.slice(1));
  const vmId = normalizeVmId(parsed.positionals[0]);

  if (command === "create") {
    assertNoUnexpectedPositionals(command, parsed.positionals, 1);
    assertAllowedFlags(parsed.flags, [
      "cpus",
      "memory-mib",
      "disk-mib",
      "disk-gib",
      "dockerfile",
      "ssh-user",
    ]);
    await runCreate(vmId, parseCreateOptions(parsed.flags));
    return;
  }

  if (command === "start") {
    assertNoUnexpectedPositionals(command, parsed.positionals, 1);
    assertAllowedFlags(parsed.flags, [
      "no-attach",
      "cpus",
      "memory-mib",
      "disk-mib",
      "disk-gib",
      "dockerfile",
      "ssh-user",
    ]);
    await runStart(vmId, !getBooleanFlag(parsed.flags, "no-attach"), false, parseCreateOptions(parsed.flags));
    return;
  }

  if (command === "up") {
    assertNoUnexpectedPositionals(command, parsed.positionals, 1);
    assertAllowedFlags(parsed.flags, [
      "no-attach",
      "cpus",
      "memory-mib",
      "disk-mib",
      "disk-gib",
      "dockerfile",
      "ssh-user",
    ]);
    await runStart(vmId, !getBooleanFlag(parsed.flags, "no-attach"), true, parseCreateOptions(parsed.flags));
    return;
  }

  if (command === "stop") {
    assertNoUnexpectedPositionals(command, parsed.positionals, 1);
    assertAllowedFlags(parsed.flags, []);
    await runStop(vmId);
    return;
  }

  if (command === "set") {
    assertNoUnexpectedPositionals(command, parsed.positionals, 1);
    assertAllowedFlags(parsed.flags, [
      "cpus",
      "memory-mib",
      "disk-mib",
      "disk-gib",
      "ssh-user",
    ]);
    await runSet(vmId, parseSetOptions(parsed.flags));
    return;
  }

  if (command === "delete") {
    assertNoUnexpectedPositionals(command, parsed.positionals, 1);
    assertAllowedFlags(parsed.flags, []);
    await runDelete(vmId);
    return;
  }

  if (command === "down") {
    assertNoUnexpectedPositionals(command, parsed.positionals, 1);
    assertAllowedFlags(parsed.flags, []);
    await runStop(vmId);
    return;
  }

  if (command === "ssh") {
    assertNoUnexpectedPositionals(command, parsed.positionals, 1);
    assertAllowedFlags(parsed.flags, []);
    await runSsh(vmId);
    return;
  }

  if (command === "status") {
    assertNoUnexpectedPositionals(command, parsed.positionals, 1);
    assertAllowedFlags(parsed.flags, []);
    await runStatus(parsed.positionals[0]);
    return;
  }

  if (command === "list") {
    assertNoUnexpectedPositionals(command, parsed.positionals, 0);
    assertAllowedFlags(parsed.flags, []);
    await runList();
    return;
  }

  if (command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }

  throw new Error(`Unknown command "${command}".\n\n${HELP}`);
};

const parseArgs = (args: string[]): ParsedArgs => {
  const positionals: string[] = [];
  const flags = new Map<string, string | boolean>();

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const eq = token.indexOf("=");
    const key = eq >= 0 ? token.slice(2, eq) : token.slice(2);
    if (!key) {
      throw new Error(`Invalid flag syntax: ${token}`);
    }
    if (flags.has(key)) {
      throw new Error(`Flag provided more than once: --${key}`);
    }

    if (eq >= 0) {
      flags.set(key, token.slice(eq + 1));
      continue;
    }
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(key, next);
      index += 1;
      continue;
    }
    flags.set(key, true);
  }

  return { positionals, flags };
};

const assertNoUnexpectedPositionals = (command: string, positionals: string[], maxCount: number): void => {
  if (positionals.length <= maxCount) return;
  throw new Error(
    `Too many positional arguments for "${command}". Received: ${positionals.join(" ")}`,
  );
};

const assertAllowedFlags = (flags: Map<string, string | boolean>, allowed: string[]): void => {
  const allowedSet = new Set(allowed);
  const unknown = [...flags.keys()].filter((flag) => !allowedSet.has(flag));
  if (unknown.length > 0) {
    throw new Error(`Unknown flag(s): ${unknown.map((flag) => `--${flag}`).join(", ")}`);
  }
};

const getBooleanFlag = (flags: Map<string, string | boolean>, key: string): boolean => {
  const value = flags.get(key);
  if (value === undefined) return false;
  if (value === true) return true;

  const normalized = value.toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") return true;
  if (normalized === "0" || normalized === "false" || normalized === "no") return false;
  throw new Error(`Flag --${key} expects a boolean value (true/false), got "${value}".`);
};

const getStringFlag = (flags: Map<string, string | boolean>, key: string): string | undefined => {
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

const parseDiskSizeMib = (flags: Map<string, string | boolean>, fallbackMib: number): number => {
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

const defaultCreateOptions = (): CreateVmOptions => ({
  vcpuCount: DEFAULT_VM_VCPU_COUNT,
  memSizeMib: DEFAULT_VM_MEM_SIZE_MIB,
  diskSizeMib: DEFAULT_VM_DISK_SIZE_MIB,
  dockerfilePath: DEFAULT_ROOTFS_DOCKERFILE,
  sshUser: DEFAULT_VM_SSH_USER,
});

const parseCreateOptions = (flags: Map<string, string | boolean>): CreateVmOptions => {
  const defaults = defaultCreateOptions();
  const cpus = getStringFlag(flags, "cpus");
  const memoryMib = getStringFlag(flags, "memory-mib");
  const dockerfile = getStringFlag(flags, "dockerfile");
  const sshUser = getStringFlag(flags, "ssh-user");

  return {
    vcpuCount: cpus ? parsePositiveInt(cpus, "cpus") : defaults.vcpuCount,
    memSizeMib: memoryMib ? parsePositiveInt(memoryMib, "memory-mib") : defaults.memSizeMib,
    diskSizeMib: parseDiskSizeMib(flags, defaults.diskSizeMib),
    dockerfilePath: resolve(PROJECT_ROOT, dockerfile ?? defaults.dockerfilePath),
    sshUser: parseSshUser(sshUser ?? defaults.sshUser),
  };
};

const parseSetOptions = (flags: Map<string, string | boolean>): SetVmOptions => {
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
    options.diskSizeMib = parseDiskSizeMib(flags, DEFAULT_VM_DISK_SIZE_MIB);
  }
  if (sshUser) {
    options.sshUser = parseSshUser(sshUser);
  }
  if (Object.keys(options).length === 0) {
    throw new Error("No changes requested. Pass at least one of --cpus, --memory-mib, --disk-gib/--disk-mib, --ssh-user.");
  }
  return options;
};

const runCreate = async (vmId: string, options: CreateVmOptions): Promise<void> => {
  assertVmId(vmId);
  assertJailerSafeVmId(vmId);
  assertJailerSocketPathLength(vmId);
  ensureDirs([WORK_DIR, ARTIFACTS_DIR, RUNTIME_DIR, VMS_DIR]);
  ensureDependencies(["docker", "mkfs.ext4", "tar", "ssh-keygen", "sudo", "e2fsck", "resize2fs"]);
  await ensureSudoSession();

  const db = readVmDatabase();
  if (db.vms[vmId]) {
    throw new Error(`VM "${vmId}" already exists.`);
  }

  const sshKeyPair = ensureSshKeyPair(SHARED_SSH_PRIVATE_KEY_PATH);
  const rootfs = await ensureRootfsFromDocker({
    dockerfilePath: options.dockerfilePath,
    sshPublicKeyPath: sshKeyPair.publicKeyPath,
    sshUser: options.sshUser,
  });

  const index = reserveVmIndex(db);
  const config = buildVmConfig(vmId, index, options);
  const vmRootfsPath = join(vmDataDir(vmId), "rootfs.ext4");
  cloneExt4Rootfs(rootfs.ext4Path, vmRootfsPath);
  growExt4DiskIfNeeded(vmRootfsPath, options.diskSizeMib);
  chmodSync(sshKeyPair.privateKeyPath, 0o600);

  const record: VmRecord = {
    ...config,
    index,
    rootfsPath: vmRootfsPath,
    sshKeyPath: sshKeyPair.privateKeyPath,
    sshPublicKeyPath: sshKeyPair.publicKeyPath,
    rootfsSource: rootfs.source,
    rootfsBuildHash: rootfs.buildHash,
    createdAt: new Date().toISOString(),
  };
  db.vms[vmId] = record;
  writeVmDatabase(db);
  logStep(
    `created VM "${vmId}" with cpus=${options.vcpuCount}, memory=${options.memSizeMib} MiB, disk=${options.diskSizeMib} MiB, ssh-user=${options.sshUser}`,
  );
  logStep(`VM "${vmId}" isolated disk: ${vmRootfsPath}`);
};

const runStart = async (
  vmId: string,
  attach: boolean,
  autoCreate: boolean,
  createOptions: CreateVmOptions,
): Promise<void> => {
  assertVmId(vmId);
  assertJailerSafeVmId(vmId);
  ensureDirs([WORK_DIR, ARTIFACTS_DIR, RUNTIME_DIR, VMS_DIR]);
  ensureDependencies(["firecracker", "jailer", "curl", "ip", "iptables", "ssh", "ssh-keygen", "sudo", "docker", "mkfs.ext4", "tar", "e2fsck", "resize2fs"]);
  ensureKvmAccess();
  await ensureSudoSession();

  let db = readVmDatabase();
  let vm = db.vms[vmId];
  if (!vm) {
    if (!autoCreate) {
      throw new Error(`VM "${vmId}" does not exist. Run "bun src/index.ts create ${vmId}" first.`);
    }
    logStep(`VM "${vmId}" not found, creating it now...`);
    await runCreate(vmId, createOptions);
    db = readVmDatabase();
    vm = db.vms[vmId];
  }
  if (!vm) {
    throw new Error(`Failed to load VM "${vmId}" after creation.`);
  }
  if (!existsSync(vm.rootfsPath)) {
    throw new Error(`VM rootfs is missing: ${vm.rootfsPath}`);
  }

  if (vm.runtime && isProcessAlive(vm.runtime.firecrackerPid)) {
    throw new Error(`VM "${vmId}" is already running (pid ${vm.runtime.firecrackerPid}).`);
  }
  if (vm.runtime && !isProcessAlive(vm.runtime.firecrackerPid)) {
    logStep(`found stale runtime state for "${vmId}", cleaning it up...`);
    await cleanupVmRuntime(vm);
    clearVmRuntime(vmId);
    db = readVmDatabase();
    vm = db.vms[vmId];
    if (!vm) {
      throw new Error(`VM "${vmId}" disappeared from database.`);
    }
  }

  const arch = getHostArch();
  const kernel = await resolveLatestKernelArtifact(arch);
  logStep(`latest Firecracker release: ${kernel.releaseTag}`);
  logStep(`latest kernel: ${kernel.version} (${kernel.ciVersion})`);
  logStep(`rootfs source: ${vm.rootfsSource}`);

  await downloadIfMissing(kernel.url, kernel.path);
  chmodSync(vm.sshKeyPath, 0o600);

  const firecrackerBinaryPath = resolveBinaryPath("firecracker");
  assertJailerSocketPathLength(vmId, basename(firecrackerBinaryPath));
  const jailerBinaryPath = resolveBinaryPath("jailer");
  const jailerProfile = resolveJailerProfile(vm.diskSizeMib * 1024 * 1024);
  const vmUid = String(getRuntimeUid());
  const vmGid = String(getRuntimeGid());
  const jailerLayout = prepareJailerLayout({
    vmId: vm.vmId,
    firecrackerBinaryPath,
    baseDir: JAILER_BASE_DIR,
  });
  stageJailerVmAssets({
    jailerLayout,
    kernelSourcePath: kernel.path,
    rootfsSourcePath: vm.rootfsPath,
    runtimeUid: vmUid,
    runtimeGid: vmGid,
  });
  stageJailerExecRuntimeDeps(firecrackerBinaryPath, jailerLayout.rootDir);

  const hostIface = getDefaultHostIface();
  let networkReady = false;
  let firecrackerPid = 0;

  try {
    await setupHostNetwork(vm, hostIface);
    networkReady = true;

    firecrackerPid = launchJailedFirecracker({
      vmId: vm.vmId,
      jailerBinaryPath,
      firecrackerBinaryPath,
      jailerBaseDir: JAILER_BASE_DIR,
      runtimeUid: vmUid,
      runtimeGid: vmGid,
      jailerProfile,
      logPath: vm.logPath,
    });
    await waitForFirecrackerApi(jailerLayout.apiSocketHostPath, 10_000);

    const bootArgs = buildBootArgs(vm, arch);
    await configureAndStartVm({
      config: { ...vm, apiSocketPath: jailerLayout.apiSocketHostPath },
      kernelPath: JAILER_KERNEL_PATH_IN_JAIL,
      rootfsPath: JAILER_ROOTFS_PATH_IN_JAIL,
      bootArgs,
    });

    const runtime: VmRuntimeState = {
      firecrackerPid,
      hostIface,
      apiSocketPath: jailerLayout.apiSocketHostPath,
      bootArgs,
      kernelPath: kernel.path,
      jailerVmDir: jailerLayout.vmDir,
      firecrackerBinaryPath,
      jailerBinaryPath,
      releaseTag: kernel.releaseTag,
      kernelCiVersion: kernel.ciVersion,
      kernelVersion: kernel.version,
      startedAt: new Date().toISOString(),
    };
    db = readVmDatabase();
    const persistedVm = db.vms[vmId];
    if (!persistedVm) {
      throw new Error(`VM "${vmId}" not found while persisting runtime state.`);
    }
    db.vms[vmId] = { ...persistedVm, runtime };
    writeVmDatabase(db);

    const sshTarget = toSshTarget(db.vms[vmId]);
    await waitForSshReady(sshTarget, 120_000);
    logStep(`VM "${vmId}" is ready. SSH command: ${renderSshCommand(sshTarget)}`);

    if (attach) {
      const sshExitCode = spawnInherit(sshBaseArgs(sshTarget));
      if (sshExitCode !== 0) {
        logStep(`ssh session ended with exit code ${sshExitCode}`);
      }
    }
  } catch (error) {
    if (firecrackerPid > 0) {
      stopProcess(firecrackerPid);
    }
    if (networkReady) {
      await teardownHostNetwork(vm, hostIface);
    }
    cleanupJailerVmDir(jailerLayout.vmDir);
    clearVmRuntime(vmId);
    throw error;
  }
};

const runSsh = async (vmId: string): Promise<void> => {
  assertVmId(vmId);
  const vm = getVmOrThrow(vmId);
  if (!vm.runtime || !isProcessAlive(vm.runtime.firecrackerPid)) {
    throw new Error(`VM "${vmId}" is not running.`);
  }

  const sshExitCode = spawnInherit(sshBaseArgs(toSshTarget(vm)));
  if (sshExitCode !== 0) {
    logStep(`ssh session ended with exit code ${sshExitCode}`);
  }
};

const runStop = async (vmId: string): Promise<void> => {
  assertVmId(vmId);
  const vm = getVmOrThrow(vmId);
  if (!vm.runtime) {
    logStep(`VM "${vmId}" is already stopped.`);
    return;
  }
  await ensureSudoSession();
  await cleanupVmRuntime(vm);
  clearVmRuntime(vmId);
  logStep(`VM "${vmId}" stopped and host network cleaned up.`);
};

const runSet = async (vmId: string, options: SetVmOptions): Promise<void> => {
  assertVmId(vmId);
  const db = readVmDatabase();
  const vm = db.vms[vmId];
  if (!vm) {
    throw new Error(`VM "${vmId}" does not exist.`);
  }

  const running = Boolean(vm.runtime && isProcessAlive(vm.runtime.firecrackerPid));
  const nextVcpu = options.vcpuCount ?? vm.vcpuCount;
  const nextMem = options.memSizeMib ?? vm.memSizeMib;
  const nextDisk = options.diskSizeMib ?? vm.diskSizeMib;
  const nextSshUser = options.sshUser ?? vm.sshUser;

  if (nextDisk < vm.diskSizeMib) {
    throw new Error(
      `Disk shrink is not supported (current ${vm.diskSizeMib} MiB, requested ${nextDisk} MiB).`,
    );
  }
  if (nextDisk > vm.diskSizeMib && running) {
    throw new Error(`VM "${vmId}" is running. Stop it before growing disk.`);
  }
  if (options.sshUser && options.sshUser !== vm.sshUser) {
    logStep(
      `updated ssh user to "${options.sshUser}". Ensure this user has your public key in authorized_keys inside the VM disk.`,
    );
  }

  if (nextDisk > vm.diskSizeMib) {
    ensureDependencies(["sudo", "e2fsck", "resize2fs"]);
    await ensureSudoSession();
    growExt4DiskIfNeeded(vm.rootfsPath, nextDisk);
    logStep(`resized disk for "${vmId}" from ${vm.diskSizeMib} MiB to ${nextDisk} MiB.`);
  }

  db.vms[vmId] = {
    ...vm,
    vcpuCount: nextVcpu,
    memSizeMib: nextMem,
    diskSizeMib: nextDisk,
    sshUser: nextSshUser,
  };
  writeVmDatabase(db);
  logStep(
    `updated "${vmId}": cpus=${nextVcpu}, memory=${nextMem} MiB, disk=${nextDisk} MiB, ssh-user=${nextSshUser}${running ? " (cpu/memory apply on next start)" : ""}`,
  );
};

const runDelete = async (vmId: string): Promise<void> => {
  assertVmId(vmId);
  const db = readVmDatabase();
  const vm = db.vms[vmId];
  if (!vm) {
    logStep(`VM "${vmId}" does not exist.`);
    return;
  }

  await ensureSudoSession();

  if (vm.runtime) {
    await cleanupVmRuntime(vm);
  }

  safeDelete(vm.apiSocketPath);
  safeDeleteInsideWorkDir(vmDataDir(vmId));
  safeDeleteInsideWorkDir(join(RUNTIME_DIR, vmId));
  cleanupJailerVmDir(vm.runtime?.jailerVmDir ?? join(JAILER_BASE_DIR, "firecracker", vmId));

  delete db.vms[vmId];
  writeVmDatabase(db);

  logStep(`VM "${vmId}" deleted.`);
};

const runStatus = async (vmIdArg?: string): Promise<void> => {
  const db = readVmDatabase();
  if (vmIdArg) {
    assertVmId(vmIdArg);
    const vm = db.vms[vmIdArg];
    if (!vm) {
      throw new Error(`VM "${vmIdArg}" does not exist.`);
    }
    const running = Boolean(vm.runtime && isProcessAlive(vm.runtime.firecrackerPid));
    console.log(JSON.stringify({ vm, running }, null, 2));
    return;
  }

  const summary = Object.values(db.vms)
    .sort((a, b) => a.index - b.index)
    .map((vm) => ({
      id: vm.vmId,
      index: vm.index,
      cpus: vm.vcpuCount,
      memoryMib: vm.memSizeMib,
      diskSizeMib: vm.diskSizeMib,
      sshUser: vm.sshUser,
      dockerfilePath: vm.dockerfilePath,
      guestIp: vm.guestIp,
      tapDev: vm.tapDev,
      rootfsPath: vm.rootfsPath,
      running: Boolean(vm.runtime && isProcessAlive(vm.runtime.firecrackerPid)),
      pid: vm.runtime?.firecrackerPid ?? null,
    }));
  console.log(JSON.stringify(summary, null, 2));
};

const runList = async (): Promise<void> => {
  await runStatus();
};

const ensureDirs = (paths: string[]): void => {
  paths.forEach((path) => mkdirSync(path, { recursive: true }));
};

const ensureDependencies = (binaries: string[]): void => {
  binaries.forEach((binary) => {
    const result = run(["bash", "-lc", `command -v ${binary}`], {
      allowFailure: true,
    });
    if (result.exitCode !== 0) {
      throw new Error(`Missing dependency: ${binary}`);
    }
  });
};

const ensureKvmAccess = (): void => {
  const canRead = run(["bash", "-lc", "[ -r /dev/kvm ]"], { allowFailure: true }).exitCode === 0;
  const canWrite = run(["bash", "-lc", "[ -w /dev/kvm ]"], { allowFailure: true }).exitCode === 0;
  if (!canRead || !canWrite) {
    throw new Error("Current user cannot read/write /dev/kvm.");
  }
};

const ensureSudoSession = async (): Promise<void> => {
  if (isRoot()) {
    return;
  }
  logStep("Requesting sudo for network setup...");
  run(["sudo", "-v"], { inherit: true });
};

const normalizeVmId = (vmId: string | undefined): string => {
  const value = vmId?.trim();
  return value && value.length > 0 ? value : DEFAULT_VM_ID;
};

const assertVmId = (vmId: string): void => {
  if (/^[a-z0-9][a-z0-9_-]{0,31}$/.test(vmId)) {
    return;
  }
  throw new Error(
    `Invalid vm-id "${vmId}". Use lowercase letters, digits, '_' and '-' (max 32 chars).`,
  );
};

const assertJailerSafeVmId = (vmId: string): void => {
  if (/^[a-z0-9][a-z0-9-]{0,31}$/.test(vmId)) {
    return;
  }
  throw new Error(
    `VM "${vmId}" is not jailer-safe. For create/start, use lowercase letters, digits, and '-' only.`,
  );
};

const assertJailerSocketPathLength = (vmId: string, execName = "firecracker"): void => {
  const socketPath = join(JAILER_BASE_DIR, execName, vmId, "root", JAILER_API_SOCKET_IN_JAIL.slice(1));
  if (socketPath.length <= MAX_UNIX_SOCKET_PATH_LENGTH) {
    return;
  }

  const fixedChars = socketPath.length - vmId.length;
  const maxVmIdLength = Math.max(1, MAX_UNIX_SOCKET_PATH_LENGTH - fixedChars);
  throw new Error(
    `VM id "${vmId}" is too long for this host path (socket length ${socketPath.length} > ${MAX_UNIX_SOCKET_PATH_LENGTH}). Max vm-id length here is ${maxVmIdLength}. Use a shorter vm-id or move the repo to a shorter path.`,
  );
};

const vmDataDir = (vmId: string): string => join(VMS_DIR, vmId);

const formatHexByte = (value: number): string => value.toString(16).padStart(2, "0").toUpperCase();

const buildVmConfig = (vmId: string, index: number, options: CreateVmOptions): VmConfig => {
  const subnetBase = index * 4;
  const thirdOctet = Math.floor(subnetBase / 256);
  const fourthBase = subnetBase % 256;
  if (thirdOctet > 255 || fourthBase > 252) {
    throw new Error(`VM index ${index} exceeds supported /30 address space.`);
  }

  const hostLast = fourthBase + 1;
  const guestLast = fourthBase + 2;
  const tapDev = `tap-vm${index}`;
  if (tapDev.length > 15) {
    throw new Error(`Computed tap device name is too long: ${tapDev}`);
  }

  return {
    vmId,
    tapDev,
    hostIp: `172.16.${thirdOctet}.${hostLast}`,
    guestIp: `172.16.${thirdOctet}.${guestLast}`,
    maskBits: "30",
    maskLong: "255.255.255.252",
    guestMac: `06:00:AC:10:${formatHexByte(thirdOctet)}:${formatHexByte(guestLast)}`,
    apiSocketPath: `/tmp/microvm-${vmId}.firecracker.sock`,
    logPath: join(RUNTIME_DIR, vmId, "firecracker.log"),
    sshUser: options.sshUser,
    vcpuCount: options.vcpuCount,
    memSizeMib: options.memSizeMib,
    diskSizeMib: options.diskSizeMib,
    dockerfilePath: options.dockerfilePath,
  };
};

const defaultVmDatabase = (): VmDatabase => ({
  formatVersion: VM_DB_FORMAT_VERSION,
  nextIndex: 0,
  vms: {},
});

const readVmDatabase = (): VmDatabase => {
  if (!existsSync(VM_DB_FILE)) {
    return defaultVmDatabase();
  }

  const parsed = JSON.parse(readFileSync(VM_DB_FILE, "utf8")) as Partial<VmDatabase>;
  const rawVms = parsed.vms && typeof parsed.vms === "object" ? (parsed.vms as Record<string, VmRecord>) : {};
  const nextIndex = Number(parsed.nextIndex ?? 0);
  const normalized: VmDatabase = {
    formatVersion: VM_DB_FORMAT_VERSION,
    nextIndex: Number.isFinite(nextIndex) && nextIndex >= 0 ? nextIndex : 0,
    vms: rawVms,
  };

  const maxIndex = Object.values(normalized.vms).reduce((max, vm) => {
    const index = Number(vm.index);
    return Number.isFinite(index) ? Math.max(max, index) : max;
  }, -1);
  normalized.nextIndex = Math.max(normalized.nextIndex, maxIndex + 1);
  return normalized;
};

const writeVmDatabase = (db: VmDatabase): void => {
  writeJson(VM_DB_FILE, {
    formatVersion: VM_DB_FORMAT_VERSION,
    nextIndex: db.nextIndex,
    vms: db.vms,
  });
};

const reserveVmIndex = (db: VmDatabase): number => {
  const usedIndexes = new Set(
    Object.values(db.vms)
      .map((vm) => Number(vm.index))
      .filter((index) => Number.isFinite(index)),
  );

  // Reuse the lowest available index so /30 guest IPs are recycled after delete.
  let candidate = 0;
  while (usedIndexes.has(candidate)) {
    candidate += 1;
  }

  db.nextIndex = candidate + 1;
  return candidate;
};

const cloneExt4Rootfs = (sourcePath: string, targetPath: string): void => {
  if (!existsSync(sourcePath)) {
    throw new Error(`Base rootfs does not exist: ${sourcePath}`);
  }
  if (existsSync(targetPath)) {
    throw new Error(`Target rootfs already exists: ${targetPath}`);
  }

  ensureDirs([dirname(targetPath)]);
  const reflinkCopy = run(["cp", "--reflink=auto", sourcePath, targetPath], { allowFailure: true });
  if (reflinkCopy.exitCode !== 0) {
    run(["cp", "-f", sourcePath, targetPath]);
  }
  chmodSync(targetPath, 0o644);
};

const diskSizeMiB = (path: string): number => {
  const bytes = statSync(path).size;
  return Math.floor(bytes / (1024 * 1024));
};

const growExt4DiskIfNeeded = (ext4Path: string, targetSizeMib: number): void => {
  if (!existsSync(ext4Path)) {
    throw new Error(`Cannot resize missing ext4 image: ${ext4Path}`);
  }
  const currentSizeMib = diskSizeMiB(ext4Path);
  if (targetSizeMib < currentSizeMib) {
    throw new Error(
      `Requested disk size ${targetSizeMib} MiB is smaller than current image size ${currentSizeMib} MiB.`,
    );
  }
  if (targetSizeMib === currentSizeMib) {
    return;
  }

  run(["truncate", "-s", `${targetSizeMib}M`, ext4Path]);
  const fsck = runRoot(["e2fsck", "-f", "-y", ext4Path], { allowFailure: true });
  if (fsck.exitCode > 1) {
    throw new Error(`e2fsck failed while resizing ${ext4Path}: ${fsck.stderr || fsck.stdout}`);
  }
  runRoot(["resize2fs", ext4Path]);
};

const getVmOrThrow = (vmId: string): VmRecord => {
  const vm = readVmDatabase().vms[vmId];
  if (!vm) {
    throw new Error(`VM "${vmId}" does not exist.`);
  }
  return vm;
};

const toSshTarget = (vm: VmRecord): SshTarget => ({
  sshUser: vm.sshUser,
  sshKeyPath: vm.sshKeyPath,
  guestIp: vm.guestIp,
});

const clearVmRuntime = (vmId: string): void => {
  const db = readVmDatabase();
  const vm = db.vms[vmId];
  if (!vm) return;
  db.vms[vmId] = { ...vm, runtime: undefined };
  writeVmDatabase(db);
};

const cleanupVmRuntime = async (vm: VmRecord): Promise<void> => {
  if (!vm.runtime) return;
  stopProcess(vm.runtime.firecrackerPid);
  safeDelete(vm.runtime.apiSocketPath);
  await teardownHostNetwork(vm, vm.runtime.hostIface);
  cleanupJailerVmDir(vm.runtime.jailerVmDir);
};

const getHostArch = (): string => {
  if (process.arch === "x64") return "x86_64";
  if (process.arch === "arm64") return "aarch64";
  throw new Error(`Unsupported architecture: ${process.arch}`);
};

const resolveLatestKernelArtifact = async (arch: string): Promise<KernelArtifact> => {
  const releaseTag = await fetchLatestReleaseTag();
  const ciVersion = releaseToCiVersion(releaseTag);
  const prefix = `firecracker-ci/${ciVersion}/${arch}/vmlinux-`;
  const keys = await listBucketKeys(prefix);

  const candidates = keys
    .map((key) => {
      const match = key.match(/vmlinux-(\d+\.\d+\.\d+)$/);
      if (!match) return null;
      return { key, version: match[1] };
    })
    .filter((item): item is { key: string; version: string } => item !== null)
    .sort((a, b) => compareDottedVersions(a.version, b.version));

  const latest = candidates.at(-1);
  if (!latest) {
    throw new Error(`No kernel key found for prefix: ${prefix}`);
  }

  return {
    releaseTag,
    ciVersion,
    arch,
    key: latest.key,
    url: `https://s3.amazonaws.com/spec.ccfc.min/${latest.key}`,
    path: resolve(join(ARTIFACTS_DIR, "kernel", latest.key.split("/").at(-1) ?? "vmlinux")),
    version: latest.version,
  };
};

const ensureSshKeyPair = (privateKeyPath: string): SshKeyPair => {
  const publicKeyPath = `${privateKeyPath}.pub`;
  ensureDirs([dirname(privateKeyPath)]);

  if (existsSync(privateKeyPath) && existsSync(publicKeyPath)) {
    logStep(`reuse: ${privateKeyPath}`);
    return { privateKeyPath, publicKeyPath };
  }

  safeDelete(privateKeyPath);
  safeDelete(publicKeyPath);

  logStep(`generate ssh key: ${privateKeyPath}`);
  run(["ssh-keygen", "-t", "ed25519", "-N", "", "-f", privateKeyPath, "-C", "microvm-access"], {
    allowFailure: false,
  });
  chmodSync(privateKeyPath, 0o600);
  chmodSync(publicKeyPath, 0o644);

  return { privateKeyPath, publicKeyPath };
};

const ensureRootfsFromDocker = async ({
  dockerfilePath,
  sshPublicKeyPath,
  sshUser,
}: {
  dockerfilePath: string;
  sshPublicKeyPath: string;
  sshUser: string;
}): Promise<RootfsArtifact> => {
  if (!existsSync(dockerfilePath)) {
    throw new Error(`Missing Dockerfile for rootfs build: ${dockerfilePath}`);
  }

  const dockerfileSha = sha256OfFile(dockerfilePath);
  const sshPubKeySha = sha256OfFile(sshPublicKeyPath);
  const buildHash = `${dockerfileSha}:${sshPubKeySha}:${sshUser}`;
  const cacheKey = createHash("sha256")
    .update(`${ROOTFS_BUILD_FORMAT_VERSION}:${dockerfilePath}:${buildHash}`)
    .digest("hex")
    .slice(0, 20);
  const source = `dockerfile:${dockerfilePath}`;
  const ext4Path = resolve(ARTIFACTS_DIR, "rootfs", `${cacheKey}.ext4`);
  const metaPath = resolve(ARTIFACTS_DIR, "rootfs", `${cacheKey}.meta.json`);
  const contextPath = dirname(dockerfilePath);

  if (existsSync(ext4Path) && existsSync(metaPath)) {
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as RootfsBuildMeta;
    if (
      meta.formatVersion === ROOTFS_BUILD_FORMAT_VERSION &&
      meta.dockerfilePath === dockerfilePath &&
      meta.dockerfileSha256 === dockerfileSha &&
      meta.sshPubKeySha256 === sshPubKeySha &&
      meta.sshUser === sshUser
    ) {
      logStep(`reuse: ${ext4Path}`);
      return {
        source,
        ext4Path,
        buildHash,
      };
    }
  }

  const imageTag = `microvm-rootfs:${cacheKey}`;
  const buildId = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const tempDir = join(ROOTFS_TMP_DIR, `rootfs-build-${buildId}`);
  const tarPath = join(tempDir, "rootfs.tar");
  const treePath = join(tempDir, "rootfs-tree");

  ensureDirs([ROOTFS_TMP_DIR, tempDir, dirname(ext4Path)]);
  runRoot(["mkdir", "-p", treePath]);

  logStep(`building docker image: ${imageTag} from ${dockerfilePath}`);
  run(["docker", "build", "-f", dockerfilePath, "-t", imageTag, contextPath], { inherit: true });

  const containerId = run(["docker", "create", imageTag]).stdout.trim();
  if (!containerId) {
    throw new Error("Failed to create docker container for rootfs export.");
  }

  try {
    logStep("exporting docker rootfs...");
    run(["docker", "export", "-o", tarPath, containerId]);
    runRoot(["tar", "-xpf", tarPath, "-C", treePath]);

    runRoot(["rm", "-f", join(treePath, ".dockerenv")], { allowFailure: true });
    writeDeterministicResolvConf(treePath);
    validateRootfsForBoot(treePath, sshUser);
    injectAuthorizedKeys(treePath, sshPublicKeyPath, sshUser);

    const sizeMib = recommendedRootfsSizeMiB(treePath);
    const ext4TempPath = `${ext4Path}.tmp`;

    safeDelete(ext4TempPath);
    run(["truncate", "-s", `${sizeMib}M`, ext4TempPath]);
    logStep(`creating ext4 rootfs (${sizeMib} MiB): ${ext4Path}`);
    runRoot(["mkfs.ext4", "-F", "-d", treePath, ext4TempPath]);

    renameSync(ext4TempPath, ext4Path);
    chmodSync(ext4Path, 0o644);

    const meta: RootfsBuildMeta = {
      formatVersion: ROOTFS_BUILD_FORMAT_VERSION,
      dockerfilePath,
      dockerfileSha256: dockerfileSha,
      sshPubKeySha256: sshPubKeySha,
      sshUser,
      source,
      builtAt: new Date().toISOString(),
    };
    writeJson(metaPath, meta);
  } finally {
    run(["docker", "rm", "-f", containerId], { allowFailure: true });
    runRoot(["rm", "-rf", tempDir], { allowFailure: true });
  }

  return {
    source,
    ext4Path,
    buildHash,
  };
};

const injectAuthorizedKeys = (treePath: string, sshPublicKeyPath: string, sshUser: string): void => {
  const passwdUsers = loadPasswdUsers(treePath);
  for (const user of new Set(["root", sshUser])) {
    const record = passwdUsers[user];
    if (!record) {
      throw new Error(`Rootfs is missing expected user "${user}" in /etc/passwd`);
    }
    const homePath = join(treePath, record.home.replace(/^\/+/, ""));
    injectAuthorizedKeyAtHome(homePath, sshPublicKeyPath, `${record.uid}:${record.gid}`);
  }
};

const injectAuthorizedKeyAtHome = (homePath: string, sshPublicKeyPath: string, ownership: string): void => {
  const sshDir = join(homePath, ".ssh");
  const authKeys = join(sshDir, "authorized_keys");

  runRoot(["install", "-d", "-m", "700", sshDir]);
  runRoot(["cp", sshPublicKeyPath, authKeys]);
  runRoot(["chmod", "600", authKeys]);
  runRoot(["chown", "-R", ownership, sshDir]);
};

const validateRootfsForBoot = (treePath: string, sshUser: string): void => {
  assertExecutable(join(treePath, "sbin", "init"), "Rootfs is missing /sbin/init");

  const sshdCandidates = [join(treePath, "usr", "bin", "sshd"), join(treePath, "usr", "sbin", "sshd")];
  const hasSshd = sshdCandidates.some((candidate) => runRoot(["test", "-x", candidate], { allowFailure: true }).exitCode === 0);
  if (!hasSshd) {
    throw new Error("Rootfs is missing sshd binary (expected /usr/bin/sshd or /usr/sbin/sshd).");
  }

  assertPasswdUserExists(treePath, "root");
  assertPasswdUserExists(treePath, sshUser);
};

const loadPasswdUsers = (treePath: string): Record<string, { uid: string; gid: string; home: string }> => {
  const passwdPath = join(treePath, "etc", "passwd");
  const passwd = readFileSync(passwdPath, "utf8");
  return passwd
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .reduce<Record<string, { uid: string; gid: string; home: string }>>((acc, line) => {
      const [username, _password, uid, gid, _gecos, home] = line.split(":");
      if (username && uid && gid && home) {
        acc[username] = { uid, gid, home };
      }
      return acc;
    }, {});
};

const writeDeterministicResolvConf = (treePath: string): void => {
  const resolvPath = join(treePath, "etc", "resolv.conf");
  const content = "nameserver 1.1.1.1\nnameserver 8.8.8.8\n";
  runRoot(["bash", "-lc", `cat > ${shellQuote(resolvPath)} <<'EOF'\n${content}EOF`]);
};

const recommendedRootfsSizeMiB = (treePath: string): number => {
  const usage = runRoot(["du", "-sm", treePath]);
  const used = Number((usage.stdout.split(/\s+/).at(0) ?? "0").trim());
  if (!Number.isFinite(used) || used <= 0) {
    return 1024;
  }
  return Math.max(1024, used + 256);
};

const assertExecutable = (path: string, message: string): void => {
  if (runRoot(["test", "-x", path], { allowFailure: true }).exitCode === 0) {
    return;
  }
  throw new Error(`${message}: ${path}`);
};

const assertPasswdUserExists = (treePath: string, username: string): void => {
  const passwdPath = join(treePath, "etc", "passwd");
  const passwd = readFileSync(passwdPath, "utf8");
  const found = passwd
    .split("\n")
    .some((line) => line.startsWith(`${username}:`));
  if (found) {
    return;
  }
  throw new Error(`Rootfs is missing expected user "${username}" in ${passwdPath}`);
};

const sha256OfFile = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

const fetchLatestReleaseTag = async (): Promise<string> => {
  const response = await fetch("https://github.com/firecracker-microvm/firecracker/releases/latest", {
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`Failed to resolve latest Firecracker release: HTTP ${response.status}`);
  }

  const url = new URL(response.url);
  const tag = url.pathname.split("/").filter(Boolean).at(-1);
  if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error(`Unexpected latest release redirect URL: ${response.url}`);
  }
  return tag;
};

const releaseToCiVersion = (releaseTag: string): string => {
  const match = releaseTag.match(/^v(\d+)\.(\d+)\.\d+$/);
  if (!match) {
    throw new Error(`Unexpected release tag format: ${releaseTag}`);
  }
  return `v${match[1]}.${match[2]}`;
};

const listBucketKeys = async (prefix: string): Promise<string[]> => {
  const url = new URL("https://spec.ccfc.min.s3.amazonaws.com/");
  url.searchParams.set("prefix", prefix);
  url.searchParams.set("list-type", "2");

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Failed to list S3 prefix ${prefix}: HTTP ${response.status}`);
  }
  const xml = await response.text();
  return [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((match) => match[1]);
};

const compareDottedVersions = (a: string, b: string): number => {
  const aParts = a.split(".").map((part) => Number(part));
  const bParts = b.split(".").map((part) => Number(part));
  const length = Math.max(aParts.length, bParts.length);
  for (let index = 0; index < length; index += 1) {
    const left = aParts[index] ?? 0;
    const right = bParts[index] ?? 0;
    if (left !== right) return left - right;
  }
  return 0;
};

const downloadIfMissing = async (url: string, path: string): Promise<void> => {
  if (existsSync(path)) {
    logStep(`reuse: ${path}`);
    return;
  }

  logStep(`download: ${url}`);
  mkdirSync(dirname(path), { recursive: true });
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}) for ${url}`);
  }

  const tempPath = `${path}.tmp`;
  const bytes = new Uint8Array(await response.arrayBuffer());
  writeFileSync(tempPath, bytes);
  renameSync(tempPath, path);
};

const resolveBinaryPath = (binary: string): string => {
  const resolved = run(["bash", "-lc", `command -v ${binary}`]).stdout.trim();
  if (!resolved) {
    throw new Error(`Cannot resolve binary path for: ${binary}`);
  }
  return resolved;
};

const getRuntimeUid = (): number => {
  const fromSudo = Number(process.env.SUDO_UID ?? "");
  if (Number.isFinite(fromSudo) && fromSudo > 0) return fromSudo;
  if (typeof process.getuid === "function") return process.getuid();
  return 1000;
};

const getRuntimeGid = (): number => {
  const fromSudo = Number(process.env.SUDO_GID ?? "");
  if (Number.isFinite(fromSudo) && fromSudo > 0) return fromSudo;
  if (typeof process.getgid === "function") return process.getgid();
  return 1000;
};

const prepareJailerLayout = ({
  vmId,
  firecrackerBinaryPath,
  baseDir,
}: {
  vmId: string;
  firecrackerBinaryPath: string;
  baseDir: string;
}): JailerLayout => {
  const execName = basename(firecrackerBinaryPath);
  const vmDir = join(baseDir, execName, vmId);
  const rootDir = join(vmDir, "root");
  const apiSocketHostPath = join(rootDir, JAILER_API_SOCKET_IN_JAIL.slice(1));
  return { vmDir, rootDir, apiSocketHostPath };
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
  const kernelTargetPath = join(jailerLayout.rootDir, JAILER_KERNEL_PATH_IN_JAIL.slice(1));
  const rootfsTargetPath = join(jailerLayout.rootDir, JAILER_ROOTFS_PATH_IN_JAIL.slice(1));

  runRoot(["mkdir", "-p", dirname(kernelTargetPath)]);
  runRoot(["mkdir", "-p", dirname(rootfsTargetPath)]);
  runRoot(["rm", "-f", jailerLayout.apiSocketHostPath], { allowFailure: true });

  stageFileIntoJail(kernelSourcePath, kernelTargetPath);
  stageFileIntoJail(rootfsSourcePath, rootfsTargetPath);

  runRoot(["chown", `${runtimeUid}:${runtimeGid}`, kernelTargetPath, rootfsTargetPath]);
  runRoot(["chmod", "0644", kernelTargetPath, rootfsTargetPath]);
};

const stageJailerExecRuntimeDeps = (execPath: string, jailRootDir: string): void => {
  const ldd = run(["ldd", execPath], { allowFailure: true });
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
      runRoot(["mkdir", "-p", dirname(jailedPath)]);
      runRoot(["cp", "-f", hostPath, jailedPath]);
      runRoot(["chmod", "0755", jailedPath], { allowFailure: true });
    });
};

const stageFileIntoJail = (sourcePath: string, targetPath: string): void => {
  runRoot(["rm", "-f", targetPath], { allowFailure: true });
  const linked = runRoot(["ln", sourcePath, targetPath], { allowFailure: true });
  if (linked.exitCode === 0) return;
  runRoot(["cp", "-f", sourcePath, targetPath]);
};

const launchJailedFirecracker = ({
  vmId,
  jailerBinaryPath,
  firecrackerBinaryPath,
  jailerBaseDir,
  runtimeUid,
  runtimeGid,
  jailerProfile,
  logPath,
}: {
  vmId: string;
  jailerBinaryPath: string;
  firecrackerBinaryPath: string;
  jailerBaseDir: string;
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
    JAILER_API_SOCKET_IN_JAIL,
  ];

  const command = `nohup ${shellJoin(jailerArgs)} > ${shellQuote(logPath)} 2>&1 & echo $!`;
  const result = runRoot(["bash", "-lc", command]);
  const pid = Number(result.stdout.trim());
  if (!Number.isFinite(pid) || pid <= 0) {
    throw new Error(`Failed to launch jailer. Output: ${result.stdout}`);
  }
  return pid;
};

const cleanupJailerVmDir = (vmDir: string | undefined): void => {
  if (!vmDir) return;
  const resolved = resolve(vmDir);
  const safeBase = resolve(JAILER_BASE_DIR);
  if (!(resolved === safeBase || resolved.startsWith(`${safeBase}/`))) {
    return;
  }
  runRoot(["rm", "-rf", resolved], { allowFailure: true });
};

const resolveJailerProfile = (requiredFsizeBytes: number): JailerProfile => {
  ensureCgroupV2Available();

  const parentCgroup = envOrDefault("MICROVM_CGROUP_PARENT", DEFAULT_JAILER_PARENT_CGROUP);
  const memoryMax = envOrDefault("MICROVM_CGROUP_MEMORY_MAX", DEFAULT_CGROUP_MEMORY_MAX);
  const memorySwapMax = envOrDefault("MICROVM_CGROUP_MEMORY_SWAP_MAX", DEFAULT_CGROUP_MEMORY_SWAP_MAX);
  const cpuMax = envOrDefault("MICROVM_CGROUP_CPU_MAX", DEFAULT_CGROUP_CPU_MAX);
  const pidsMax = envOrDefault("MICROVM_CGROUP_PIDS_MAX", DEFAULT_CGROUP_PIDS_MAX);
  const rlimitNoFile = envOrDefault("MICROVM_RLIMIT_NOFILE", DEFAULT_RLIMIT_NOFILE);
  const configuredFsize = parsePositiveInt(
    envOrDefault("MICROVM_RLIMIT_FSIZE", DEFAULT_RLIMIT_FSIZE),
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

const ensureCgroupV2Available = (): void => {
  if (!existsSync("/sys/fs/cgroup/cgroup.controllers")) {
    throw new Error(
      "cgroup v2 was requested for jailer profile but /sys/fs/cgroup/cgroup.controllers is missing.",
    );
  }
};

const envOrDefault = (name: string, fallback: string): string => {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : fallback;
};

const setupHostNetwork = async (config: VmConfig, hostIface: string): Promise<void> => {
  runRoot(["ip", "link", "del", config.tapDev], { allowFailure: true });
  runRoot(["ip", "tuntap", "add", "dev", config.tapDev, "mode", "tap", "user", targetUser()]);
  runRoot(["ip", "addr", "add", `${config.hostIp}/${config.maskBits}`, "dev", config.tapDev]);
  runRoot(["ip", "link", "set", "dev", config.tapDev, "up"]);
  runRoot(["sysctl", "-w", "net.ipv4.ip_forward=1"]);

  ensureIptablesRule("nat", [
    "POSTROUTING",
    "-s",
    config.guestIp,
    "-o",
    hostIface,
    "-j",
    "MASQUERADE",
  ]);
  ensureIptablesRule(null, [
    "FORWARD",
    "-i",
    config.tapDev,
    "-o",
    hostIface,
    "-j",
    "ACCEPT",
  ]);
  ensureIptablesRule(null, [
    "FORWARD",
    "-i",
    hostIface,
    "-o",
    config.tapDev,
    "-m",
    "conntrack",
    "--ctstate",
    "RELATED,ESTABLISHED",
    "-j",
    "ACCEPT",
  ]);
  ensureIptablesRuleInserted(null, "FORWARD", 1, [
    "-i",
    config.tapDev,
    "-o",
    "tap-vm+",
    "-j",
    "DROP",
  ]);

  // Restrict VM access to host services: allow only Ollama on 11434, drop everything else.
  ensureIptablesRuleInserted(null, "INPUT", 1, [
    "-i",
    config.tapDev,
    "-s",
    config.guestIp,
    "-m",
    "conntrack",
    "--ctstate",
    "RELATED,ESTABLISHED",
    "-j",
    "ACCEPT",
  ]);
  ensureIptablesRuleInserted(null, "INPUT", 2, [
    "-i",
    config.tapDev,
    "-s",
    config.guestIp,
    "-p",
    "tcp",
    "--dport",
    HOST_ALLOWED_TCP_PORT,
    "-j",
    "ACCEPT",
  ]);
  ensureIptablesRuleInserted(null, "INPUT", 3, [
    "-i",
    config.tapDev,
    "-s",
    config.guestIp,
    "-j",
    "DROP",
  ]);
};

const teardownHostNetwork = async (config: VmConfig, hostIface: string): Promise<void> => {
  deleteIptablesRule("nat", [
    "POSTROUTING",
    "-s",
    config.guestIp,
    "-o",
    hostIface,
    "-j",
    "MASQUERADE",
  ]);
  deleteIptablesRule(null, [
    "FORWARD",
    "-i",
    config.tapDev,
    "-o",
    hostIface,
    "-j",
    "ACCEPT",
  ]);
  deleteIptablesRule(null, [
    "FORWARD",
    "-i",
    hostIface,
    "-o",
    config.tapDev,
    "-m",
    "conntrack",
    "--ctstate",
    "RELATED,ESTABLISHED",
    "-j",
    "ACCEPT",
  ]);
  deleteIptablesRule(null, [
    "FORWARD",
    "-i",
    config.tapDev,
    "-o",
    "tap-vm+",
    "-j",
    "DROP",
  ]);
  deleteIptablesRule(null, [
    "INPUT",
    "-i",
    config.tapDev,
    "-s",
    config.guestIp,
    "-m",
    "conntrack",
    "--ctstate",
    "RELATED,ESTABLISHED",
    "-j",
    "ACCEPT",
  ]);
  deleteIptablesRule(null, [
    "INPUT",
    "-i",
    config.tapDev,
    "-s",
    config.guestIp,
    "-p",
    "tcp",
    "--dport",
    HOST_ALLOWED_TCP_PORT,
    "-j",
    "ACCEPT",
  ]);
  deleteIptablesRule(null, [
    "INPUT",
    "-i",
    config.tapDev,
    "-s",
    config.guestIp,
    "-j",
    "DROP",
  ]);
  runRoot(["ip", "link", "del", config.tapDev], { allowFailure: true });
};

const ensureIptablesRule = (table: string | null, ruleArgs: string[]): void => {
  const check = ["iptables", ...tableArgs(table), "-C", ...ruleArgs];
  const add = ["iptables", ...tableArgs(table), "-A", ...ruleArgs];
  const checked = runRoot(check, { allowFailure: true });
  if (checked.exitCode !== 0) {
    runRoot(add);
  }
};

const ensureIptablesRuleInserted = (
  table: string | null,
  chain: string,
  position: number,
  matchArgs: string[],
): void => {
  const check = ["iptables", ...tableArgs(table), "-C", chain, ...matchArgs];
  const insert = ["iptables", ...tableArgs(table), "-I", chain, String(position), ...matchArgs];
  const checked = runRoot(check, { allowFailure: true });
  if (checked.exitCode !== 0) {
    runRoot(insert);
  }
};

const deleteIptablesRule = (table: string | null, ruleArgs: string[]): void => {
  const remove = ["iptables", ...tableArgs(table), "-D", ...ruleArgs];
  runRoot(remove, { allowFailure: true });
};

const tableArgs = (table: string | null): string[] => (table ? ["-t", table] : []);

const getDefaultHostIface = (): string => {
  const result = run(["ip", "-j", "route", "list", "default"]);
  const routes = JSON.parse(result.stdout) as Array<{ dev?: string }>;
  const dev = routes[0]?.dev;
  if (!dev) {
    throw new Error("Cannot determine default host interface from `ip route`.");
  }
  return dev;
};

const waitForFirecrackerApi = async (socketPath: string, timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ping = run(
      [
        "curl",
        "--silent",
        "--show-error",
        "--fail",
        "--unix-socket",
        socketPath,
        "http://localhost/",
      ],
      { allowFailure: true },
    );
    if (ping.exitCode === 0) return;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for Firecracker API socket: ${socketPath}`);
};

const buildBootArgs = (config: VmConfig, arch: string): string => {
  const args = [
    "console=ttyS0",
    "reboot=k",
    "panic=1",
    "pci=off",
    "root=/dev/vda",
    "rw",
    `ip=${config.guestIp}::${config.hostIp}:${config.maskLong}:${config.vmId}:eth0:off`,
  ];
  if (arch === "aarch64") {
    args.unshift("keep_bootcon");
  }
  return args.join(" ");
};

const configureAndStartVm = async ({
  config,
  kernelPath,
  rootfsPath,
  bootArgs,
}: {
  config: VmConfig;
  kernelPath: string;
  rootfsPath: string;
  bootArgs: string;
}): Promise<void> => {
  firecrackerPut(config.apiSocketPath, "/machine-config", {
    vcpu_count: config.vcpuCount,
    mem_size_mib: config.memSizeMib,
  });
  firecrackerPut(config.apiSocketPath, "/boot-source", {
    kernel_image_path: kernelPath,
    boot_args: bootArgs,
  });
  firecrackerPut(config.apiSocketPath, "/drives/rootfs", {
    drive_id: "rootfs",
    path_on_host: rootfsPath,
    is_root_device: true,
    is_read_only: false,
  });
  firecrackerPut(config.apiSocketPath, "/network-interfaces/eth0", {
    iface_id: "eth0",
    host_dev_name: config.tapDev,
    guest_mac: config.guestMac,
  });
  firecrackerPut(config.apiSocketPath, "/actions", {
    action_type: "InstanceStart",
  });
};

const firecrackerPut = (socketPath: string, endpoint: string, payload: unknown): void => {
  run([
    "curl",
    "--silent",
    "--show-error",
    "--fail",
    "--unix-socket",
    socketPath,
    "-X",
    "PUT",
    `http://localhost${endpoint}`,
    "-H",
    "Content-Type: application/json",
    "-d",
    JSON.stringify(payload),
  ]);
};

const waitForSshReady = async (target: SshTarget, timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const attempt = run([...sshBaseArgs(target), "true"], { allowFailure: true });
    if (attempt.exitCode === 0) return;
    await sleep(1500);
  }
  throw new Error("Timed out waiting for SSH to become available.");
};

const sshBaseArgs = (target: SshTarget): string[] => [
  "ssh",
  "-i",
  target.sshKeyPath,
  "-o",
  "StrictHostKeyChecking=no",
  "-o",
  "UserKnownHostsFile=/dev/null",
  "-o",
  "IdentitiesOnly=yes",
  "-o",
  "BatchMode=yes",
  "-o",
  "ConnectTimeout=3",
  `${target.sshUser}@${target.guestIp}`,
];

const renderSshCommand = (target: SshTarget): string =>
  [
    "ssh",
    "-i",
    shellQuote(target.sshKeyPath),
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
    `${target.sshUser}@${target.guestIp}`,
  ].join(" ");

const writeJson = (path: string, data: unknown): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
};

const stopProcess = (pid: number): void => {
  if (!Number.isFinite(pid) || pid <= 0) return;
  run(["kill", "-TERM", String(pid)], { allowFailure: true });
  if (!isProcessAlive(pid)) return;
  run(["kill", "-KILL", String(pid)], { allowFailure: true });
};

const isProcessAlive = (pid: number): boolean =>
  run(["kill", "-0", String(pid)], { allowFailure: true }).exitCode === 0;

const targetUser = (): string => process.env.SUDO_USER ?? process.env.USER ?? "root";

const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\"'\"'`)}'`;

const shellJoin = (args: string[]): string => args.map(shellQuote).join(" ");

const safeDelete = (path: string): void => {
  if (!existsSync(path)) return;
  rmSync(path, { force: true, recursive: false });
};

const safeDeleteInsideWorkDir = (path: string): void => {
  const resolved = resolve(path);
  const safeBase = resolve(WORK_DIR);
  if (!(resolved === safeBase || resolved.startsWith(`${safeBase}/`))) {
    throw new Error(`Refusing to delete path outside work dir: ${resolved}`);
  }
  runRoot(["rm", "-rf", resolved], { allowFailure: true });
};

const isRoot = (): boolean => (typeof process.getuid === "function" ? process.getuid() === 0 : false);

const withRoot = (args: string[]): string[] => (isRoot() ? args : ["sudo", ...args]);

const runRoot = (args: string[], options: { allowFailure?: boolean; inherit?: boolean } = {}): CommandResult =>
  run(withRoot(args), options);

const spawnInherit = (args: string[]): number => {
  const proc = Bun.spawnSync(args, {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return proc.exitCode ?? 1;
};

const run = (
  args: string[],
  options: { allowFailure?: boolean; inherit?: boolean } = {},
): CommandResult => {
  const inherit = options.inherit ?? false;
  const proc = Bun.spawnSync(args, {
    stdin: inherit ? "inherit" : "ignore",
    stdout: inherit ? "inherit" : "pipe",
    stderr: inherit ? "inherit" : "pipe",
    cwd: PROJECT_ROOT,
  });

  const stdout = proc.stdout ? decoder.decode(proc.stdout).trim() : "";
  const stderr = proc.stderr ? decoder.decode(proc.stderr).trim() : "";
  const result: CommandResult = {
    exitCode: proc.exitCode ?? 1,
    stdout,
    stderr,
  };

  if (result.exitCode !== 0 && !options.allowFailure) {
    const rendered = args.join(" ");
    const details = [stderr, stdout].filter(Boolean).join("\n");
    throw new Error(`Command failed (${result.exitCode}): ${rendered}${details ? `\n${details}` : ""}`);
  }

  return result;
};

const logStep = (message: string): void => {
  console.log(`[microvm] ${message}`);
};

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[microvm] ERROR: ${message}`);
  process.exit(1);
});
