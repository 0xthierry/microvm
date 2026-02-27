import { AppError } from "../../lib/errors/app-error";

export class SetInputValidationError extends AppError {
  constructor(message: string) {
    super(message, {
      hint: "Run `microvm help set` for supported flags.",
    });
  }
}

export class SetNoChangesRequestedError extends AppError {
  constructor() {
    super("No changes requested. Pass at least one of --cpus, --memory-mib, --disk-gib/--disk-mib, --ssh-user.");
  }
}

export class SetDiskResizeWhileRunningError extends AppError {
  constructor(vmId: string) {
    super("Cannot resize VM disk while VM is running.", {
      details: {
        vmId,
      },
      hint: "Run `microvm down <id|name>` before resizing disk.",
    });
  }
}
