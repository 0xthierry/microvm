import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiskService } from "./disk.service";
import { DiskCloneFailedError, DiskShrinkNotSupportedError } from "./errors";

describe("DiskService", () => {
  it("fails clone when source rootfs is missing", () => {
    const service = new DiskService({
      exists: () => false,
      cloneExt4Rootfs: () => undefined,
      growExt4DiskIfNeeded: () => undefined,
      diskSizeMib: () => 0,
    } as any);

    expect(() => service.cloneRootfs("/tmp/missing", "/tmp/target")).toThrow(DiskCloneFailedError);
  });

  it("rejects shrink operations", () => {
    const root = mkdtempSync(join(tmpdir(), "disk-test-"));
    const image = join(root, "rootfs.ext4");
    writeFileSync(image, "placeholder");

    try {
      const service = new DiskService({
        exists: () => true,
        cloneExt4Rootfs: () => undefined,
        growExt4DiskIfNeeded: () => undefined,
        diskSizeMib: () => 1024,
      } as any);

      expect(() => service.growDiskIfNeeded(image, 512)).toThrow(DiskShrinkNotSupportedError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
