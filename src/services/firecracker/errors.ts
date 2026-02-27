import { AppError } from "../../lib/errors/app-error";

export class FirecrackerConnectionFailedError extends AppError {
  constructor(params: {
    socketPath: string;
    cause?: unknown;
  }) {
    super("Failed to connect to Firecracker socket.", {
      cause: params.cause,
      details: {
        socketPath: params.socketPath,
      },
      hint: "Check if the VM runtime and socket path are available.",
    });
  }
}

export class FirecrackerConfigurationFailedError extends AppError {
  constructor(params: {
    vmId: string;
    cause?: unknown;
  }) {
    super("Failed to configure Firecracker VM.", {
      cause: params.cause,
      details: {
        vmId: params.vmId,
      },
      hint: "Check kernel, rootfs, and machine configuration.",
    });
  }
}

export class FirecrackerStartFailedError extends AppError {
  constructor(params: {
    vmId: string;
    cause?: unknown;
  }) {
    super("Failed to start VM in Firecracker.", {
      cause: params.cause,
      details: {
        vmId: params.vmId,
      },
      hint: "Check Firecracker logs for startup failure details.",
    });
  }
}
