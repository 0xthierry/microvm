import { AppError } from "../../lib/errors/app-error";

export class StatusInputValidationError extends AppError {
  constructor(message: string) {
    super(message, {
      hint: "Run `microvm help status` for usage.",
    });
  }
}
