import type { MicroVM } from "../../model/microvm/microvm";
import { NetworkClient } from "./network.client";
import {
  NetworkSetupFailedError,
  NetworkTeardownFailedError,
} from "./errors";

export class NetworkService {
  constructor(private readonly client: NetworkClient = new NetworkClient()) {}

  async setup(vm: MicroVM): Promise<string> {
    const dto = vm.toDto();
    try {
      this.client.ensureTapDevice({
        vmId: dto.id,
        tapDev: dto.tapDev,
        hostIp: dto.hostIp,
        guestIp: dto.guestIp,
        maskBits: dto.maskBits,
      });
      const hostIface = this.client.applyRules({
        vmId: dto.id,
        tapDev: dto.tapDev,
        hostIp: dto.hostIp,
        guestIp: dto.guestIp,
        maskBits: dto.maskBits,
      });
      return hostIface;
    } catch (cause) {
      throw new NetworkSetupFailedError({
        vmId: dto.id,
        cause,
      });
    }
  }

  async teardown(vm: MicroVM, options: { hostIface?: string } = {}): Promise<void> {
    const dto = vm.toDto();
    try {
      const hostIface = options.hostIface ?? dto.runtime?.hostIface;
      this.client.removeRules({
        vmId: dto.id,
        tapDev: dto.tapDev,
        hostIp: dto.hostIp,
        guestIp: dto.guestIp,
        maskBits: dto.maskBits,
        ...(hostIface ? { hostIface } : {}),
      });
      this.client.removeTapDevice(dto.tapDev);
    } catch (cause) {
      throw new NetworkTeardownFailedError({
        vmId: dto.id,
        cause,
      });
    }
  }
}

export const networkService = new NetworkService();
