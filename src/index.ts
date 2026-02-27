#!/usr/bin/env bun

import { parseArgs } from "./cli/parser";
import { createCommandRegistry } from "./commands/register";
import { buildAppConfig } from "./config/app-config";
import { loadEnvironment } from "./env";
import type { CommandDeps } from "./commands/types";
import { createDiskImageService } from "./services/disk-image";
import { createFirecrackerClientService } from "./services/firecracker-client";
import { createHostPrerequisitesService } from "./services/host-prerequisites";
import { createJailerRuntimeService } from "./services/jailer-runtime";
import { createKernelArtifactResolverService } from "./services/kernel-artifact-resolver";
import { createNetworkManagerService } from "./services/network-manager";
import { createProcessService } from "./services/process";
import { createVmRepository } from "./services/persistence/vm-repository";
import { createRootfsProvisionerService } from "./services/rootfs-provisioner";
import { createSshClientService } from "./services/ssh-client";
import { createVmIdPolicyService } from "./services/vm-id-policy";
import { createVmLifecycleService, type VmRecord } from "./services/vm-lifecycle";

const env = loadEnvironment();
const config = buildAppConfig({
  projectRoot: process.cwd(),
  env,
});
const { defaults } = config;
const logStep = (message: string): void => {
  console.log(`[microvm] ${message}`);
};

const processService = createProcessService({ appConfig: config });
const hostPrerequisites = createHostPrerequisitesService({
  process: processService,
  logStep,
});
const firecrackerClient = createFirecrackerClientService({
  process: processService,
});
const diskImageService = createDiskImageService({
  process: processService,
});
const networkManager = createNetworkManagerService({
  process: processService,
  appConfig: config,
});
const sshClient = createSshClientService({
  process: processService,
});
const jailerRuntime = createJailerRuntimeService({
  runner: processService,
  appConfig: config,
  logStep,
});
const kernelArtifactResolver = createKernelArtifactResolverService({
  appConfig: config,
  logStep,
});
const rootfsProvisioner = createRootfsProvisionerService({
  process: processService,
  appConfig: config,
  logStep,
});
const vmIdPolicy = createVmIdPolicyService({
  appConfig: config,
});
const vmRepository = createVmRepository<VmRecord>({
  appConfig: config,
});
const vmLifecycle = createVmLifecycleService({
  appConfig: config,
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
});

const HELP_NOTES = [
  `default vm-id is "${defaults.vm.id}" when omitted`,
  `defaults: ${defaults.vm.vcpuCount} CPU, ${defaults.vm.memSizeMib} MiB RAM, ${defaults.vm.diskSizeMib / 1024} GiB disk, Dockerfile.arch, ssh-user=${defaults.vm.sshUser}`,
  "create builds/reuses a cached Dockerfile-based ext4 and clones per-VM ext4",
  "each VM has isolated disk (.microvm/vms/<vm-id>/rootfs.ext4)",
  "VM registry persists in .microvm/runtime/vms.json",
];

const buildCommandDeps = (renderHelp: () => string): CommandDeps => ({
  vmIdPolicy,
  appConfig: config,
  vmLifecycle,
  helpRenderer: {
    renderHelp,
  },
});

const main = async (): Promise<void> => {
  const rawArgs = process.argv.slice(2);
  const commandToken = rawArgs[0] ?? "up";
  const parsed = parseArgs(rawArgs.slice(1));

  let renderHelp = (): string => "";
  const deps = buildCommandDeps(() => renderHelp());
  const registry = createCommandRegistry(deps);
  renderHelp = (): string => registry.renderHelp(HELP_NOTES);

  const command = registry.resolve(commandToken);
  if (!command) {
    throw new Error(`Unknown command "${commandToken}".\n\n${renderHelp()}`);
  }
  await command.execute(parsed);
};

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[microvm] ERROR: ${message}`);
  process.exit(1);
});
