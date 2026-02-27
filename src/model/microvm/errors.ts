import { AppError } from "../../lib/errors/app-error";
import { VmStatus } from "./vm-status";

export class VmInvalidTransitionError extends AppError {
  constructor(params: {
    vmId: string;
    from: VmStatus;
    to: VmStatus;
    allowedFrom: VmStatus[];
  }) {
    super(`Invalid VM transition for ${params.vmId}: ${params.from} -> ${params.to}.`, {
      details: {
        vmId: params.vmId,
        from: params.from,
        to: params.to,
        allowedFrom: params.allowedFrom,
      },
      hint: "Check VM state with `microvm status <id|name>` before retrying.",
    });
  }
}
