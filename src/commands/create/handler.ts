import { rmSync } from "node:fs";
import { join } from "node:path";
import { getAppConfig } from "../../config/runtime-context";
import { AppError } from "../../lib/errors/app-error";
import { assertVmName, generateVmId } from "../../model/microvm/identity";
import { MicroVM } from "../../model/microvm/microvm";
import { CreateCheckpoint } from "../../model/operation/checkpoints";
import { VmOperation } from "../../model/operation/vm-operation";
import { planVmNetwork } from "../../model/microvm/planning";
import { diskService } from "../../services/disk/disk.service";
import { dockerService } from "../../services/docker/docker.service";
import { hostService } from "../../services/host/host.service";
import { vmEventLogRepository } from "../../services/repository/vm-event-log/vm-event-log.repository";
import { vmRepository } from "../../services/repository/vm/vm.repository";
import { VmNotFoundError } from "../../services/repository/vm/errors";
import type { CreateInput } from "./input";
import { CreateRollbackFailedError } from "./errors";

const resolveUniqueVmId = async (): Promise<string> => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const candidate = generateVmId();
    try {
      await vmRepository.getById(candidate);
    } catch (error) {
      if (error instanceof VmNotFoundError) {
        return candidate;
      }
      throw error;
    }
  }

  throw new AppError("Failed to generate a unique VM id.");
};

export const handleCreate = async (input: CreateInput): Promise<void> => {
  assertVmName(input.name);

  const config = getAppConfig();
  const vmId = await resolveUniqueVmId();
  const vmIndex = await vmRepository.reserveNextIndex();
  const network = planVmNetwork(vmIndex);

  const vmDir = join(config.paths.vmsDir, vmId);
  const runtimeVmDir = join(config.paths.runtimeDir, vmId);
  const rootfsPath = join(vmDir, "rootfs.ext4");

  const operation = await VmOperation.start(vmId, "create", vmEventLogRepository);
  await operation.checkpoint(CreateCheckpoint.VALIDATED_INPUT, {
    name: input.name,
    vmId,
  });

  let vmPersisted = false;

  try {
    hostService.prepareCreateEnvironment({
      vmsDir: config.paths.vmsDir,
      runtimeDir: config.paths.runtimeDir,
      vmDir,
      runtimeVmDir,
    });
    await operation.checkpoint(CreateCheckpoint.PREPARED_DIRS, {
      vmDir,
      runtimeVmDir,
    });

    const sshKeyPair = dockerService.ensureSshKeyPair(config.paths.sharedSshPrivateKeyPath);
    const rootfsArtifact = dockerService.ensureRootfs({
      dockerfilePath: input.dockerfilePath,
      sshPublicKeyPath: sshKeyPair.publicKeyPath,
      sshUser: input.sshUser,
    });

    diskService.cloneRootfs(rootfsArtifact.ext4Path, rootfsPath);
    diskService.growDiskIfNeeded(rootfsPath, input.diskSizeMib);

    await operation.checkpoint(CreateCheckpoint.PREPARED_ROOTFS, {
      rootfsPath,
      sourceRootfsPath: rootfsArtifact.ext4Path,
    });

    const now = new Date().toISOString();
    const vm = MicroVM.create({
      id: vmId,
      name: input.name,
      index: vmIndex,
      vcpuCount: input.vcpuCount,
      memSizeMib: input.memSizeMib,
      diskSizeMib: input.diskSizeMib,
      dockerfilePath: input.dockerfilePath,
      sshUser: input.sshUser,
      hostIp: network.hostIp,
      guestIp: network.guestIp,
      guestMac: network.guestMac,
      maskBits: network.maskBits,
      maskLong: network.maskLong,
      tapDev: network.tapDev,
      rootfsPath,
      sshKeyPath: sshKeyPair.privateKeyPath,
      sshPublicKeyPath: sshKeyPair.publicKeyPath,
      rootfsSource: rootfsArtifact.source,
      rootfsBuildHash: rootfsArtifact.buildHash,
      createdAt: now,
      updatedAt: now,
    });

    await vmRepository.create(vm);
    vmPersisted = true;

    await operation.checkpoint(CreateCheckpoint.PERSISTED_VM, {
      vmId,
      name: input.name,
    });
    await operation.succeeded();

    if (input.outputJson) {
      console.log(JSON.stringify({
        command: "create",
        vm: {
          id: vmId,
          name: input.name,
        },
      }, null, 2));
    } else {
      console.log(`[microvm] VM "${input.name}" created (id: ${vmId}).`);
    }
  } catch (error) {
    await operation.rollbackStarted(error);

    try {
      if (vmPersisted) {
        await vmRepository.delete(vmId);
        await operation.rollbackCheckpoint(CreateCheckpoint.PERSISTED_VM, {
          vmId,
        });
      }

      rmSync(vmDir, {
        recursive: true,
        force: true,
      });
      rmSync(runtimeVmDir, {
        recursive: true,
        force: true,
      });

      await operation.rollbackCheckpoint(CreateCheckpoint.PREPARED_DIRS, {
        vmDir,
        runtimeVmDir,
      });
      await operation.failed(error);
    } catch (rollbackError) {
      await operation.rollbackFailed(rollbackError);
      throw new CreateRollbackFailedError({
        vmId,
        cause: rollbackError,
      });
    }

    throw error;
  }
};
