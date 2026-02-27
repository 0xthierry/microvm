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

export class KernelLatestReleaseRequestFailedError extends AppError {
  constructor(params: { status?: number; cause?: unknown }) {
    const details: Record<string, unknown> = {};
    if (params.status !== undefined) {
      details["status"] = params.status;
    }

    super("Failed to resolve latest Firecracker release tag.", {
      cause: params.cause,
      details,
      hint: "Check network connectivity and retry.",
    });
  }
}

export class KernelLatestReleaseRedirectInvalidError extends AppError {
  constructor(params: { url: string }) {
    super("Unexpected latest release redirect URL format.", {
      details: {
        url: params.url,
      },
      hint: "Retry later or pin a known kernel artifact manually.",
    });
  }
}

export class KernelCandidateListRequestFailedError extends AppError {
  constructor(params: { prefix: string; status?: number; cause?: unknown }) {
    const details: Record<string, unknown> = {
      prefix: params.prefix,
    };
    if (params.status !== undefined) {
      details["status"] = params.status;
    }

    super("Failed to list kernel candidates from Firecracker artifacts.", {
      cause: params.cause,
      details,
      hint: "Check network connectivity and retry.",
    });
  }
}

export class KernelCandidatesNotFoundError extends AppError {
  constructor(params: { prefix: string }) {
    super("No kernel candidates were found for the resolved Firecracker channel.", {
      details: {
        prefix: params.prefix,
      },
      hint: "Retry later or provide a cached kernel artifact in .microvm/artifacts/kernel/vmlinux.",
    });
  }
}

export class KernelDownloadFailedError extends AppError {
  constructor(params: { url: string; status?: number; cause?: unknown }) {
    const details: Record<string, unknown> = {
      url: params.url,
    };
    if (params.status !== undefined) {
      details["status"] = params.status;
    }

    super("Failed to download kernel artifact.", {
      cause: params.cause,
      details,
      hint: "Check network access to GitHub/S3 and retry.",
    });
  }
}

export class KernelCacheWriteFailedError extends AppError {
  constructor(params: { path: string; cause?: unknown }) {
    super("Failed to write kernel artifact into local cache.", {
      cause: params.cause,
      details: {
        path: params.path,
      },
      hint: "Check filesystem permissions and available disk space.",
    });
  }
}
