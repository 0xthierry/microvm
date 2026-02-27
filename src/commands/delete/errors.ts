import { AppError } from "../../lib/errors/app-error";

export class DeleteInputValidationError extends AppError {
  constructor(message: string) {
    super(message, {
      hint: "Run `microvm help delete` for usage.",
    });
  }
}

export class DeleteRollbackFailedError extends AppError {
  constructor(params: {
    vmId: string;
    cause?: unknown;
  }) {
    super("Delete command failed and rollback was incomplete.", {
      cause: params.cause,
      details: {
        vmId: params.vmId,
      },
    });
  }
}

export class DeleteUnsafePathError extends AppError {
  constructor(params: {
    vmId: string;
    pathRole: "vmDir" | "runtimeVmDir";
    expectedRoot: string;
    resolvedPath: string;
  }) {
    super("Refusing to delete VM assets outside configured runtime roots.", {
      details: {
        vmId: params.vmId,
        pathRole: params.pathRole,
        expectedRoot: params.expectedRoot,
        resolvedPath: params.resolvedPath,
      },
      hint: "Inspect VM metadata paths and fix repository data before retrying delete.",
    });
  }
}
