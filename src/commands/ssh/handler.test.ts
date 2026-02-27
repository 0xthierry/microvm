import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { MicroVM } from "../../model/microvm/microvm";
import { VmStatus } from "../../model/microvm/vm-status";
import { vmRepository } from "../../services/repository/vm/vm.repository";
import { sshService } from "../../services/ssh/ssh.service";
import { handleSsh } from "./handler";

const buildVm = (): MicroVM => {
  const now = new Date().toISOString();
  return MicroVM.create({
    id: "vm-ssh",
    name: "ssh-dev",
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
    status: VmStatus.RUNNING,
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

describe("handleSsh", () => {
  afterEach(() => {
    mock.restore();
  });

  it("opens an interactive ssh session by default", async () => {
    const vm = buildVm();
    const connectSpy = spyOn(sshService, "connect").mockImplementation(() => {});
    const execSpy = spyOn(sshService, "exec").mockImplementation(() => {});
    const renderSpy = spyOn(sshService, "renderCommand").mockReturnValue("ssh ...");
    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    spyOn(vmRepository, "findByNameOrId").mockResolvedValue(vm);

    await handleSsh({
      nameOrId: vm.id,
      outputJson: false,
    });

    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(connectSpy).toHaveBeenCalledWith(vm);
    expect(execSpy).not.toHaveBeenCalled();
    expect(renderSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("preserves the json contract for the no-command path", async () => {
    const vm = buildVm();
    const connectSpy = spyOn(sshService, "connect").mockImplementation(() => {});
    const renderSpy = spyOn(sshService, "renderCommand").mockReturnValue(
      "ssh -i '/tmp/key' root@172.16.0.2",
    );
    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    spyOn(vmRepository, "findByNameOrId").mockResolvedValue(vm);

    await handleSsh({
      nameOrId: vm.id,
      outputJson: true,
    });

    expect(connectSpy).not.toHaveBeenCalled();
    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledTimes(1);

    expect(JSON.parse(String(logSpy.mock.calls[0]?.[0] ?? ""))).toEqual({
      command: "ssh",
      vm: {
        id: vm.id,
        name: vm.name,
      },
      sshCommand: "ssh -i '/tmp/key' root@172.16.0.2",
    });
  });
});
