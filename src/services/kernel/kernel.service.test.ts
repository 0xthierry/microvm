import { describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestAppConfig } from "../../test/test-app-config";
import { KernelService } from "./kernel.service";

describe("KernelService", () => {
  it("uses the repo-local kernel build", async () => {
    const { cleanup, rootDir } = createTestAppConfig();

    const hostArch =
      process.arch === "x64" ? "x86_64" : process.arch === "arm64" ? "aarch64" : undefined;

    if (!hostArch) {
      cleanup();
      return;
    }

    try {
      const kernelDir = join(rootDir, "kernel", "dist", hostArch);
      const kernelPath = join(kernelDir, "vmlinux");
      const metaPath = join(kernelDir, "vmlinux.meta.json");

      mkdirSync(kernelDir, { recursive: true });
      writeFileSync(kernelPath, "repo-local-kernel");
      writeFileSync(
        metaPath,
        `${JSON.stringify({
          releaseTag: "microvm-kernel-6.1.164-23.303.amzn2023",
          ciVersion: "custom-6.1",
          version: "6.1.164",
          sourceUrl:
            "https://github.com/amazonlinux/linux/tree/microvm-kernel-6.1.164-23.303.amzn2023",
          downloadedAt: "2026-03-13T00:00:00.000Z",
        })}\n`,
        "utf8",
      );

      const service = new KernelService();
      const artifact = await service.ensureKernelArtifact();

      expect(artifact.path).toBe(kernelPath);
      expect(artifact.releaseTag).toBe("microvm-kernel-6.1.164-23.303.amzn2023");
      expect(artifact.ciVersion).toBe("custom-6.1");
      expect(artifact.version).toBe("6.1.164");
    } finally {
      cleanup();
    }
  });

  it("fails when the repo-local kernel build is missing", async () => {
    const { cleanup } = createTestAppConfig();
    const hostArch =
      process.arch === "x64" ? "x86_64" : process.arch === "arm64" ? "aarch64" : undefined;

    if (!hostArch) {
      cleanup();
      return;
    }

    try {
      const service = new KernelService();
      await expect(service.ensureKernelArtifact()).rejects.toThrow(
        "Required repo-local kernel artifact is missing.",
      );
    } finally {
      cleanup();
    }
  });
});
