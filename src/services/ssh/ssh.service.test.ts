import { describe, expect, it } from "bun:test";
import { MicroVM } from "../../model/microvm/microvm";
import { SshService } from "./ssh.service";

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
      firecrackerPid: 10,
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

describe("SshService", () => {
  it("renders ssh command", () => {
    const service = new SshService({
      waitForReady: async () => undefined,
      renderCommand: () => "ssh -i key root@172.16.0.2",
      connect: () => undefined,
      exec: () => undefined,
      baseArgs: () => [],
    } as any);

    expect(service.renderCommand(buildVm())).toContain("ssh");
  });

  it("delegates interactive ssh connection", () => {
    const calls: string[] = [];
    const service = new SshService({
      waitForReady: async () => undefined,
      renderCommand: () => "ssh ...",
      connect: () => calls.push("connect"),
      exec: () => undefined,
      baseArgs: () => [],
    } as any);

    service.connect(buildVm());
    expect(calls).toEqual(["connect"]);
  });

  it("delegates command execution", () => {
    const calls: string[] = [];
    const service = new SshService({
      waitForReady: async () => undefined,
      renderCommand: () => "ssh ...",
      connect: () => undefined,
      exec: (_target: unknown, command: string) => calls.push(command),
      baseArgs: () => [],
    } as any);

    service.exec(buildVm(), "echo hi");
    expect(calls).toEqual(["echo hi"]);
  });
});
