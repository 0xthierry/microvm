import { describe, expect, it } from "bun:test";
import { JailerService } from "./jailer.service";
import {
  JailerBinaryNotFoundError,
  JailerLaunchFailedError,
  JailerProfileResolveFailedError,
  JailerStopFailedError,
} from "./errors";
import { MicroVM } from "../../model/microvm/microvm";

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
  });
};

describe("JailerService", () => {
  it("maps binary resolution failures", () => {
    const service = new JailerService({
      resolveBinaryPath: () => {
        throw new Error("boom");
      },
    } as any);

    expect(() => service.resolveBinaryPath("jailer")).toThrow(JailerBinaryNotFoundError);
  });

  it("maps profile resolution failures", () => {
    const service = new JailerService({
      resolveProfile: () => {
        throw new Error("boom");
      },
    } as any);

    expect(() =>
      service.resolveProfile({
        requiredFsizeBytes: 1,
        requiredMemoryBytes: 1,
      })).toThrow(JailerProfileResolveFailedError);
  });

  it("maps launch failures", () => {
    const service = new JailerService({
      launch: () => {
        throw new Error("boom");
      },
    } as any);

    expect(() =>
      service.launch({
        vm: buildVm(),
        jailerBinaryPath: "/usr/bin/jailer",
        firecrackerBinaryPath: "/usr/bin/firecracker",
        runtimeUid: "1000",
        runtimeGid: "1000",
        profile: {
          cgroupVersion: "2",
          parentCgroup: "microvm",
          cgroups: [],
          resourceLimits: [],
        },
        logPath: "/tmp/log",
      })).toThrow(JailerLaunchFailedError);
  });

  it("maps process stop failures", () => {
    const runtimeVm = buildVm().withRuntime({
      firecrackerPid: 10,
      hostIface: "eth0",
      apiSocketPath: "/tmp/api.socket",
      bootArgs: "console=ttyS0",
      kernelPath: "/tmp/vmlinux",
      jailerVmDir: "/tmp/jailer/vm1",
      firecrackerBinaryPath: "/usr/bin/firecracker",
      jailerBinaryPath: "/usr/bin/jailer",
      releaseTag: "v0.0.0",
      kernelCiVersion: "ci-0",
      kernelVersion: "6.12.0",
      startedAt: new Date().toISOString(),
    }, new Date().toISOString());

    const service = new JailerService({
      stopVmProcess: () => {
        throw new Error("boom");
      },
    } as any);

    expect(() => service.stopVmProcess(runtimeVm)).toThrow(JailerStopFailedError);
  });
});
