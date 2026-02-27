import { describe, expect, it } from "bun:test";
import { createTestAppConfig } from "../../test/test-app-config";
import {
  CreateCheckpoint,
  DeleteCheckpoint,
  DownCheckpoint,
  UpCheckpoint,
} from "./checkpoints";
import { VmOperation } from "./vm-operation";
import { VmEventLogRepository } from "../../services/repository/vm-event-log/vm-event-log.repository";

describe("Vm checkpoints", () => {
  it("exposes command-scoped checkpoint enums", () => {
    expect(CreateCheckpoint.PREPARED_ROOTFS).toEqual(CreateCheckpoint.PREPARED_ROOTFS);
    expect(UpCheckpoint.VM_BOOTED).toEqual(UpCheckpoint.VM_BOOTED);
    expect(DownCheckpoint.RUNTIME_CLEARED).toEqual(DownCheckpoint.RUNTIME_CLEARED);
    expect(DeleteCheckpoint.RECORD_DELETED).toEqual(DeleteCheckpoint.RECORD_DELETED);
  });
});

describe("VmOperation lifecycle", () => {
  it("writes operation and checkpoint events", async () => {
    const { config, cleanup } = createTestAppConfig();

    try {
      const repository = new VmEventLogRepository({
        runtimeDir: config.paths.runtimeDir,
      });

      const operation = await VmOperation.start("vm123", "up", repository);
      await operation.checkpoint(UpCheckpoint.VALIDATED_INPUT, { nameOrId: "dev" });
      await operation.succeeded();

      const events = await repository.readTail("vm123", 10);
      expect(events.map((event) => event.type)).toEqual([
        "operation_started",
        "checkpoint_reached",
        "operation_succeeded",
      ]);
      expect(events[1]?.checkpoint).toBe(UpCheckpoint.VALIDATED_INPUT);
    } finally {
      cleanup();
    }
  });

  it("persists rollback context entries", async () => {
    const { config, cleanup } = createTestAppConfig();

    try {
      const repository = new VmEventLogRepository({
        runtimeDir: config.paths.runtimeDir,
      });

      const operation = await VmOperation.start("vm456", "create", repository);
      await operation.checkpoint(CreateCheckpoint.PREPARED_DIRS, { vmDir: "/tmp/vm" });
      await operation.rollbackStarted(new Error("boom"));
      await operation.failed(new Error("boom"));

      const events = await repository.readTail("vm456", 10);
      const rollback = events.find((event) => event.type === "rollback_started");
      expect(rollback?.data).toBeDefined();
    } finally {
      cleanup();
    }
  });
});
