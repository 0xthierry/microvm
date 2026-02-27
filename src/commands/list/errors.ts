import { AppError } from "../../lib/errors/app-error";

export class ListInputValidationError extends AppError {
  constructor(message: string) {
    super(message, {
      hint: "Run `microvm help list` for usage.",
    });
  }
}

export class ListRenderFailedError extends AppError {
  constructor(params: { cause?: unknown }) {
    super("Failed to render VM list.", {
      cause: params.cause,
    });
  }
}
