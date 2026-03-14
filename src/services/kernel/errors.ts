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
    super("Required repo-local kernel artifact is missing.", {
      details: {
        path: params.path,
      },
      hint: "Build the repo-local kernel first with `bun run kernel:build`.",
    });
  }
}
