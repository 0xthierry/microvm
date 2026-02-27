import { AppError } from "../../lib/errors/app-error";

export class SshInputValidationError extends AppError {
  constructor(message: string) {
    super(message, {
      hint: "Run `microvm help ssh` for usage.",
    });
  }
}

export class SshVmNotRunningError extends AppError {
  constructor(vmId: string) {
    super(`VM "${vmId}" is not running.`, {
      details: {
        vmId,
      },
      hint: "Run `microvm up <id|name>` first.",
    });
  }
}
