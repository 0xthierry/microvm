import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import process from "node:process";

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
  updateVmDatabase: <TResult>(mutator: (db: VmDatabase<TVm>) => TResult) => TResult;
  reserveVmIndex: (db: VmDatabase<TVm>) => number;
  getVmOrThrow: (vmId: string) => TVm;
  clearVmRuntime: (vmId: string) => void;
};

export const createVmRepository = <TVm extends VmRecordLike>({
  appConfig,
}: {
  appConfig: AppConfig;
}): VmRepository<TVm> => {
  const databaseFilePath = appConfig.paths.vmDatabaseFile;
  const databaseLockFilePath = `${databaseFilePath}.lock`;
  const formatVersion = appConfig.defaults.runtime.vmDatabaseFormatVersion;

  const defaultVmDatabase = (): VmDatabase<TVm> => ({
    formatVersion,
    nextIndex: 0,
    vms: {},
  });

  const readVmDatabase = (): VmDatabase<TVm> => {
    if (!existsSync(databaseFilePath)) {
      return defaultVmDatabase();
    }

    const parsed = JSON.parse(readFileSync(databaseFilePath, "utf8")) as Partial<VmDatabase<TVm>>;
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
    mkdirSync(dirname(databaseFilePath), { recursive: true });
    const tempPath = `${databaseFilePath}.tmp.${process.pid}`;
    writeFileSync(
      tempPath,
      `${JSON.stringify({
        formatVersion,
        nextIndex: db.nextIndex,
        vms: db.vms,
      }, null, 2)}\n`,
    );
    renameSync(tempPath, databaseFilePath);
  };

  const withDatabaseLock = <TResult>(action: () => TResult): TResult => {
    mkdirSync(dirname(databaseFilePath), { recursive: true });
    let lockFileDescriptor: number;
    try {
      lockFileDescriptor = openSync(databaseLockFilePath, "wx");
    } catch (error) {
      const errno = error as NodeJS.ErrnoException;
      if (errno.code === "EEXIST") {
        throw new Error("VM database is locked by another microvm command. Retry this command.");
      }
      throw error;
    }

    try {
      return action();
    } finally {
      closeSync(lockFileDescriptor);
      try {
        unlinkSync(databaseLockFilePath);
      } catch {
        // Ignore lock cleanup errors: lock descriptor is already closed.
      }
    }
  };

  const updateVmDatabase = <TResult>(mutator: (db: VmDatabase<TVm>) => TResult): TResult => {
    return withDatabaseLock(() => {
      const db = readVmDatabase();
      const result = mutator(db);
      writeVmDatabase(db);
      return result;
    });
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
    updateVmDatabase((db) => {
      const vm = db.vms[vmId];
      if (!vm) return;
      db.vms[vmId] = { ...vm, runtime: undefined };
    });
  };

  return {
    readVmDatabase,
    writeVmDatabase,
    updateVmDatabase,
    reserveVmIndex,
    getVmOrThrow,
    clearVmRuntime,
  };
};
