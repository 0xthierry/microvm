import { AppError } from "../../../lib/errors/app-error";

export class VmNotFoundError extends AppError {
  constructor(params: { vmRef: string }) {
    super(`VM not found: ${params.vmRef}`, {
      details: {
        vmRef: params.vmRef,
      },
      hint: "Run `microvm list` to see available VMs.",
    });
  }
}

export class VmReferenceAmbiguousError extends AppError {
  constructor(params: {
    vmRef: string;
    vmIds: string[];
  }) {
    super(`VM reference is ambiguous: ${params.vmRef}`, {
      details: {
        vmRef: params.vmRef,
        vmIds: params.vmIds,
      },
      hint: "Use the VM id instead of name to disambiguate.",
    });
  }
}

export class VmAlreadyExistsError extends AppError {
  constructor(params: {
    vmId: string;
  }) {
    super(`VM already exists: ${params.vmId}`, {
      details: {
        vmId: params.vmId,
      },
    });
  }
}

export class VmNameAlreadyExistsError extends AppError {
  constructor(params: {
    name: string;
    vmId: string;
  }) {
    super(`VM name already exists: ${params.name}`, {
      details: {
        name: params.name,
        vmId: params.vmId,
      },
      hint: "Use a unique VM name.",
    });
  }
}

export class VmRepositoryReadFailedError extends AppError {
  constructor(params: { cause?: unknown }) {
    super("Failed to read VM repository.", {
      cause: params.cause,
    });
  }
}

export class VmRepositoryWriteFailedError extends AppError {
  constructor(params: { cause?: unknown }) {
    super("Failed to persist VM repository.", {
      cause: params.cause,
    });
  }
}

export class VmRepositoryLockFailedError extends AppError {
  constructor(params: {
    lockPath: string;
    cause?: unknown;
  }) {
    super("Failed to acquire VM repository lock.", {
      cause: params.cause,
      details: {
        lockPath: params.lockPath,
      },
      hint: "Retry the command in a few seconds.",
    });
  }
}
