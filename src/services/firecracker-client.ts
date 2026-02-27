import { setTimeout as sleep } from "node:timers/promises";

import type { ProcessService } from "./process";

type FirecrackerVmConfig = {
  apiSocketPath: string;
  vcpuCount: number;
  memSizeMib: number;
  tapDev: string;
  guestMac: string;
};

export type FirecrackerClientService = {
  waitForFirecrackerApi: (socketPath: string, timeoutMs: number) => Promise<void>;
  firecrackerPut: (socketPath: string, endpoint: string, payload: unknown) => void;
  configureAndStartVm: (params: {
    config: FirecrackerVmConfig;
    kernelPath: string;
    rootfsPath: string;
    bootArgs: string;
  }) => Promise<void>;
};

export const createFirecrackerClientService = ({
  process,
}: {
  process: ProcessService;
}): FirecrackerClientService => {
  const firecrackerPut = (socketPath: string, endpoint: string, payload: unknown): void => {
    process.run([
      "curl",
      "--silent",
      "--show-error",
      "--fail",
      "--unix-socket",
      socketPath,
      "-X",
      "PUT",
      `http://localhost${endpoint}`,
      "-H",
      "Content-Type: application/json",
      "-d",
      JSON.stringify(payload),
    ]);
  };

  const waitForFirecrackerApi = async (socketPath: string, timeoutMs: number): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const ping = process.run(
        [
          "curl",
          "--silent",
          "--show-error",
          "--fail",
          "--unix-socket",
          socketPath,
          "http://localhost/",
        ],
        { allowFailure: true },
      );
      if (ping.exitCode === 0) return;
      await sleep(200);
    }
    throw new Error(`Timed out waiting for Firecracker API socket: ${socketPath}`);
  };

  const configureAndStartVm = async ({
    config,
    kernelPath,
    rootfsPath,
    bootArgs,
  }: {
    config: FirecrackerVmConfig;
    kernelPath: string;
    rootfsPath: string;
    bootArgs: string;
  }): Promise<void> => {
    firecrackerPut(config.apiSocketPath, "/machine-config", {
      vcpu_count: config.vcpuCount,
      mem_size_mib: config.memSizeMib,
    });
    firecrackerPut(config.apiSocketPath, "/boot-source", {
      kernel_image_path: kernelPath,
      boot_args: bootArgs,
    });
    firecrackerPut(config.apiSocketPath, "/drives/rootfs", {
      drive_id: "rootfs",
      path_on_host: rootfsPath,
      is_root_device: true,
      is_read_only: false,
    });
    firecrackerPut(config.apiSocketPath, "/network-interfaces/eth0", {
      iface_id: "eth0",
      host_dev_name: config.tapDev,
      guest_mac: config.guestMac,
    });
    firecrackerPut(config.apiSocketPath, "/actions", {
      action_type: "InstanceStart",
    });
  };

  return {
    waitForFirecrackerApi,
    firecrackerPut,
    configureAndStartVm,
  };
};
