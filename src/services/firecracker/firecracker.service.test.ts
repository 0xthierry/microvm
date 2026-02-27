import { describe, expect, it } from "bun:test";
import { MicroVM } from "../../model/microvm/microvm";
import { FirecrackerService } from "./firecracker.service";
import {
  FirecrackerConfigurationFailedError,
  FirecrackerStartFailedError,
} from "./errors";

const buildVm = (): MicroVM => {
  const now = new Date().toISOString();
  return MicroVM.create({
    id: "vm1",
    name: "dev",
    index: 0,
    vcpuCount: 2,
    memSizeMib: 1024,
    diskSizeMib: 4096,
    dockerfilePath: "/tmp/Dockerfile",
    sshUser: "root",
    hostIp: "172.16.0.1",
    guestIp: "172.16.0.2",
    guestMac: "06:00:AC:10:00:02",
    maskBits: "30",
    maskLong: "255.255.255.252",
    tapDev: "tap-vm0",
    rootfsPath: "/tmp/rootfs.ext4",
    sshKeyPath: "/tmp/key",
    sshPublicKeyPath: "/tmp/key.pub",
    rootfsSource: "/tmp/source.ext4",
    createdAt: now,
    updatedAt: now,
    runtime: {
      firecrackerPid: 123,
      hostIface: "eth0",
      apiSocketPath: "/tmp/firecracker.sock",
      bootArgs: "console=ttyS0",
      kernelPath: "/tmp/vmlinux",
      jailerVmDir: "/tmp/jailer",
      firecrackerBinaryPath: "/usr/bin/firecracker",
      jailerBinaryPath: "/usr/bin/jailer",
      releaseTag: "local",
      kernelCiVersion: "local",
      kernelVersion: "local",
      startedAt: now,
    },
  });
};

describe("FirecrackerService", () => {
  it("maps configure failures to FirecrackerConfigurationFailedError", async () => {
    const service = new FirecrackerService({
      waitForApi: async () => undefined,
      configure: () => {
        throw new Error("boom");
      },
      instanceStart: () => undefined,
      put: () => undefined,
    } as any);

    await expect(service.configure(buildVm())).rejects.toThrow(FirecrackerConfigurationFailedError);
  });

  it("maps start failures to FirecrackerStartFailedError", async () => {
    const service = new FirecrackerService({
      waitForApi: async () => undefined,
      configure: () => undefined,
      instanceStart: () => {
        throw new Error("boom");
      },
      put: () => undefined,
    } as any);

    await expect(service.start(buildVm())).rejects.toThrow(FirecrackerStartFailedError);
  });
});
