import { existsSync } from "node:fs";
import { DockerClient, type RootfsArtifact, type SshKeyPair } from "./docker.client";
import {
  DockerfileNotFoundError,
  DockerRootfsBuildFailedError,
  DockerSshKeyGenerationFailedError,
} from "./errors";

export class DockerService {
  constructor(private readonly client: DockerClient = new DockerClient()) {}

  ensureSshKeyPair(privateKeyPath: string): SshKeyPair {
    try {
      return this.client.ensureSshKeyPair(privateKeyPath);
    } catch (cause) {
      throw new DockerSshKeyGenerationFailedError({
        keyPath: privateKeyPath,
        cause,
      });
    }
  }

  ensureRootfs(params: {
    dockerfilePath: string;
    sshPublicKeyPath: string;
    sshUser: string;
  }): RootfsArtifact {
    if (!existsSync(params.dockerfilePath)) {
      throw new DockerfileNotFoundError({
        dockerfilePath: params.dockerfilePath,
      });
    }

    try {
      return this.client.ensureRootfsFromDocker(params);
    } catch (cause) {
      throw new DockerRootfsBuildFailedError({
        dockerfilePath: params.dockerfilePath,
        cause,
      });
    }
  }
}

export const dockerService = new DockerService();
export type { RootfsArtifact, SshKeyPair };
