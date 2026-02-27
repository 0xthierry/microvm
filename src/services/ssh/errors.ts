import { AppError } from "../../lib/errors/app-error";

export class SshWaitTimeoutError extends AppError {
  constructor(params: {
    target: string;
    timeoutMs: number;
  }) {
    super("Timed out waiting for SSH to become available.", {
      details: {
        target: params.target,
        timeoutMs: params.timeoutMs,
      },
      hint: "Check VM networking and sshd state.",
    });
  }
}

export class SshCommandFailedError extends AppError {
  constructor(params: {
    target: string;
    cause?: unknown;
  }) {
    super("Failed to execute SSH command.", {
      cause: params.cause,
      details: {
        target: params.target,
      },
    });
  }
}
