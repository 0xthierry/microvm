import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { MicroVM } from "../../model/microvm/microvm";
import { VmStatus } from "../../model/microvm/vm-status";
import { DownCheckpoint } from "../../model/operation/checkpoints";
import { VmOperation } from "../../model/operation/vm-operation";
import { jailerService } from "../../services/jailer/jailer.service";
import { networkService } from "../../services/network/network.service";
import { vmRepository } from "../../services/repository/vm/vm.repository";
import { DownRollbackFailedError } from "./errors";
import { handleDown } from "./handler";

const buildRunningVm = (params: {
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
    status: VmStatus.RUNNING,
    runtime: {
      firecrackerPid: 12345,
      hostIface: "eth0",
      apiSocketPath: `/tmp/${params.id}/api.socket`,
      bootArgs: "console=ttyS0",
      kernelPath: "/tmp/vmlinux",
      jailerVmDir: `/tmp/jailer/${params.id}`,
      firecrackerBinaryPath: "/usr/bin/firecracker",
      jailerBinaryPath: "/usr/bin/jailer",
      releaseTag: "v0.0.0",
      kernelCiVersion: "ci-0",
      kernelVersion: "6.12.0",
      startedAt: now,
    },
  });
};

describe("handleDown", () => {
  afterEach(() => {
    mock.restore();
  });

  it("performs checkpoint-aware rollback when failure happens after network teardown", async () => {
    const vm = buildRunningVm({
      id: "vm-down-rollback-a",
      name: "down-rollback-a",
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

    const updatedVms: MicroVM[] = [];
    spyOn(vmRepository, "update").mockImplementation(async (nextVm: MicroVM) => {
      updatedVms.push(nextVm);
    });

    spyOn(jailerService, "stopVmProcess").mockImplementation(() => {});
    spyOn(networkService, "teardown").mockImplementation(async () => {});
    const setupSpy = spyOn(networkService, "setup").mockImplementation(async () => "eth0");
    const cleanupError = new Error("cleanup failed");
    spyOn(jailerService, "cleanup").mockImplementation(() => {
      throw cleanupError;
    });

    await expect(handleDown({
      nameOrId: vm.id,
      outputJson: false,
    })).rejects.toBe(cleanupError);

    expect(updatedVms.map((nextVm) => nextVm.status)).toEqual([
      VmStatus.STOPPING,
      VmStatus.FAILED,
    ]);
    const failedVm = updatedVms.at(-1);
    expect(failedVm?.runtime).toBeUndefined();
    expect(setupSpy).toHaveBeenCalledTimes(1);
    expect(rollbackStarted).toHaveBeenCalledTimes(1);
    expect(rollbackCheckpoint).toHaveBeenCalledWith(DownCheckpoint.NETWORK_TORN_DOWN, {
      tapDev: vm.toDto().tapDev,
    });
    expect(rollbackCheckpoint).toHaveBeenCalledWith(DownCheckpoint.VM_STOPPING, {
      status: VmStatus.FAILED,
    });
    expect(failed).toHaveBeenCalledTimes(1);
    expect(rollbackFailed).toHaveBeenCalledTimes(0);
  });

  it("persists failed state even when rollback compensation fails", async () => {
    const vm = buildRunningVm({
      id: "vm-down-rollback-b",
      name: "down-rollback-b",
      index: 2,
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

    const updatedVms: MicroVM[] = [];
    spyOn(vmRepository, "update").mockImplementation(async (nextVm: MicroVM) => {
      updatedVms.push(nextVm);
    });

    spyOn(jailerService, "stopVmProcess").mockImplementation(() => {});
    spyOn(networkService, "teardown").mockImplementation(async () => {});
    spyOn(jailerService, "cleanup").mockImplementation(() => {
      throw new Error("cleanup failed");
    });
    spyOn(networkService, "setup").mockImplementation(async () => {
      throw new Error("rollback setup failed");
    });

    await expect(handleDown({
      nameOrId: vm.id,
      outputJson: false,
    })).rejects.toBeInstanceOf(DownRollbackFailedError);

    expect(updatedVms.map((nextVm) => nextVm.status)).toEqual([
      VmStatus.STOPPING,
      VmStatus.FAILED,
    ]);
    const failedVm = updatedVms.at(-1);
    expect(failedVm?.runtime).toBeUndefined();
    expect(rollbackStarted).toHaveBeenCalledTimes(1);
    expect(rollbackFailed).toHaveBeenCalledTimes(1);
  });

  it("preserves runtime metadata when stop step fails before teardown", async () => {
    const vm = buildRunningVm({
      id: "vm-down-stop-fail",
      name: "down-stop-fail",
      index: 3,
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

    const updatedVms: MicroVM[] = [];
    spyOn(vmRepository, "update").mockImplementation(async (nextVm: MicroVM) => {
      updatedVms.push(nextVm);
    });

    const stopError = new Error("stop failed");
    spyOn(jailerService, "stopVmProcess").mockImplementation(() => {
      throw stopError;
    });
    const teardownSpy = spyOn(networkService, "teardown").mockImplementation(async () => {});
    const setupSpy = spyOn(networkService, "setup").mockImplementation(async () => "eth0");
    spyOn(jailerService, "cleanup").mockImplementation(() => {});

    await expect(handleDown({
      nameOrId: vm.id,
      outputJson: false,
    })).rejects.toBe(stopError);

    expect(updatedVms.map((nextVm) => nextVm.status)).toEqual([
      VmStatus.STOPPING,
      VmStatus.FAILED,
    ]);
    const failedVm = updatedVms.at(-1);
    expect(failedVm?.runtime).toBeDefined();
    expect(setupSpy).toHaveBeenCalledTimes(0);
    expect(teardownSpy).toHaveBeenCalledTimes(0);
    expect(rollbackCheckpoint).toHaveBeenCalledWith(DownCheckpoint.VM_STOPPING, {
      status: VmStatus.FAILED,
    });
  });
});
