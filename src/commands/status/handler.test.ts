import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { join } from "node:path";
import { MicroVM } from "../../model/microvm/microvm";
import { VmStatus } from "../../model/microvm/vm-status";
import { vmRepository } from "../../services/repository/vm/vm.repository";
import { createTestAppConfig } from "../../test/test-app-config";
import { handleStatus } from "./handler";

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
    vcpuCount: 2 + params.index,
    memSizeMib: 1024 + params.index * 128,
    diskSizeMib: 4096 + params.index * 512,
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
          firecrackerPid: 4321 + params.index,
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

describe("handleStatus", () => {
  afterEach(() => {
    mock.restore();
  });

  it("renders aligned core fields and runtime details only when runtime data exists", async () => {
    const { rootDir, cleanup } = createTestAppConfig();
    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    try {
      const stoppedVm = buildVm({
        id: "vm-status-stopped",
        name: "status-stopped",
        index: 1,
        status: VmStatus.STOPPED,
        rootDir,
      });
      const runningVm = buildVm({
        id: "vm-status-running",
        name: "status-running",
        index: 2,
        running: true,
        rootDir,
      });

      await vmRepository.create(stoppedVm);
      await vmRepository.create(runningVm);

      await handleStatus({
        nameOrId: stoppedVm.id,
        outputJson: false,
      });

      await handleStatus({
        nameOrId: runningVm.id,
        outputJson: false,
      });

      expect(logSpy).toHaveBeenCalledTimes(2);
      const stoppedOutput = String(logSpy.mock.calls[0]?.[0] ?? "");
      const runningOutput = String(logSpy.mock.calls[1]?.[0] ?? "");

      expect(stoppedOutput).toContain("Status");
      expect(stoppedOutput).toContain("Guest IP");
      expect(stoppedOutput).toContain("Rootfs");
      expect(stoppedOutput).not.toContain("Runtime");
      expect(stoppedOutput).not.toContain("Firecracker PID");

      expect(runningOutput).toContain("Runtime");
      expect(runningOutput).toContain("Firecracker PID");
      expect(runningOutput).toContain("API Socket");
    } finally {
      cleanup();
    }
  });

  it("preserves the status --json contract used by e2e scripts", async () => {
    const { rootDir, cleanup } = createTestAppConfig();
    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    try {
      const vm = buildVm({
        id: "vm-status-json",
        name: "status-json",
        index: 3,
        running: true,
        rootDir,
      });
      await vmRepository.create(vm);

      await handleStatus({
        nameOrId: vm.id,
        outputJson: true,
      });

      expect(logSpy).toHaveBeenCalledTimes(1);
      const raw = String(logSpy.mock.calls[0]?.[0] ?? "");
      expect(raw.includes("\u001B[")).toBe(false);

      const parsed = JSON.parse(raw) as {
        command?: string;
        running?: boolean;
        vm?: {
          status?: string;
          vmId?: string;
          guestIp?: string;
          sshUser?: string;
          sshKeyPath?: string;
          rootfsPath?: string;
          tapDev?: string;
          vcpuCount?: number;
          memSizeMib?: number;
          diskSizeMib?: number;
          dockerfilePath?: string;
          runtime?: {
            firecrackerPid?: number;
            hostIface?: string;
          };
        };
      };

      expect(parsed).toEqual({
        command: "status",
        running: true,
        vm: expect.objectContaining({
          status: VmStatus.RUNNING,
          vmId: vm.id,
          guestIp: vm.toDto().guestIp,
          sshUser: vm.toDto().sshUser,
          sshKeyPath: vm.toDto().sshKeyPath,
          rootfsPath: vm.toDto().rootfsPath,
          tapDev: vm.toDto().tapDev,
          vcpuCount: vm.toDto().vcpuCount,
          memSizeMib: vm.toDto().memSizeMib,
          diskSizeMib: vm.toDto().diskSizeMib,
          dockerfilePath: vm.toDto().dockerfilePath,
          runtime: expect.objectContaining({
            firecrackerPid: vm.toDto().runtime?.firecrackerPid,
            hostIface: vm.toDto().runtime?.hostIface,
          }),
        }),
      });
    } finally {
      cleanup();
    }
  });
});
