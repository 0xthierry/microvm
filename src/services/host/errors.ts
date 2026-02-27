import { AppError } from "../../lib/errors/app-error";

export class HostDependencyMissingError extends AppError {
  constructor(params: { binary: string }) {
    super(`Missing dependency: ${params.binary}`, {
      details: {
        binary: params.binary,
      },
      hint: `Install "${params.binary}" and retry.`,
    });
  }
}

export class HostKvmAccessDeniedError extends AppError {
  constructor() {
    super("Current user cannot read/write /dev/kvm.", {
      hint: "Run with a user that has KVM access or adjust host permissions.",
    });
  }
}

export class HostPrerequisiteCheckFailedError extends AppError {
  constructor(params: {
    message: string;
    cause?: unknown;
  }) {
    super(params.message, {
      cause: params.cause,
    });
  }
}
