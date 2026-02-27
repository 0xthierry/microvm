import { describe, expect, it } from "bun:test";
import { MicroVM } from "./microvm";
import { VmInvalidTransitionError } from "./errors";
import { VmStatus, vmStatusSchema } from "./vm-status";

const buildVm = (): MicroVM =>
  MicroVM.create({
    id: "vmabc123",
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

describe("MicroVM transitions", () => {
  it("allows create -> starting -> running -> stopping -> stopped", () => {
    const created = buildVm();
    const starting = created.up(new Date().toISOString());
    const running = starting.run(new Date().toISOString());
    const stopping = running.down(new Date().toISOString());
    const stopped = stopping.stop(new Date().toISOString());

    expect(stopped.status).toBe(VmStatus.STOPPED);
  });

  it("allows failure transitions", () => {
    const created = buildVm();
    const failed = created.fail(new Date().toISOString(), "boom");
    expect(failed.status).toBe(VmStatus.FAILED);

    const restarting = failed.up(new Date().toISOString());
    expect(restarting.status).toBe(VmStatus.STARTING);
  });

  it("can clear runtime metadata before failing when teardown has completed", () => {
    const now = new Date().toISOString();
    const created = buildVm();
    const running = MicroVM.create({
      ...created.toDto(),
      status: VmStatus.RUNNING,
      updatedAt: now,
      runtime: {
      firecrackerPid: 321,
      hostIface: "eth0",
      apiSocketPath: "/tmp/api.socket",
      bootArgs: "console=ttyS0",
      kernelPath: "/tmp/vmlinux",
      jailerVmDir: "/tmp/jailer/vmabc123",
      firecrackerBinaryPath: "/usr/bin/firecracker",
      jailerBinaryPath: "/usr/bin/jailer",
      releaseTag: "v0.0.0",
      kernelCiVersion: "ci-0",
      kernelVersion: "6.12.0",
      startedAt: now,
      },
    });

    const failed = running
      .clearRuntime(new Date().toISOString())
      .fail(new Date().toISOString(), "down_failed");

    expect(failed.status).toBe(VmStatus.FAILED);
    expect(failed.runtime).toBeUndefined();
  });

  it("throws on invalid transition", () => {
    const created = buildVm();
    expect(() => created.run(new Date().toISOString())).toThrow(VmInvalidTransitionError);
  });
});

describe("VmStatus schema", () => {
  it("parses canonical statuses", () => {
    expect(vmStatusSchema.parse("created")).toBe(VmStatus.CREATED);
    expect(vmStatusSchema.parse("running")).toBe(VmStatus.RUNNING);
  });

  it("rejects unknown status", () => {
    expect(() => vmStatusSchema.parse("unknown")).toThrow();
  });
});
