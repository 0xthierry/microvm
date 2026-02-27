import { AppError } from "../../../lib/errors/app-error";

export class VmEventLogWriteFailedError extends AppError {
  constructor(params: {
    vmId: string;
    cause?: unknown;
  }) {
    super(`Failed to append VM event log for ${params.vmId}.`, {
      cause: params.cause,
      details: {
        vmId: params.vmId,
      },
    });
  }
}

export class VmEventLogReadFailedError extends AppError {
  constructor(params: {
    vmId: string;
    cause?: unknown;
  }) {
    super(`Failed to read VM event log for ${params.vmId}.`, {
      cause: params.cause,
      details: {
        vmId: params.vmId,
      },
    });
  }
}

export class VmEventLogDeleteFailedError extends AppError {
  constructor(params: {
    vmId: string;
    cause?: unknown;
  }) {
    super(`Failed to delete VM event log for ${params.vmId}.`, {
      cause: params.cause,
      details: {
        vmId: params.vmId,
      },
    });
  }
}
