import type { MicroVM } from "../../model/microvm/microvm";
import { SshClient } from "./ssh.client";

export class SshService {
  constructor(private readonly client: SshClient = new SshClient()) {}

  async waitUntilReady(vm: MicroVM, timeoutMs = 30000): Promise<void> {
    const dto = vm.toDto();
    await this.client.waitForReady({
      sshUser: dto.sshUser,
      sshKeyPath: dto.sshKeyPath,
      guestIp: dto.guestIp,
    }, timeoutMs);
  }

  renderCommand(vm: MicroVM): string {
    const dto = vm.toDto();
    return this.client.renderCommand({
      sshUser: dto.sshUser,
      sshKeyPath: dto.sshKeyPath,
      guestIp: dto.guestIp,
    });
  }

  connect(vm: MicroVM): void {
    const dto = vm.toDto();
    this.client.connect({
      sshUser: dto.sshUser,
      sshKeyPath: dto.sshKeyPath,
      guestIp: dto.guestIp,
    });
  }

  exec(vm: MicroVM, command: string): void {
    const dto = vm.toDto();
    this.client.exec({
      sshUser: dto.sshUser,
      sshKeyPath: dto.sshKeyPath,
      guestIp: dto.guestIp,
    }, command);
  }
}

export const sshService = new SshService();
