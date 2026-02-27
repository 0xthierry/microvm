import { AppError } from "../../lib/errors/app-error";

export class DoctorCheckFailedError extends AppError {
  constructor(params: {
    message: string;
    cause?: unknown;
  }) {
    super(params.message, {
      cause: params.cause,
    });
  }
}
