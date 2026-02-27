import { chmodSync, existsSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import type { AppConfig } from "../config/app-config";
import type { DiskImageService } from "./disk-image";
import type { FirecrackerClientService } from "./firecracker-client";
import type { HostPrerequisitesService } from "./host-prerequisites";
import type { JailerRuntimeService } from "./jailer-runtime";
import type { KernelArtifactResolverService } from "./kernel-artifact-resolver";
import type { NetworkManagerService } from "./network-manager";
import type { VmRepository } from "./persistance/vm-repository";
import type { ProcessService } from "./process";
import type { RootfsProvisionerService } from "./rootfs-provisioner";
import type { SshClientService } from "./ssh-client";
import type { VmIdPolicyService } from "./vm-id-policy";

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

export type VmConfig = {
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

export type VmRuntimeState = {
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

export type VmRecord = VmConfig & {
  index: number;
  rootfsPath: string;
  sshKeyPath: string;
  sshPublicKeyPath: string;
  rootfsSource: string;
  rootfsBuildHash?: string;
  createdAt: string;
  runtime?: VmRuntimeState;
};

type SshTarget = {
  sshUser: string;
  sshKeyPath: string;
  guestIp: string;
};

export type VmLifecycleService = {
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
};

export type VmLifecycleDeps = {
  appConfig: AppConfig;
  processService: ProcessService;
  vmIdPolicy: VmIdPolicyService;
  hostPrerequisites: HostPrerequisitesService;
  vmRepository: VmRepository<VmRecord>;
  rootfsProvisioner: RootfsProvisionerService;
  diskImageService: DiskImageService;
  kernelArtifactResolver: KernelArtifactResolverService;
  jailerRuntime: JailerRuntimeService;
  networkManager: NetworkManagerService;
  firecrackerClient: FirecrackerClientService;
  sshClient: SshClientService;
  logStep: (message: string) => void;
};

export const createVmLifecycleService = ({
  appConfig,
  processService,
  vmIdPolicy,
  hostPrerequisites,
  vmRepository,
  rootfsProvisioner,
  diskImageService,
  kernelArtifactResolver,
  jailerRuntime,
  networkManager,
  firecrackerClient,
  sshClient,
  logStep,
}: VmLifecycleDeps): VmLifecycleService => {
  const { paths, defaults } = appConfig;
  const vmDataDir = (vmId: string): string => join(paths.vmsDir, vmId);

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
      logPath: join(paths.runtimeDir, vmId, "firecracker.log"),
      sshUser: options.sshUser,
      vcpuCount: options.vcpuCount,
      memSizeMib: options.memSizeMib,
      diskSizeMib: options.diskSizeMib,
      dockerfilePath: options.dockerfilePath,
    };
  };

  const toSshTarget = (vm: VmRecord): SshTarget => ({
    sshUser: vm.sshUser,
    sshKeyPath: vm.sshKeyPath,
    guestIp: vm.guestIp,
  });

  const getHostArch = (): string => {
    if (process.arch === "x64") return "x86_64";
    if (process.arch === "arm64") return "aarch64";
    throw new Error(`Unsupported architecture: ${process.arch}`);
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

  const isProcessAlive = (pid: number): boolean =>
    processService.run(["kill", "-0", String(pid)], { allowFailure: true }).exitCode === 0;

  const stopProcess = (pid: number): void => {
    if (!Number.isFinite(pid) || pid <= 0) return;
    processService.run(["kill", "-TERM", String(pid)], { allowFailure: true });
    if (!isProcessAlive(pid)) return;
    processService.run(["kill", "-KILL", String(pid)], { allowFailure: true });
  };

  const safeDelete = (path: string): void => {
    if (!existsSync(path)) return;
    rmSync(path, { force: true, recursive: false });
  };

  const safeDeleteInsideWorkDir = (path: string): void => {
    const resolved = resolve(path);
    const safeBase = resolve(paths.workDir);
    if (!(resolved === safeBase || resolved.startsWith(`${safeBase}/`))) {
      throw new Error(`Refusing to delete path outside work dir: ${resolved}`);
    }
    processService.runRoot(["rm", "-rf", resolved], { allowFailure: true });
  };

  const cleanupVmRuntime = async (vm: VmRecord): Promise<void> => {
    if (!vm.runtime) return;
    stopProcess(vm.runtime.firecrackerPid);
    safeDelete(vm.runtime.apiSocketPath);
    await networkManager.teardownHostNetwork(vm, vm.runtime.hostIface);
    jailerRuntime.cleanupJailerVmDir(vm.runtime.jailerVmDir);
  };

  const runCreate = async (vmId: string, options: CreateVmOptions): Promise<void> => {
    vmIdPolicy.assertVmId(vmId);
    vmIdPolicy.assertJailerSafeVmId(vmId);
    vmIdPolicy.assertJailerSocketPathLength(vmId);
    hostPrerequisites.ensureDirs([paths.workDir, paths.artifactsDir, paths.runtimeDir, paths.vmsDir]);
    hostPrerequisites.ensureDependencies(["docker", "mkfs.ext4", "tar", "ssh-keygen", "sudo", "e2fsck", "resize2fs"]);
    await hostPrerequisites.ensureSudoSession();

    const db = vmRepository.readVmDatabase();
    if (db.vms[vmId]) {
      throw new Error(`VM "${vmId}" already exists.`);
    }

    const sshKeyPair = rootfsProvisioner.ensureSshKeyPair(paths.sharedSshPrivateKeyPath);
    const rootfs = await rootfsProvisioner.ensureRootfsFromDocker({
      dockerfilePath: options.dockerfilePath,
      sshPublicKeyPath: sshKeyPair.publicKeyPath,
      sshUser: options.sshUser,
    });

    const index = vmRepository.reserveVmIndex(db);
    const config = buildVmConfig(vmId, index, options);
    const vmRootfsPath = join(vmDataDir(vmId), "rootfs.ext4");
    diskImageService.cloneExt4Rootfs(rootfs.ext4Path, vmRootfsPath);
    diskImageService.growExt4DiskIfNeeded(vmRootfsPath, options.diskSizeMib);
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
    vmRepository.writeVmDatabase(db);
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
    vmIdPolicy.assertVmId(vmId);
    vmIdPolicy.assertJailerSafeVmId(vmId);
    hostPrerequisites.ensureDirs([paths.workDir, paths.artifactsDir, paths.runtimeDir, paths.vmsDir]);
    hostPrerequisites.ensureDependencies(["firecracker", "jailer", "curl", "ip", "iptables", "ssh", "ssh-keygen", "sudo", "docker", "mkfs.ext4", "tar", "e2fsck", "resize2fs"]);
    hostPrerequisites.ensureKvmAccess();
    await hostPrerequisites.ensureSudoSession();

    let db = vmRepository.readVmDatabase();
    let vm = db.vms[vmId];
    if (!vm) {
      if (!autoCreate) {
        throw new Error(`VM "${vmId}" does not exist. Run "bun src/index.ts create ${vmId}" first.`);
      }
      logStep(`VM "${vmId}" not found, creating it now...`);
      await runCreate(vmId, createOptions);
      db = vmRepository.readVmDatabase();
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
      vmRepository.clearVmRuntime(vmId);
      db = vmRepository.readVmDatabase();
      vm = db.vms[vmId];
      if (!vm) {
        throw new Error(`VM "${vmId}" disappeared from database.`);
      }
    }

    const arch = getHostArch();
    const kernel = await kernelArtifactResolver.resolveLatestKernelArtifact(arch);
    logStep(`latest Firecracker release: ${kernel.releaseTag}`);
    logStep(`latest kernel: ${kernel.version} (${kernel.ciVersion})`);
    logStep(`rootfs source: ${vm.rootfsSource}`);

    await kernelArtifactResolver.downloadIfMissing(kernel.url, kernel.path);
    chmodSync(vm.sshKeyPath, 0o600);

    const firecrackerBinaryPath = jailerRuntime.resolveBinaryPath("firecracker");
    vmIdPolicy.assertJailerSocketPathLength(vmId, basename(firecrackerBinaryPath));
    const jailerBinaryPath = jailerRuntime.resolveBinaryPath("jailer");
    const jailerProfile = jailerRuntime.resolveJailerProfile(vm.diskSizeMib * 1024 * 1024);
    const vmUid = String(jailerRuntime.getRuntimeUid());
    const vmGid = String(jailerRuntime.getRuntimeGid());
    const jailerLayout = jailerRuntime.prepareJailerLayout({
      vmId: vm.vmId,
      firecrackerBinaryPath,
    });
    jailerRuntime.stageJailerVmAssets({
      jailerLayout,
      kernelSourcePath: kernel.path,
      rootfsSourcePath: vm.rootfsPath,
      runtimeUid: vmUid,
      runtimeGid: vmGid,
    });
    jailerRuntime.stageJailerExecRuntimeDeps(firecrackerBinaryPath, jailerLayout.rootDir);

    const hostIface = networkManager.getDefaultHostIface();
    let networkReady = false;
    let firecrackerPid = 0;

    try {
      await networkManager.setupHostNetwork(vm, hostIface);
      networkReady = true;

      firecrackerPid = jailerRuntime.launchJailedFirecracker({
        vmId: vm.vmId,
        jailerBinaryPath,
        firecrackerBinaryPath,
        runtimeUid: vmUid,
        runtimeGid: vmGid,
        jailerProfile,
        logPath: vm.logPath,
      });
      await firecrackerClient.waitForFirecrackerApi(jailerLayout.apiSocketHostPath, 10_000);

      const bootArgs = buildBootArgs(vm, arch);
      await firecrackerClient.configureAndStartVm({
        config: { ...vm, apiSocketPath: jailerLayout.apiSocketHostPath },
        kernelPath: defaults.jailer.kernelPathInJail,
        rootfsPath: defaults.jailer.rootfsPathInJail,
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
      db = vmRepository.readVmDatabase();
      const persistedVm = db.vms[vmId];
      if (!persistedVm) {
        throw new Error(`VM "${vmId}" not found while persisting runtime state.`);
      }
      db.vms[vmId] = { ...persistedVm, runtime };
      vmRepository.writeVmDatabase(db);

      const sshTarget = toSshTarget(db.vms[vmId]);
      await sshClient.waitForSshReady(sshTarget, 120_000);
      logStep(`VM "${vmId}" is ready. SSH command: ${sshClient.renderSshCommand(sshTarget)}`);

      if (attach) {
        const sshExitCode = processService.spawnInherit(sshClient.sshBaseArgs(sshTarget));
        if (sshExitCode !== 0) {
          logStep(`ssh session ended with exit code ${sshExitCode}`);
        }
      }
    } catch (error) {
      if (firecrackerPid > 0) {
        stopProcess(firecrackerPid);
      }
      if (networkReady) {
        await networkManager.teardownHostNetwork(vm, hostIface);
      }
      jailerRuntime.cleanupJailerVmDir(jailerLayout.vmDir);
      vmRepository.clearVmRuntime(vmId);
      throw error;
    }
  };

  const runSsh = async (vmId: string): Promise<void> => {
    vmIdPolicy.assertVmId(vmId);
    const vm = vmRepository.getVmOrThrow(vmId);
    if (!vm.runtime || !isProcessAlive(vm.runtime.firecrackerPid)) {
      throw new Error(`VM "${vmId}" is not running.`);
    }

    const sshExitCode = processService.spawnInherit(sshClient.sshBaseArgs(toSshTarget(vm)));
    if (sshExitCode !== 0) {
      logStep(`ssh session ended with exit code ${sshExitCode}`);
    }
  };

  const runStop = async (vmId: string): Promise<void> => {
    vmIdPolicy.assertVmId(vmId);
    const vm = vmRepository.getVmOrThrow(vmId);
    if (!vm.runtime) {
      logStep(`VM "${vmId}" is already stopped.`);
      return;
    }
    await hostPrerequisites.ensureSudoSession();
    await cleanupVmRuntime(vm);
    vmRepository.clearVmRuntime(vmId);
    logStep(`VM "${vmId}" stopped and host network cleaned up.`);
  };

  const runSet = async (vmId: string, options: SetVmOptions): Promise<void> => {
    vmIdPolicy.assertVmId(vmId);
    const db = vmRepository.readVmDatabase();
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
      hostPrerequisites.ensureDependencies(["sudo", "e2fsck", "resize2fs"]);
      await hostPrerequisites.ensureSudoSession();
      diskImageService.growExt4DiskIfNeeded(vm.rootfsPath, nextDisk);
      logStep(`resized disk for "${vmId}" from ${vm.diskSizeMib} MiB to ${nextDisk} MiB.`);
    }

    db.vms[vmId] = {
      ...vm,
      vcpuCount: nextVcpu,
      memSizeMib: nextMem,
      diskSizeMib: nextDisk,
      sshUser: nextSshUser,
    };
    vmRepository.writeVmDatabase(db);
    logStep(
      `updated "${vmId}": cpus=${nextVcpu}, memory=${nextMem} MiB, disk=${nextDisk} MiB, ssh-user=${nextSshUser}${running ? " (cpu/memory apply on next start)" : ""}`,
    );
  };

  const runDelete = async (vmId: string): Promise<void> => {
    vmIdPolicy.assertVmId(vmId);
    const db = vmRepository.readVmDatabase();
    const vm = db.vms[vmId];
    if (!vm) {
      logStep(`VM "${vmId}" does not exist.`);
      return;
    }

    await hostPrerequisites.ensureSudoSession();

    if (vm.runtime) {
      await cleanupVmRuntime(vm);
    }

    safeDelete(vm.apiSocketPath);
    safeDeleteInsideWorkDir(vmDataDir(vmId));
    safeDeleteInsideWorkDir(join(paths.runtimeDir, vmId));
    jailerRuntime.cleanupJailerVmDir(
      vm.runtime?.jailerVmDir ?? join(paths.jailerBaseDir, "firecracker", vmId),
    );

    delete db.vms[vmId];
    vmRepository.writeVmDatabase(db);

    logStep(`VM "${vmId}" deleted.`);
  };

  const runStatus = async (vmIdArg?: string): Promise<void> => {
    const db = vmRepository.readVmDatabase();
    if (vmIdArg) {
      vmIdPolicy.assertVmId(vmIdArg);
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

  return {
    runCreate,
    runStart,
    runStop,
    runSet,
    runDelete,
    runSsh,
    runStatus,
    runList,
  };
};
