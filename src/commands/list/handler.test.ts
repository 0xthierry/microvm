import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { join } from "node:path";
import { MicroVM } from "../../model/microvm/microvm";
import { VmStatus } from "../../model/microvm/vm-status";
import { vmRepository } from "../../services/repository/vm/vm.repository";
import { createTestAppConfig } from "../../test/test-app-config";
import { handleList } from "./handler";

const buildVm = (params: {
  id: string;
  name: string;
  index: number;
  status?: VmStatus;
  running?: boolean;
  rootDir: string;
}): MicroVM => {
  const now = new Date().toISOString();

  return MicroVM.create({
    id: params.id,
    name: params.name,
    index: params.index,
    vcpuCount: 2,
    memSizeMib: 1024,
    diskSizeMib: 4096,
    dockerfilePath: join(params.rootDir, "Dockerfile"),
    sshUser: "root",
    hostIp: `172.16.${params.index}.1`,
    guestIp: `172.16.${params.index}.2`,
    guestMac: `06:00:AC:10:${String(params.index).padStart(2, "0")}:02`,
    maskBits: "30",
    maskLong: "255.255.255.252",
    tapDev: `tap-vm${params.index}`,
    rootfsPath: join(params.rootDir, params.id, "rootfs.ext4"),
    sshKeyPath: join(params.rootDir, `${params.id}.key`),
    sshPublicKeyPath: join(params.rootDir, `${params.id}.key.pub`),
    rootfsSource: join(params.rootDir, `${params.id}.source.ext4`),
    createdAt: now,
    updatedAt: now,
    status: params.status ?? (params.running ? VmStatus.RUNNING : VmStatus.CREATED),
    runtime: params.running
      ? {
          firecrackerPid: 1234 + params.index,
          hostIface: `tap-vm${params.index}`,
          apiSocketPath: join(params.rootDir, params.id, "api.socket"),
          bootArgs: "console=ttyS0",
          kernelPath: join(params.rootDir, "vmlinux"),
          jailerVmDir: join(params.rootDir, "jailer", params.id),
          firecrackerBinaryPath: "/usr/bin/firecracker",
          jailerBinaryPath: "/usr/bin/jailer",
          releaseTag: "v0.0.0",
          kernelCiVersion: "ci-0",
          kernelVersion: "6.12.0",
          startedAt: now,
        }
      : undefined,
  });
};

describe("handleList", () => {
  afterEach(() => {
    mock.restore();
  });

  it("renders a stable human-readable table with the required columns", async () => {
    const { rootDir, cleanup } = createTestAppConfig();
    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    try {
      await vmRepository.create(
        buildVm({
          id: "vm-list-a",
          name: "alpha",
          index: 1,
          running: true,
          rootDir,
        }),
      );
      await vmRepository.create(
        buildVm({
          id: "vm-list-b",
          name: "beta",
          index: 2,
          status: VmStatus.STOPPED,
          rootDir,
        }),
      );

      await handleList({
        outputJson: false,
      });

      expect(logSpy).toHaveBeenCalledTimes(1);
      const output = String(logSpy.mock.calls[0]?.[0] ?? "");
      expect(output).toContain("VMs");
      expect(output).toContain("Name");
      expect(output).toContain("ID");
      expect(output).toContain("Status");
      expect(output).toContain("Guest IP");
      expect(output).toContain("alpha");
      expect(output).toContain("beta");
      expect(output).toContain("vm-list-a");
      expect(output).toContain("vm-list-b");
    } finally {
      cleanup();
    }
  });

  it("preserves the list --json contract used by e2e scripts", async () => {
    const { rootDir, cleanup } = createTestAppConfig();
    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    try {
      await vmRepository.create(
        buildVm({
          id: "vm-list-json",
          name: "json-vm",
          index: 3,
          status: VmStatus.RUNNING,
          running: true,
          rootDir,
        }),
      );

      await handleList({
        outputJson: true,
      });

      expect(logSpy).toHaveBeenCalledTimes(1);
      const raw = String(logSpy.mock.calls[0]?.[0] ?? "");
      expect(raw.includes("\u001B[")).toBe(false);

      const parsed = JSON.parse(raw) as {
        command?: string;
        vms?: Array<{ id?: string; name?: string; status?: string }>;
      };

      expect(parsed.command).toBe("list");
      expect(parsed.vms).toEqual([
        expect.objectContaining({
          id: "vm-list-json",
          name: "json-vm",
          status: VmStatus.RUNNING,
        }),
      ]);
    } finally {
      cleanup();
    }
  });
});
