import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { getAppConfig } from "../../../config/runtime-context";
import { vmEventSchema, type VmEvent } from "../../../model/operation/vm-event";
import {
  VmEventLogDeleteFailedError,
  VmEventLogReadFailedError,
  VmEventLogWriteFailedError,
} from "./errors";

export class VmEventLogRepository {
  private readonly runtimeDirOverride: string | undefined;

  constructor(options: {
    runtimeDir?: string;
  } = {}) {
    this.runtimeDirOverride = options.runtimeDir;
  }

  async append(vmId: string, event: VmEvent): Promise<void> {
    try {
      const eventsDir = this.resolveEventsDir();
      mkdirSync(eventsDir, { recursive: true });
      const path = this.logPath(vmId);
      appendFileSync(path, `${JSON.stringify(vmEventSchema.parse(event))}\n`, "utf8");
    } catch (cause) {
      throw new VmEventLogWriteFailedError({
        vmId,
        cause,
      });
    }
  }

  async readTail(vmId: string, count = 50): Promise<VmEvent[]> {
    const all = await this.readAll(vmId);
    if (count <= 0) {
      return [];
    }
    return all.slice(-count);
  }

  async readSince(vmId: string, from: string): Promise<VmEvent[]> {
    const all = await this.readAll(vmId);
    const fromIndex = all.findIndex((event) => event.id === from);
    if (fromIndex >= 0) {
      return all.slice(fromIndex + 1);
    }

    const timestamp = Date.parse(from);
    if (!Number.isNaN(timestamp)) {
      return all.filter((event) => Date.parse(event.at) >= timestamp);
    }

    return [];
  }

  async deleteLog(vmId: string): Promise<void> {
    try {
      const path = this.logPath(vmId);
      if (!existsSync(path)) {
        return;
      }
      rmSync(path, { force: true });
    } catch (cause) {
      throw new VmEventLogDeleteFailedError({
        vmId,
        cause,
      });
    }
  }

  private async readAll(vmId: string): Promise<VmEvent[]> {
    try {
      const path = this.logPath(vmId);
      if (!existsSync(path)) {
        return [];
      }

      const raw = readFileSync(path, "utf8");
      const lines = raw
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      const events: VmEvent[] = [];
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as unknown;
          events.push(vmEventSchema.parse(parsed));
        } catch {
          // Intentionally skip malformed event lines for log recovery.
        }
      }

      return events;
    } catch (cause) {
      throw new VmEventLogReadFailedError({
        vmId,
        cause,
      });
    }
  }

  private logPath(vmId: string): string {
    return join(this.resolveEventsDir(), `${vmId}.ndjson`);
  }

  private resolveEventsDir(): string {
    const runtimeDir = this.runtimeDirOverride ?? getAppConfig().paths.runtimeDir;
    return join(runtimeDir, "events");
  }
}

export const vmEventLogRepository = new VmEventLogRepository();
export type { VmEvent };
