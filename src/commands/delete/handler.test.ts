import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { MicroVM } from "../../model/microvm/microvm";
import { VmStatus } from "../../model/microvm/vm-status";
import { createTestAppConfig } from "../../test/test-app-config";
import { handleDelete } from "./handler";
import { vmRepository } from "../../services/repository/vm/vm.repository";
import { VmNotFoundError } from "../../services/repository/vm/errors";
import { DeleteUnsafePathError } from "./errors";

const buildVm = (params: {
  id: string;
  name: string;
  index: number;
  rootfsPath: string;
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
    rootfsPath: params.rootfsPath,
    sshKeyPath: "/tmp/key",
    sshPublicKeyPath: "/tmp/key.pub",
    rootfsSource: "/tmp/source.ext4",
    createdAt: now,
    updatedAt: now,
  });
};

describe("handleDelete", () => {
  afterEach(() => {
    mock.restore();
  });

  it("removes vm record and event log, then prints human-readable output", async () => {
    const { config, cleanup } = createTestAppConfig();
    const vm = buildVm({
      id: "vm-delete-a",
      name: "dev-a",
      index: 1,
      rootfsPath: join(config.paths.vmsDir, "vm-delete-a", "rootfs.ext4"),
    });

    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    try {
      await vmRepository.create(vm);

      await handleDelete({
        nameOrId: vm.id,
        outputJson: false,
      });

      const eventLogPath = join(config.paths.runtimeDir, "events", `${vm.id}.ndjson`);
      expect(existsSync(eventLogPath)).toBe(false);
      await expect(vmRepository.getById(vm.id)).rejects.toThrow(VmNotFoundError);
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith(`[microvm] VM "${vm.name}" deleted (id: ${vm.id}).`);
    } finally {
      cleanup();
    }
  });

  it("prints json output after successful delete", async () => {
    const { config, cleanup } = createTestAppConfig();
    const vm = buildVm({
      id: "vm-delete-b",
      name: "dev-b",
      index: 2,
      rootfsPath: join(config.paths.vmsDir, "vm-delete-b", "rootfs.ext4"),
    });

    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    try {
      await vmRepository.create(vm);

      await handleDelete({
        nameOrId: vm.id,
        outputJson: true,
      });

      expect(logSpy).toHaveBeenCalledTimes(1);
      const [firstArg] = logSpy.mock.calls[0] ?? [];
      const parsed = JSON.parse(String(firstArg ?? "{}")) as {
        command?: string;
        vm?: { id?: string; name?: string };
      };

      expect(parsed).toEqual({
        command: "delete",
        vm: {
          id: vm.id,
          name: vm.name,
        },
      });

      const eventLogPath = join(config.paths.runtimeDir, "events", `${vm.id}.ndjson`);
      expect(existsSync(eventLogPath)).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("refuses deletion when vm assets are outside configured vm root", async () => {
    const { rootDir, cleanup } = createTestAppConfig();
    const outsideVmDir = join(rootDir, "outside-vm-assets");
    mkdirSync(outsideVmDir, { recursive: true });
    writeFileSync(join(outsideVmDir, "sentinel.txt"), "do-not-delete", "utf8");

    const vm = buildVm({
      id: "vm-delete-unsafe",
      name: "dev-unsafe",
      index: 3,
      rootfsPath: join(outsideVmDir, "rootfs.ext4"),
    });

    try {
      await vmRepository.create(vm);

      await expect(handleDelete({
        nameOrId: vm.id,
        outputJson: false,
      })).rejects.toBeInstanceOf(DeleteUnsafePathError);

      expect(existsSync(outsideVmDir)).toBe(true);
      expect((await vmRepository.getById(vm.id)).status).toBe(VmStatus.FAILED);
    } finally {
      cleanup();
    }
  });
});
