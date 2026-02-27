import { DiskClient } from "./disk.client";
import {
  DiskCloneFailedError,
  DiskResizeFailedError,
  DiskShrinkNotSupportedError,
} from "./errors";

export class DiskService {
  constructor(private readonly client: DiskClient = new DiskClient()) {}

  cloneRootfs(sourcePath: string, targetPath: string): void {
    if (!this.client.exists(sourcePath)) {
      throw new DiskCloneFailedError({
        sourcePath,
        targetPath,
        cause: new Error(`Base rootfs does not exist: ${sourcePath}`),
      });
    }

    if (this.client.exists(targetPath)) {
      throw new DiskCloneFailedError({
        sourcePath,
        targetPath,
        cause: new Error(`Target rootfs already exists: ${targetPath}`),
      });
    }

    try {
      this.client.cloneExt4Rootfs(sourcePath, targetPath);
    } catch (cause) {
      throw new DiskCloneFailedError({
        sourcePath,
        targetPath,
        cause,
      });
    }
  }

  growDiskIfNeeded(ext4Path: string, targetSizeMib: number): void {
    if (!this.client.exists(ext4Path)) {
      throw new DiskResizeFailedError({
        ext4Path,
        targetSizeMib,
        cause: new Error(`Cannot resize missing ext4 image: ${ext4Path}`),
      });
    }

    const currentSize = this.client.diskSizeMib(ext4Path);
    if (targetSizeMib < currentSize) {
      throw new DiskShrinkNotSupportedError({
        currentSizeMib: currentSize,
        targetSizeMib,
      });
    }

    try {
      this.client.growExt4DiskIfNeeded(ext4Path, targetSizeMib);
    } catch (cause) {
      throw new DiskResizeFailedError({
        ext4Path,
        targetSizeMib,
        cause,
      });
    }
  }
}

export const diskService = new DiskService();
