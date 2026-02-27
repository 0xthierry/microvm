import { chmodSync, existsSync, statSync } from "node:fs";
import { dirname } from "node:path";

import type { ProcessService } from "./process";

export type DiskImageService = {
  cloneExt4Rootfs: (sourcePath: string, targetPath: string) => void;
  growExt4DiskIfNeeded: (ext4Path: string, targetSizeMib: number) => void;
};

export const createDiskImageService = ({
  process,
}: {
  process: ProcessService;
}): DiskImageService => {
  const ensureDirs = (paths: string[]): void => {
    paths.forEach((path) => process.run(["mkdir", "-p", path]));
  };

  const diskSizeMiB = (path: string): number => {
    const bytes = statSync(path).size;
    return Math.floor(bytes / (1024 * 1024));
  };

  const cloneExt4Rootfs = (sourcePath: string, targetPath: string): void => {
    if (!existsSync(sourcePath)) {
      throw new Error(`Base rootfs does not exist: ${sourcePath}`);
    }
    if (existsSync(targetPath)) {
      throw new Error(`Target rootfs already exists: ${targetPath}`);
    }

    ensureDirs([dirname(targetPath)]);
    const reflinkCopy = process.run(["cp", "--reflink=auto", sourcePath, targetPath], { allowFailure: true });
    if (reflinkCopy.exitCode !== 0) {
      process.run(["cp", "-f", sourcePath, targetPath]);
    }
    chmodSync(targetPath, 0o644);
  };

  const growExt4DiskIfNeeded = (ext4Path: string, targetSizeMib: number): void => {
    if (!existsSync(ext4Path)) {
      throw new Error(`Cannot resize missing ext4 image: ${ext4Path}`);
    }
    const currentSizeMib = diskSizeMiB(ext4Path);
    if (targetSizeMib < currentSizeMib) {
      throw new Error(
        `Requested disk size ${targetSizeMib} MiB is smaller than current image size ${currentSizeMib} MiB.`,
      );
    }
    if (targetSizeMib === currentSizeMib) {
      return;
    }

    process.run(["truncate", "-s", `${targetSizeMib}M`, ext4Path]);
    const fsck = process.runRoot(["e2fsck", "-f", "-y", ext4Path], { allowFailure: true });
    if (fsck.exitCode > 1) {
      throw new Error(`e2fsck failed while resizing ${ext4Path}: ${fsck.stderr || fsck.stdout}`);
    }
    process.runRoot(["resize2fs", ext4Path]);
  };

  return {
    cloneExt4Rootfs,
    growExt4DiskIfNeeded,
  };
};
