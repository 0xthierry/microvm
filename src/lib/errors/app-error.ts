export class AppError extends Error {
  readonly hint: string | undefined;
  readonly details: Record<string, unknown> | undefined;
  override readonly cause: unknown;

  constructor(
    message: string,
    options: {
      hint?: string;
      details?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.hint = options.hint;
    this.details = options.details;
    this.cause = options.cause;
  }
}
