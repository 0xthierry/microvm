import { AppError } from "../../lib/errors/app-error";

export class DoctorInputValidationError extends AppError {
  constructor(message: string) {
    super(message, {
      hint: "Run `microvm help doctor` for usage.",
    });
  }
}
