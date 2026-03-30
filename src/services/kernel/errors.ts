import { AppError } from "../../lib/errors/app-error";

export class KernelUnsupportedHostArchError extends AppError {
  constructor(params: { hostArch: string }) {
    super(`Unsupported host architecture for kernel resolution: ${params.hostArch}`, {
      details: {
        hostArch: params.hostArch,
      },
      hint: "Use a supported host architecture (x64 or arm64).",
    });
  }
}

export class KernelArtifactMissingError extends AppError {
  constructor(params: { path: string }) {
    super("Required kernel artifact is missing.", {
      details: {
        path: params.path,
      },
      hint: "Run `microvm` from the project repo, or re-run the install script to copy kernel artifacts.",
    });
  }
}
