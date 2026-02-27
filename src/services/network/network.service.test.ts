import { describe, expect, it } from "bun:test";
import { MicroVM } from "../../model/microvm/microvm";
import { NETWORK_RULE_CATALOG } from "./network.client";
import { NetworkService } from "./network.service";
import { NetworkSetupFailedError, NetworkTeardownFailedError } from "./errors";

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

const withRuntime = (vm: MicroVM, hostIface: string): MicroVM =>
  vm.withRuntime({
    firecrackerPid: 10,
    hostIface,
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

describe("Network rule catalog", () => {
  it("contains named mandatory rules", () => {
    const ids = NETWORK_RULE_CATALOG.map((item) => item.id);
    expect(ids).toContain("AllowVmOutboundViaHostNat");
    expect(ids).toContain("AllowHostToVmEstablishedTraffic");
    expect(ids).toContain("DenyVmToVmTraffic");
    expect(ids).toContain("AllowVmToHostServicePort");
    expect(ids).toContain("DenyVmToHostOtherTraffic");
  });
});

describe("NetworkService", () => {
  it("returns setup interface and reuses it on teardown", async () => {
    const calls: string[] = [];
    const removeRulesInputs: Array<{ hostIface?: string }> = [];
    const service = new NetworkService({
      ensureTapDevice: () => calls.push("ensureTapDevice"),
      applyRules: () => {
        calls.push("applyRules");
        return "eth-main";
      },
      removeRules: (runtime: { hostIface?: string }) => {
        calls.push("removeRules");
        removeRulesInputs.push(runtime);
      },
      removeTapDevice: () => calls.push("removeTapDevice"),
      getDefaultHostIface: () => "eth0",
    } as any);

    const vm = buildVm();
    const hostIface = await service.setup(vm);
    await service.teardown(vm, { hostIface });

    expect(calls).toEqual([
      "ensureTapDevice",
      "applyRules",
      "removeRules",
      "removeTapDevice",
    ]);
    expect(hostIface).toBe("eth-main");
    expect(removeRulesInputs[0]?.hostIface).toBe("eth-main");
  });

  it("maps setup failures", async () => {
    const service = new NetworkService({
      ensureTapDevice: () => {
        throw new Error("boom");
      },
      applyRules: () => undefined,
      removeRules: () => undefined,
      removeTapDevice: () => undefined,
      getDefaultHostIface: () => "eth0",
    } as any);

    await expect(service.setup(buildVm())).rejects.toThrow(NetworkSetupFailedError);
  });

  it("maps teardown failures", async () => {
    const service = new NetworkService({
      ensureTapDevice: () => undefined,
      applyRules: () => undefined,
      removeRules: () => {
        throw new Error("boom");
      },
      removeTapDevice: () => undefined,
      getDefaultHostIface: () => "eth0",
    } as any);

    await expect(service.teardown(buildVm())).rejects.toThrow(NetworkTeardownFailedError);
  });

  it("uses persisted runtime host interface for teardown", async () => {
    const removeRulesInputs: Array<{ hostIface?: string }> = [];
    const service = new NetworkService({
      ensureTapDevice: () => undefined,
      applyRules: () => "eth0",
      removeRules: (runtime: { hostIface?: string }) => {
        removeRulesInputs.push(runtime);
      },
      removeTapDevice: () => undefined,
      getDefaultHostIface: () => "eth-default",
    } as any);

    const vm = withRuntime(buildVm(), "eth-persisted");
    await service.teardown(vm);

    expect(removeRulesInputs[0]?.hostIface).toBe("eth-persisted");
  });
});
