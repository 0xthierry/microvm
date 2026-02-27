import { chmodSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { processRunner } from "../../lib/process/process-runner";

export class DiskClient {
  cloneExt4Rootfs(sourcePath: string, targetPath: string): void {
    mkdirSync(dirname(targetPath), { recursive: true });

    const reflinkCopy = processRunner.run(
      ["cp", "--reflink=auto", sourcePath, targetPath],
      { allowFailure: true },
    );

    if (reflinkCopy.exitCode !== 0) {
      processRunner.run(["cp", "-f", sourcePath, targetPath]);
    }

    chmodSync(targetPath, 0o644);
  }

  growExt4DiskIfNeeded(ext4Path: string, targetSizeMib: number): void {
    const currentSizeMib = Math.floor(statSync(ext4Path).size / (1024 * 1024));
    if (targetSizeMib <= currentSizeMib) {
      return;
    }

    processRunner.run(["truncate", "-s", `${targetSizeMib}M`, ext4Path]);

    const fsck = processRunner.run(["e2fsck", "-f", "-y", ext4Path], {
      allowFailure: true,
    });
    if (fsck.exitCode > 1) {
      throw new Error(fsck.stderr || fsck.stdout || "e2fsck failed");
    }

    processRunner.run(["resize2fs", ext4Path]);
  }

  exists(path: string): boolean {
    return existsSync(path);
  }

  diskSizeMib(path: string): number {
    return Math.floor(statSync(path).size / (1024 * 1024));
  }
}
