import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { MicroVM } from "../../model/microvm/microvm";
import { VmStatus } from "../../model/microvm/vm-status";
import { VmOperation } from "../../model/operation/vm-operation";
import { hostService } from "../../services/host/host.service";
import { jailerService } from "../../services/jailer/jailer.service";
import { networkService } from "../../services/network/network.service";
import { vmRepository } from "../../services/repository/vm/vm.repository";
import { UpRollbackFailedError } from "./errors";
import { handleUp } from "./handler";

const buildVm = (params: {
  id: string;
  name: string;
  index: number;
}): MicroVM => {
  const now = new Date().toISOString();
  return MicroVM.create({
    id: params.id,
    name: params.name,
    index: params.index,
    vcpuCount: 2,
    memSizeMib: 1024,
    diskSizeMib: 4096,
    dockerfilePath: "/tmp/Dockerfile",
    sshUser: "root",
    hostIp: `172.16.${params.index}.1`,
    guestIp: `172.16.${params.index}.2`,
    guestMac: `06:00:AC:10:${String(params.index).padStart(2, "0")}:02`,
    maskBits: "30",
    maskLong: "255.255.255.252",
    tapDev: `tap-vm${params.index}`,
    rootfsPath: `/tmp/${params.id}/rootfs.ext4`,
    sshKeyPath: "/tmp/key",
    sshPublicKeyPath: "/tmp/key.pub",
    rootfsSource: "/tmp/source.ext4",
    createdAt: now,
    updatedAt: now,
  });
};

describe("handleUp", () => {
  afterEach(() => {
    mock.restore();
  });

  it("persists failed state even when rollback steps fail", async () => {
    const vm = buildVm({
      id: "vm-up-rollback",
      name: "up-rollback",
      index: 1,
    });

    const checkpoint = mock(async () => {});
    const stateChanged = mock(async () => {});
    const rollbackStarted = mock(async () => {});
    const rollbackCheckpoint = mock(async () => {});
    const succeeded = mock(async () => {});
    const failed = mock(async () => {});
    const rollbackFailed = mock(async () => {});

    const operation = {
      checkpoint,
      stateChanged,
      rollbackStarted,
      rollbackCheckpoint,
      succeeded,
      failed,
      rollbackFailed,
    };

    spyOn(VmOperation, "start").mockImplementation(
      async () => operation as unknown as VmOperation,
    );
    spyOn(vmRepository, "findByNameOrId").mockResolvedValue(vm);

    const updatedStatuses: VmStatus[] = [];
    spyOn(vmRepository, "update").mockImplementation(async (nextVm: MicroVM) => {
      updatedStatuses.push(nextVm.status);
    });

    spyOn(hostService, "prepareUpEnvironment").mockImplementation(() => {});
    spyOn(networkService, "setup").mockImplementation(async () => "eth0");
    spyOn(jailerService, "resolveBinaryPath").mockImplementation(() => {
      throw new Error("boom in startup path");
    });
    spyOn(networkService, "teardown").mockImplementation(async () => {
      throw new Error("boom in rollback teardown");
    });

    await expect(handleUp({
      nameOrId: vm.id,
      attach: false,
      outputJson: false,
    })).rejects.toBeInstanceOf(UpRollbackFailedError);

    expect(updatedStatuses).toEqual([
      VmStatus.STARTING,
      VmStatus.FAILED,
    ]);
    expect(rollbackStarted).toHaveBeenCalledTimes(1);
    expect(rollbackFailed).toHaveBeenCalledTimes(1);
  });
});
