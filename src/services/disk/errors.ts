import { AppError } from "../../lib/errors/app-error";

export class DiskCloneFailedError extends AppError {
  constructor(params: {
    sourcePath: string;
    targetPath: string;
    cause?: unknown;
  }) {
    super(`Failed to clone rootfs ${params.sourcePath} -> ${params.targetPath}.`, {
      cause: params.cause,
      details: {
        sourcePath: params.sourcePath,
        targetPath: params.targetPath,
      },
    });
  }
}

export class DiskResizeFailedError extends AppError {
  constructor(params: {
    ext4Path: string;
    targetSizeMib: number;
    cause?: unknown;
  }) {
    super(`Failed to resize ext4 image: ${params.ext4Path}.`, {
      cause: params.cause,
      details: {
        ext4Path: params.ext4Path,
        targetSizeMib: params.targetSizeMib,
      },
    });
  }
}

export class DiskShrinkNotSupportedError extends AppError {
  constructor(params: {
    currentSizeMib: number;
    targetSizeMib: number;
  }) {
    super(`Requested disk size ${params.targetSizeMib} MiB is smaller than current image size ${params.currentSizeMib} MiB.`, {
      details: {
        currentSizeMib: params.currentSizeMib,
        targetSizeMib: params.targetSizeMib,
      },
      hint: "Disk shrinking is not supported. Choose a size >= current size.",
    });
  }
}
