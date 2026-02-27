import { AppError } from "../../lib/errors/app-error";

export class JailerBinaryNotFoundError extends AppError {
  constructor(params: { binary: string; cause?: unknown }) {
    super(`Cannot resolve binary path for: ${params.binary}`, {
      cause: params.cause,
      details: {
        binary: params.binary,
      },
    });
  }
}

export class JailerLayoutPreparationFailedError extends AppError {
  constructor(params: {
    vmId: string;
    cause?: unknown;
  }) {
    super("Failed to prepare jailer layout.", {
      cause: params.cause,
      details: {
        vmId: params.vmId,
      },
    });
  }
}

export class JailerLaunchFailedError extends AppError {
  constructor(params: {
    vmId: string;
    cause?: unknown;
  }) {
    super("Failed to launch jailed Firecracker process.", {
      cause: params.cause,
      details: {
        vmId: params.vmId,
      },
    });
  }
}

export class JailerCleanupFailedError extends AppError {
  constructor(params: {
    vmId: string;
    cause?: unknown;
  }) {
    super("Failed to cleanup jailer runtime directory.", {
      cause: params.cause,
      details: {
        vmId: params.vmId,
      },
    });
  }
}

export class JailerStopFailedError extends AppError {
  constructor(params: {
    vmId: string;
    pid: number;
    cause?: unknown;
  }) {
    super("Failed to stop jailed Firecracker process safely.", {
      cause: params.cause,
      details: {
        vmId: params.vmId,
        pid: params.pid,
      },
      hint: "Inspect the VM runtime PID and jailer process state before retrying.",
    });
  }
}

export class JailerProfileResolveFailedError extends AppError {
  constructor(params: {
    cause?: unknown;
  }) {
    super("Failed to resolve jailer cgroup/resource profile.", {
      cause: params.cause,
    });
  }
}
