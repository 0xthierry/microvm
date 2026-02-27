import { randomUUID } from "node:crypto";
import { VmStatus } from "../microvm/vm-status";
import type { VmCheckpoint } from "./checkpoints";
import type { VmOperationCommand } from "./vm-event";
import {
  vmEventSchema,
  type VmEvent,
} from "./vm-event";

export type VmOperationEventLogRepository = {
  append(vmId: string, event: VmEvent): Promise<void>;
};

const normalizeError = (error: unknown): VmEvent["error"] => {
  if (error instanceof Error) {
    const maybeWithDetails = error as Error & { details?: Record<string, unknown> };
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      details: maybeWithDetails.details,
    };
  }

  return {
    name: "UnknownError",
    message: String(error),
  };
};

export class VmOperation {
  private readonly rollbackContexts = new Map<VmCheckpoint, Record<string, unknown> | undefined>();

  constructor(
    readonly vmId: string,
    readonly command: VmOperationCommand,
    private readonly repository: VmOperationEventLogRepository,
  ) {}

  static async start(
    vmId: string,
    command: VmOperationCommand,
    repository: VmOperationEventLogRepository,
  ): Promise<VmOperation> {
    const op = new VmOperation(vmId, command, repository);
    await op.append({
      type: "operation_started",
    });
    return op;
  }

  async checkpoint(checkpoint: VmCheckpoint, data?: Record<string, unknown>): Promise<void> {
    this.rollbackContexts.set(checkpoint, data);
    await this.append({
      type: "checkpoint_reached",
      checkpoint,
      data,
    });
  }

  async stateChanged(stateFrom: VmStatus, stateTo: VmStatus): Promise<void> {
    await this.append({
      type: "state_changed",
      stateFrom,
      stateTo,
    });
  }

  async rollbackStarted(cause: unknown): Promise<void> {
    const contextEntries = [...this.rollbackContexts.entries()].map(([checkpoint, data]) => ({
      checkpoint,
      data,
    }));

    await this.append({
      type: "rollback_started",
      data: {
        checkpoints: contextEntries,
      },
      error: normalizeError(cause),
    });
  }

  async rollbackCheckpoint(checkpoint: VmCheckpoint, data?: Record<string, unknown>): Promise<void> {
    await this.append({
      type: "rollback_checkpoint",
      checkpoint,
      data,
    });
  }

  async succeeded(): Promise<void> {
    await this.append({
      type: "operation_succeeded",
    });
  }

  async failed(error: unknown): Promise<void> {
    await this.append({
      type: "operation_failed",
      error: normalizeError(error),
    });
  }

  async rollbackFailed(error: unknown): Promise<void> {
    await this.append({
      type: "rollback_failed",
      error: normalizeError(error),
    });
  }

  private async append(
    payload: Omit<VmEvent, "id" | "vmId" | "at" | "command">,
  ): Promise<void> {
    await this.repository.append(
      this.vmId,
      vmEventSchema.parse({
        id: randomUUID(),
        vmId: this.vmId,
        at: new Date().toISOString(),
        command: this.command,
        ...payload,
      }),
    );
  }
}
