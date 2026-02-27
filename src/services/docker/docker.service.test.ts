import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createTestAppConfig } from "../../test/test-app-config";
import { DockerService } from "./docker.service";
import {
  DockerfileNotFoundError,
  DockerSshKeyGenerationFailedError,
} from "./errors";

describe("DockerService", () => {
  it("fails when dockerfile does not exist", () => {
    const service = new DockerService({
      ensureSshKeyPair: () => ({ privateKeyPath: "", publicKeyPath: "" }),
      ensureRootfsFromDocker: () => ({ source: "", ext4Path: "", buildHash: "" }),
    } as any);

    expect(() =>
      service.ensureRootfs({
        dockerfilePath: "/tmp/does-not-exist",
        sshPublicKeyPath: "/tmp/key.pub",
        sshUser: "root",
      })).toThrow(DockerfileNotFoundError);
  });

  it("maps ssh key generation errors", () => {
    const service = new DockerService({
      ensureSshKeyPair: () => {
        throw new Error("boom");
      },
      ensureRootfsFromDocker: () => ({ source: "", ext4Path: "", buildHash: "" }),
    } as any);

    expect(() => service.ensureSshKeyPair("/tmp/key")).toThrow(DockerSshKeyGenerationFailedError);
  });

  it("returns rootfs artifact when dockerfile exists", () => {
    const { config, cleanup } = createTestAppConfig();
    const dockerfilePath = join(config.paths.projectRoot, "examples", "archlinux", "Dockerfile");

    try {
      const service = new DockerService({
        ensureSshKeyPair: () => ({ privateKeyPath: "/tmp/key", publicKeyPath: "/tmp/key.pub" }),
        ensureRootfsFromDocker: () => ({ source: dockerfilePath, ext4Path: "/tmp/rootfs.ext4", buildHash: "abc" }),
      } as any);

      const artifact = service.ensureRootfs({
        dockerfilePath,
        sshPublicKeyPath: "/tmp/key.pub",
        sshUser: "root",
      });

      expect(artifact.buildHash).toBe("abc");
    } finally {
      cleanup();
    }
  });
});
