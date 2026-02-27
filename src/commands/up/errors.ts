import { AppError } from "../../lib/errors/app-error";

export class UpInputValidationError extends AppError {
  constructor(message: string) {
    super(message, {
      hint: "Run `microvm help up` for supported flags.",
    });
  }
}

export class UpRollbackFailedError extends AppError {
  constructor(params: {
    vmId: string;
    cause?: unknown;
  }) {
    super("Up command failed and rollback was incomplete.", {
      cause: params.cause,
      details: {
        vmId: params.vmId,
      },
    });
  }
}
