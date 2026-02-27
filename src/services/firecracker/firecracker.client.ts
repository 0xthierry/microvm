import { setTimeout as sleep } from "node:timers/promises";
import { processRunner, ProcessRunFailedError } from "../../lib/process/process-runner";
import { FirecrackerConnectionFailedError } from "./errors";

export type FirecrackerConfigureInput = {
  socketPath: string;
  vcpuCount: number;
  memSizeMib: number;
  tapDev: string;
  guestMac: string;
  kernelPath: string;
  rootfsPath: string;
  bootArgs: string;
};

export class FirecrackerClient {
  async waitForApi(socketPath: string, timeoutMs = 15000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const result = processRunner.run(
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

        if (result.exitCode === 0) {
          return;
        }
      } catch (cause) {
        if (!(cause instanceof ProcessRunFailedError)) {
          throw new FirecrackerConnectionFailedError({ socketPath, cause });
        }
      }

      await sleep(200);
    }

    throw new FirecrackerConnectionFailedError({
      socketPath,
      cause: new Error(`Timed out waiting for Firecracker API after ${timeoutMs}ms.`),
    });
  }

  put(socketPath: string, endpoint: string, payload: unknown): void {
    try {
      processRunner.run([
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
    } catch (cause) {
      throw new FirecrackerConnectionFailedError({
        socketPath,
        cause,
      });
    }
  }

  configure(input: FirecrackerConfigureInput): void {
    this.put(input.socketPath, "/machine-config", {
      vcpu_count: input.vcpuCount,
      mem_size_mib: input.memSizeMib,
    });

    this.put(input.socketPath, "/boot-source", {
      kernel_image_path: input.kernelPath,
      boot_args: input.bootArgs,
    });

    this.put(input.socketPath, "/drives/rootfs", {
      drive_id: "rootfs",
      path_on_host: input.rootfsPath,
      is_root_device: true,
      is_read_only: false,
    });

    this.put(input.socketPath, "/network-interfaces/eth0", {
      iface_id: "eth0",
      host_dev_name: input.tapDev,
      guest_mac: input.guestMac,
    });
  }

  instanceStart(socketPath: string): void {
    this.put(socketPath, "/actions", {
      action_type: "InstanceStart",
    });
  }
}
