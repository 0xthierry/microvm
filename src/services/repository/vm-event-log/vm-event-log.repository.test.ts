import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createTestAppConfig } from "../../../test/test-app-config";
import { VmEventLogRepository } from "./vm-event-log.repository";
import type { VmEvent } from "../../../model/operation/vm-event";
import { UpCheckpoint } from "../../../model/operation/checkpoints";

const buildEvent = (id: string, at: string): VmEvent => ({
  id,
  vmId: "vm1",
  at,
  command: "up",
  type: "checkpoint_reached",
  checkpoint: UpCheckpoint.VALIDATED_INPUT,
});

describe("VmEventLogRepository", () => {
  it("supports append, tail, since, and delete", async () => {
    const { config, cleanup } = createTestAppConfig();

    try {
      const repository = new VmEventLogRepository({
        runtimeDir: config.paths.runtimeDir,
      });

      const e1 = buildEvent("1", "2026-01-01T00:00:00.000Z");
      const e2 = buildEvent("2", "2026-01-01T00:00:01.000Z");
      const e3 = buildEvent("3", "2026-01-01T00:00:02.000Z");

      await repository.append("vm1", e1);
      await repository.append("vm1", e2);
      await repository.append("vm1", e3);

      const tail = await repository.readTail("vm1", 2);
      expect(tail.map((event) => event.id)).toEqual(["2", "3"]);

      const sinceById = await repository.readSince("vm1", "1");
      expect(sinceById.map((event) => event.id)).toEqual(["2", "3"]);

      const sinceByTimestamp = await repository.readSince("vm1", "2026-01-01T00:00:01.000Z");
      expect(sinceByTimestamp.map((event) => event.id)).toEqual(["2", "3"]);

      await repository.deleteLog("vm1");
      expect(await repository.readTail("vm1", 5)).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("ignores malformed NDJSON lines during recovery", async () => {
    const { config, cleanup } = createTestAppConfig();

    try {
      const repository = new VmEventLogRepository({
        runtimeDir: config.paths.runtimeDir,
      });

      const eventsDir = join(config.paths.runtimeDir, "events");
      mkdirSync(eventsDir, { recursive: true });
      const filePath = join(eventsDir, "vm1.ndjson");

      appendFileSync(filePath, `${JSON.stringify(buildEvent("ok-1", "2026-01-01T00:00:00.000Z"))}\n`);
      appendFileSync(filePath, "{ malformed json\n");
      appendFileSync(filePath, `${JSON.stringify(buildEvent("ok-2", "2026-01-01T00:00:01.000Z"))}\n`);

      const events = await repository.readTail("vm1", 10);
      expect(events.map((event) => event.id)).toEqual(["ok-1", "ok-2"]);
    } finally {
      cleanup();
    }
  });
});
