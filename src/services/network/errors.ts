import { AppError } from "../../lib/errors/app-error";

export class NetworkDefaultInterfaceNotFoundError extends AppError {
  constructor() {
    super("Cannot determine default host interface from `ip route`.");
  }
}

export class NetworkSetupFailedError extends AppError {
  constructor(params: {
    vmId: string;
    cause?: unknown;
  }) {
    super("Failed to setup host networking for VM.", {
      cause: params.cause,
      details: {
        vmId: params.vmId,
      },
    });
  }
}

export class NetworkTeardownFailedError extends AppError {
  constructor(params: {
    vmId: string;
    cause?: unknown;
  }) {
    super("Failed to teardown host networking for VM.", {
      cause: params.cause,
      details: {
        vmId: params.vmId,
      },
    });
  }
}
