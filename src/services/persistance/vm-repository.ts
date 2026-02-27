import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { AppConfig } from "../../config/app-config";

export type VmRecordLike = {
  index: number;
  runtime?: unknown;
};

export type VmDatabase<TVm extends VmRecordLike> = {
  formatVersion: number;
  nextIndex: number;
  vms: Record<string, TVm>;
};

export type VmRepository<TVm extends VmRecordLike> = {
  readVmDatabase: () => VmDatabase<TVm>;
  writeVmDatabase: (db: VmDatabase<TVm>) => void;
  reserveVmIndex: (db: VmDatabase<TVm>) => number;
  getVmOrThrow: (vmId: string) => TVm;
  clearVmRuntime: (vmId: string) => void;
};

export const createVmRepository = <TVm extends VmRecordLike>({
  appConfig,
}: {
  appConfig: AppConfig;
}): VmRepository<TVm> => {
  const dbFilePath = appConfig.paths.vmDbFile;
  const formatVersion = appConfig.defaults.runtime.vmDbFormatVersion;

  const defaultVmDatabase = (): VmDatabase<TVm> => ({
    formatVersion,
    nextIndex: 0,
    vms: {},
  });

  const readVmDatabase = (): VmDatabase<TVm> => {
    if (!existsSync(dbFilePath)) {
      return defaultVmDatabase();
    }

    const parsed = JSON.parse(readFileSync(dbFilePath, "utf8")) as Partial<VmDatabase<TVm>>;
    const rawVms = parsed.vms && typeof parsed.vms === "object" ? (parsed.vms as Record<string, TVm>) : {};
    const nextIndex = Number(parsed.nextIndex ?? 0);
    const normalized: VmDatabase<TVm> = {
      formatVersion,
      nextIndex: Number.isFinite(nextIndex) && nextIndex >= 0 ? nextIndex : 0,
      vms: rawVms,
    };

    const maxIndex = Object.values(normalized.vms).reduce((max, vm) => {
      const index = Number(vm.index);
      return Number.isFinite(index) ? Math.max(max, index) : max;
    }, -1);
    normalized.nextIndex = Math.max(normalized.nextIndex, maxIndex + 1);
    return normalized;
  };

  const writeVmDatabase = (db: VmDatabase<TVm>): void => {
    mkdirSync(dirname(dbFilePath), { recursive: true });
    writeFileSync(
      dbFilePath,
      `${JSON.stringify({
        formatVersion,
        nextIndex: db.nextIndex,
        vms: db.vms,
      }, null, 2)}\n`,
    );
  };

  const reserveVmIndex = (db: VmDatabase<TVm>): number => {
    const usedIndexes = new Set(
      Object.values(db.vms)
        .map((vm) => Number(vm.index))
        .filter((index) => Number.isFinite(index)),
    );

    // Reuse the lowest available index so /30 guest IPs are recycled after delete.
    let candidate = 0;
    while (usedIndexes.has(candidate)) {
      candidate += 1;
    }

    db.nextIndex = candidate + 1;
    return candidate;
  };

  const getVmOrThrow = (vmId: string): TVm => {
    const vm = readVmDatabase().vms[vmId];
    if (!vm) {
      throw new Error(`VM "${vmId}" does not exist.`);
    }
    return vm;
  };

  const clearVmRuntime = (vmId: string): void => {
    const db = readVmDatabase();
    const vm = db.vms[vmId];
    if (!vm) return;
    db.vms[vmId] = { ...vm, runtime: undefined };
    writeVmDatabase(db);
  };

  return {
    readVmDatabase,
    writeVmDatabase,
    reserveVmIndex,
    getVmOrThrow,
    clearVmRuntime,
  };
};
