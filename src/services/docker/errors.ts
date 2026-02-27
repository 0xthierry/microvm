import { AppError } from "../../lib/errors/app-error";

export class DockerfileNotFoundError extends AppError {
  constructor(params: { dockerfilePath: string }) {
    super(`Dockerfile not found: ${params.dockerfilePath}`, {
      details: {
        dockerfilePath: params.dockerfilePath,
      },
      hint: "Provide a valid Dockerfile path with --dockerfile.",
    });
  }
}

export class DockerRootfsBuildFailedError extends AppError {
  constructor(params: {
    dockerfilePath: string;
    cause?: unknown;
  }) {
    const causeMessage = params.cause instanceof Error
      ? params.cause.message
      : undefined;
    super(
      causeMessage ? `Failed to build rootfs artifact: ${causeMessage}` : "Failed to build rootfs artifact.",
      {
      cause: params.cause,
      details: {
        dockerfilePath: params.dockerfilePath,
      },
    },
    );
  }
}

export class DockerSshKeyGenerationFailedError extends AppError {
  constructor(params: {
    keyPath: string;
    cause?: unknown;
  }) {
    super("Failed to generate SSH key pair.", {
      cause: params.cause,
      details: {
        keyPath: params.keyPath,
      },
    });
  }
}
