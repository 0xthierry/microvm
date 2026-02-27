import { describe, expect, it } from "bun:test";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createTestAppConfig } from "../../../test/test-app-config";
import { MicroVM } from "../../../model/microvm/microvm";
import { VmRepository } from "./vm.repository";
import {
  VmNotFoundError,
  VmReferenceAmbiguousError,
} from "./errors";

const buildVm = (id: string, name: string, index: number): MicroVM => {
  const now = new Date().toISOString();
  return MicroVM.create({
    id,
    name,
    index,
    vcpuCount: 2,
    memSizeMib: 1024,
    diskSizeMib: 4096,
    dockerfilePath: "/tmp/Dockerfile",
    sshUser: "root",
    hostIp: `172.16.${index}.1`,
    guestIp: `172.16.${index}.2`,
    guestMac: `06:00:AC:10:${String(index).padStart(2, "0")}:02`,
    maskBits: "30",
    maskLong: "255.255.255.252",
    tapDev: `tap-vm${index}`,
    rootfsPath: `/tmp/${id}.ext4`,
    sshKeyPath: "/tmp/key",
    sshPublicKeyPath: "/tmp/key.pub",
    rootfsSource: "/tmp/source.ext4",
    createdAt: now,
    updatedAt: now,
  });
};

describe("VmRepository", () => {
  it("supports CRUD and returns MicroVM objects", async () => {
    const { config, cleanup } = createTestAppConfig();

    try {
      const repository = new VmRepository({
        vmDatabaseFile: config.paths.vmDatabaseFile,
        vmDatabaseFormatVersion: config.defaults.runtime.vmDatabaseFormatVersion,
      });

      const vm = buildVm("vm1", "dev", 0);
      await repository.create(vm);

      const byId = await repository.getById("vm1");
      expect(byId.name).toBe("dev");

      const listed = await repository.list();
      expect(listed.length).toBe(1);

      const updated = byId.withPatch({ memSizeMib: 2048 }, new Date().toISOString());
      await repository.update(updated);
      expect((await repository.getById("vm1")).toDto().memSizeMib).toBe(2048);

      await repository.delete("vm1");
      await expect(repository.getById("vm1")).rejects.toThrow(VmNotFoundError);
    } finally {
      cleanup();
    }
  });

  it("serializes concurrent index reservation using a lock", async () => {
    const { config, cleanup } = createTestAppConfig();

    try {
      const repository = new VmRepository({
        vmDatabaseFile: config.paths.vmDatabaseFile,
        vmDatabaseFormatVersion: config.defaults.runtime.vmDatabaseFormatVersion,
      });

      const indexes = await Promise.all(
        Array.from({ length: 12 }, async () => repository.reserveNextIndex()),
      );

      expect(new Set(indexes).size).toBe(12);
      expect(Math.min(...indexes)).toBe(0);
      expect(Math.max(...indexes)).toBe(11);
    } finally {
      cleanup();
    }
  });

  it("recovers from stale lock files left by crashed processes", async () => {
    const { config, cleanup } = createTestAppConfig();

    try {
      const repository = new VmRepository({
        vmDatabaseFile: config.paths.vmDatabaseFile,
        vmDatabaseFormatVersion: config.defaults.runtime.vmDatabaseFormatVersion,
      });

      const lockPath = `${config.paths.vmDatabaseFile}.lock`;
      mkdirSync(dirname(lockPath), { recursive: true });
      writeFileSync(lockPath, JSON.stringify({
        pid: 999999,
        createdAt: "2020-01-01T00:00:00.000Z",
      }));
      const staleAt = new Date(Date.now() - 60_000);
      utimesSync(lockPath, staleAt, staleAt);

      await expect(repository.reserveNextIndex()).resolves.toBe(0);
    } finally {
      cleanup();
    }
  });

  it("detects ambiguous name references when persisted data is malformed", async () => {
    const { config, cleanup } = createTestAppConfig();

    try {
      const now = new Date().toISOString();
      const malformed = {
        formatVersion: config.defaults.runtime.vmDatabaseFormatVersion,
        nextIndex: 2,
        vms: {
          vm1: {
            ...buildVm("vm1", "dup", 0).toDto(),
            createdAt: now,
            updatedAt: now,
          },
          vm2: {
            ...buildVm("vm2", "dup", 1).toDto(),
            createdAt: now,
            updatedAt: now,
          },
        },
      };

      mkdirSync(dirname(config.paths.vmDatabaseFile), { recursive: true });
      writeFileSync(config.paths.vmDatabaseFile, `${JSON.stringify(malformed, null, 2)}\n`);

      const repository = new VmRepository({
        vmDatabaseFile: config.paths.vmDatabaseFile,
        vmDatabaseFormatVersion: config.defaults.runtime.vmDatabaseFormatVersion,
      });

      await expect(repository.findByNameOrId("dup")).rejects.toThrow(VmReferenceAmbiguousError);
    } finally {
      cleanup();
    }
  });
});
