import { AppError } from "../../lib/errors/app-error";

export class HelpInputValidationError extends AppError {
  constructor(message: string) {
    super(message, {
      hint: "Run `microvm help help` for usage.",
    });
  }
}

export class HelpTopicNotFoundError extends AppError {
  constructor(topic: string) {
    super(`Unknown help topic: ${topic}`, {
      details: {
        topic,
      },
      hint: "Run `microvm help` to list available commands.",
    });
  }
}
