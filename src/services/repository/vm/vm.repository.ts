import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { getAppConfig } from "../../../config/runtime-context";
import { MicroVM } from "../../../model/microvm/microvm";
import { microVmDtoSchema } from "../../../model/microvm/schema";
import {
  VmAlreadyExistsError,
  VmNameAlreadyExistsError,
  VmNotFoundError,
  VmReferenceAmbiguousError,
  VmRepositoryLockFailedError,
  VmRepositoryReadFailedError,
  VmRepositoryWriteFailedError,
} from "./errors";

const vmRepositoryDatabaseSchema = z.object({
  formatVersion: z.number().int().nonnegative(),
  nextIndex: z.number().int().nonnegative(),
  vms: z.record(z.string(), microVmDtoSchema),
});

type VmRepositoryDatabase = z.infer<typeof vmRepositoryDatabaseSchema>;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export class VmRepository {
  private readonly vmDatabaseFileOverride: string | undefined;
  private readonly vmDatabaseFormatVersionOverride: number | undefined;

  constructor(options: {
    vmDatabaseFile?: string;
    vmDatabaseFormatVersion?: number;
  } = {}) {
    this.vmDatabaseFileOverride = options.vmDatabaseFile;
    this.vmDatabaseFormatVersionOverride = options.vmDatabaseFormatVersion;
  }

  async getById(id: string): Promise<MicroVM> {
    const db = await this.readDatabase();
    const vm = db.vms[id];
    if (!vm) {
      throw new VmNotFoundError({ vmRef: id });
    }
    return MicroVM.fromDto(vm);
  }

  async getByName(name: string): Promise<MicroVM> {
    const db = await this.readDatabase();
    const matches = Object.values(db.vms).filter((vm) => vm.name === name);

    if (matches.length === 0) {
      throw new VmNotFoundError({ vmRef: name });
    }

    if (matches.length > 1) {
      throw new VmReferenceAmbiguousError({
        vmRef: name,
        vmIds: matches.map((vm) => vm.id),
      });
    }

    const first = matches[0];
    if (!first) {
      throw new VmNotFoundError({ vmRef: name });
    }

    return MicroVM.fromDto(first);
  }

  async findByNameOrId(nameOrId: string): Promise<MicroVM> {
    const db = await this.readDatabase();

    const idMatch = db.vms[nameOrId];
    if (idMatch) {
      return MicroVM.fromDto(idMatch);
    }

    const matches = Object.values(db.vms).filter((vm) => vm.name === nameOrId);
    if (matches.length === 0) {
      throw new VmNotFoundError({ vmRef: nameOrId });
    }

    if (matches.length > 1) {
      throw new VmReferenceAmbiguousError({
        vmRef: nameOrId,
        vmIds: matches.map((vm) => vm.id),
      });
    }

    const first = matches[0];
    if (!first) {
      throw new VmNotFoundError({ vmRef: nameOrId });
    }

    return MicroVM.fromDto(first);
  }

  async list(): Promise<MicroVM[]> {
    const db = await this.readDatabase();
    return Object.values(db.vms)
      .sort((left, right) => left.index - right.index)
      .map((item) => MicroVM.fromDto(item));
  }

  async create(vm: MicroVM): Promise<void> {
    await this.withLock(async () => {
      const db = await this.readDatabase();
      const dto = vm.toDto();

      if (db.vms[dto.id]) {
        throw new VmAlreadyExistsError({ vmId: dto.id });
      }

      const duplicateName = Object.values(db.vms).find((item) => item.name === dto.name);
      if (duplicateName) {
        throw new VmNameAlreadyExistsError({
          name: dto.name,
          vmId: duplicateName.id,
        });
      }

      db.vms[dto.id] = dto;
      db.nextIndex = Math.max(db.nextIndex, dto.index + 1);
      await this.writeDatabase(db);
    });
  }

  async update(vm: MicroVM): Promise<void> {
    await this.withLock(async () => {
      const db = await this.readDatabase();
      const dto = vm.toDto();
      const current = db.vms[dto.id];

      if (!current) {
        throw new VmNotFoundError({ vmRef: dto.id });
      }

      const duplicateName = Object.values(db.vms)
        .find((item) => item.id !== dto.id && item.name === dto.name);
      if (duplicateName) {
        throw new VmNameAlreadyExistsError({
          name: dto.name,
          vmId: duplicateName.id,
        });
      }

      db.vms[dto.id] = dto;
      await this.writeDatabase(db);
    });
  }

  async delete(id: string): Promise<void> {
    await this.withLock(async () => {
      const db = await this.readDatabase();
      if (!db.vms[id]) {
        throw new VmNotFoundError({ vmRef: id });
      }
      delete db.vms[id];
      await this.writeDatabase(db);
    });
  }

  async reserveNextIndex(): Promise<number> {
    return this.withLock(async () => {
      const db = await this.readDatabase();
      const used = new Set(Object.values(db.vms).map((vm) => vm.index));
      let index = db.nextIndex;
      while (used.has(index)) {
        index += 1;
      }
      db.nextIndex = index + 1;
      await this.writeDatabase(db);
      return index;
    });
  }

  private async withLock<TResult>(fn: () => Promise<TResult>): Promise<TResult> {
    try {
      const vmDatabaseFile = this.resolveVmDatabaseFile();
      mkdirSync(dirname(vmDatabaseFile), { recursive: true });
    } catch (cause) {
      throw new VmRepositoryWriteFailedError({ cause });
    }

    const timeoutMs = 3000;
    const waitMs = 20;
    const staleLockMs = 3000;
    const startedAt = Date.now();

    const lockFilePath = this.resolveLockFilePath();
    let fd: number | undefined;

    while (fd === undefined) {
      try {
        fd = openSync(lockFilePath, "wx");
      } catch (cause) {
        const errno = cause as NodeJS.ErrnoException;
        if (errno.code !== "EEXIST") {
          throw new VmRepositoryLockFailedError({
            lockPath: lockFilePath,
            cause,
          });
        }

        if (this.tryRecoverStaleLock(lockFilePath, staleLockMs)) {
          continue;
        }

        if (Date.now() - startedAt > timeoutMs) {
          throw new VmRepositoryLockFailedError({
            lockPath: lockFilePath,
            cause,
          });
        }

        await delay(waitMs);
      }
    }

    try {
      this.writeLockMetadata(fd);
      return await fn();
    } finally {
      closeSync(fd);
      try {
        unlinkSync(lockFilePath);
      } catch {
        // ignore lock cleanup failures
      }
    }
  }

  private async readDatabase(): Promise<VmRepositoryDatabase> {
    try {
      const vmDatabaseFile = this.resolveVmDatabaseFile();
      if (!existsSync(vmDatabaseFile)) {
        return {
          formatVersion: this.resolveVmDatabaseFormatVersion(),
          nextIndex: 0,
          vms: {},
        };
      }

      const raw = readFileSync(vmDatabaseFile, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      const db = vmRepositoryDatabaseSchema.parse(parsed);

      const inferredNextIndex = Object.values(db.vms)
        .reduce((max, vm) => Math.max(max, vm.index), -1) + 1;

      return {
        formatVersion: this.resolveVmDatabaseFormatVersion(),
        nextIndex: Math.max(db.nextIndex, inferredNextIndex, 0),
        vms: db.vms,
      };
    } catch (cause) {
      throw new VmRepositoryReadFailedError({ cause });
    }
  }

  private async writeDatabase(db: VmRepositoryDatabase): Promise<void> {
    try {
      const vmDatabaseFile = this.resolveVmDatabaseFile();
      mkdirSync(dirname(vmDatabaseFile), { recursive: true });
      const tempPath = `${vmDatabaseFile}.tmp.${process.pid}.${Date.now()}`;
      const vmDatabaseFormatVersion = this.resolveVmDatabaseFormatVersion();
      writeFileSync(
        tempPath,
        `${JSON.stringify({
          formatVersion: vmDatabaseFormatVersion,
          nextIndex: db.nextIndex,
          vms: db.vms,
        }, null, 2)}\n`,
      );
      renameSync(tempPath, vmDatabaseFile);
    } catch (cause) {
      throw new VmRepositoryWriteFailedError({ cause });
    }
  }

  private resolveVmDatabaseFile(): string {
    return this.vmDatabaseFileOverride ?? getAppConfig().paths.vmDatabaseFile;
  }

  private resolveVmDatabaseFormatVersion(): number {
    return this.vmDatabaseFormatVersionOverride ?? getAppConfig().defaults.runtime.vmDatabaseFormatVersion;
  }

  private resolveLockFilePath(): string {
    return `${this.resolveVmDatabaseFile()}.lock`;
  }

  private writeLockMetadata(fd: number): void {
    try {
      writeFileSync(fd, `${JSON.stringify({
        pid: process.pid,
        createdAt: new Date().toISOString(),
      })}\n`);
    } catch {
      // Metadata helps stale-lock recovery but should not break lock acquisition.
    }
  }

  private tryRecoverStaleLock(lockFilePath: string, staleLockMs: number): boolean {
    try {
      const stats = statSync(lockFilePath);
      const ageMs = Date.now() - stats.mtimeMs;
      if (ageMs < staleLockMs) {
        return false;
      }

      const ownerPid = this.readLockOwnerPid(lockFilePath);
      if (ownerPid !== undefined && this.isProcessAlive(ownerPid)) {
        return false;
      }

      unlinkSync(lockFilePath);
      return true;
    } catch (cause) {
      const errno = cause as NodeJS.ErrnoException;
      if (errno.code === "ENOENT") {
        return true;
      }
      return false;
    }
  }

  private readLockOwnerPid(lockFilePath: string): number | undefined {
    try {
      const raw = readFileSync(lockFilePath, "utf8").trim();
      if (raw.length === 0) {
        return undefined;
      }

      if (/^\d+$/.test(raw)) {
        const pid = Number(raw);
        return Number.isFinite(pid) && pid > 0 ? pid : undefined;
      }

      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object") {
        return undefined;
      }
      const pid = (parsed as { pid?: unknown }).pid;
      if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
        return undefined;
      }
      return pid;
    } catch {
      return undefined;
    }
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (cause) {
      const errno = cause as NodeJS.ErrnoException;
      return errno.code === "EPERM";
    }
  }
}

export const vmRepository = new VmRepository();
