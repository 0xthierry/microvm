import { AppError } from "../../lib/errors/app-error";

export class DownInputValidationError extends AppError {
  constructor(message: string) {
    super(message, {
      hint: "Run `microvm help down` for usage.",
    });
  }
}

export class DownRollbackFailedError extends AppError {
  constructor(params: {
    vmId: string;
    cause?: unknown;
  }) {
    super("Down command failed and rollback was incomplete.", {
      cause: params.cause,
      details: {
        vmId: params.vmId,
      },
    });
  }
}
