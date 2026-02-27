import { AppError } from "../../lib/errors/app-error";

export class CreateInputValidationError extends AppError {
  constructor(message: string) {
    super(message, {
      hint: "Run `microvm help create` for supported flags.",
    });
  }
}

export class CreateRollbackFailedError extends AppError {
  constructor(params: {
    vmId: string;
    cause?: unknown;
  }) {
    super("Create command failed and rollback was incomplete.", {
      cause: params.cause,
      details: {
        vmId: params.vmId,
      },
    });
  }
}
