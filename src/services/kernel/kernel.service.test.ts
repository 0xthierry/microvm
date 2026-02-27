import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestAppConfig } from "../../test/test-app-config";
import { KernelService } from "./kernel.service";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("KernelService", () => {
  it("reuses cached kernel from artifacts directory", async () => {
    const { config, cleanup } = createTestAppConfig();

    try {
      const kernelDir = join(config.paths.artifactsDir, "kernel");
      const kernelPath = join(kernelDir, "vmlinux");
      const metaPath = join(kernelDir, "vmlinux.meta.json");

      mkdirSync(kernelDir, { recursive: true });
      writeFileSync(kernelPath, "cached-kernel");
      writeFileSync(metaPath, `${JSON.stringify({
        releaseTag: "v1.9.0",
        ciVersion: "v1.9",
        version: "6.1.12",
        sourceUrl: "https://example.invalid/vmlinux",
        downloadedAt: "2026-01-01T00:00:00.000Z",
      })}\n`, "utf8");

      const service = new KernelService();
      const artifact = await service.ensureKernelArtifact();

      expect(artifact.path).toBe(kernelPath);
      expect(artifact.releaseTag).toBe("v1.9.0");
      expect(artifact.ciVersion).toBe("v1.9");
      expect(artifact.version).toBe("6.1.12");
    } finally {
      cleanup();
    }
  });

  it("downloads and caches kernel when artifacts kernel is missing", async () => {
    const { config, cleanup } = createTestAppConfig();

    const hostArch = process.arch === "x64"
      ? "x86_64"
      : process.arch === "arm64"
        ? "aarch64"
        : undefined;

    if (!hostArch) {
      cleanup();
      return;
    }

    try {
      const listPrefix = `firecracker-ci/v1.9/${hostArch}/vmlinux-`;
      const listXml = `<ListBucketResult><Contents><Key>${listPrefix}6.1.12</Key></Contents></ListBucketResult>`;
      const kernelBytes = new Uint8Array([1, 2, 3, 4]);

      globalThis.fetch = (async (input: string | URL | Request): Promise<Response> => {
        const url = String(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);

        if (url.includes("github.com/firecracker-microvm/firecracker/releases/latest")) {
          return {
            ok: true,
            status: 200,
            url: "https://github.com/firecracker-microvm/firecracker/releases/tag/v1.9.0",
            text: async () => "",
            arrayBuffer: async () => new ArrayBuffer(0),
          } as Response;
        }

        if (url.startsWith("https://spec.ccfc.min.s3.amazonaws.com/")) {
          return {
            ok: true,
            status: 200,
            url,
            text: async () => listXml,
            arrayBuffer: async () => new ArrayBuffer(0),
          } as Response;
        }

        if (url === `https://s3.amazonaws.com/spec.ccfc.min/${listPrefix}6.1.12`) {
          return {
            ok: true,
            status: 200,
            url,
            text: async () => "",
            arrayBuffer: async () => kernelBytes.buffer,
          } as Response;
        }

        throw new Error(`Unexpected fetch URL in test: ${url}`);
      }) as typeof fetch;

      const service = new KernelService();
      const artifact = await service.ensureKernelArtifact();

      const kernelPath = join(config.paths.artifactsDir, "kernel", "vmlinux");
      const metaPath = join(config.paths.artifactsDir, "kernel", "vmlinux.meta.json");

      expect(artifact.path).toBe(kernelPath);
      expect(artifact.releaseTag).toBe("v1.9.0");
      expect(artifact.ciVersion).toBe("v1.9");
      expect(artifact.version).toBe("6.1.12");

      const cachedBytes = readFileSync(kernelPath);
      expect(cachedBytes.length).toBe(kernelBytes.length);
      expect(readFileSync(metaPath, "utf8")).toContain("\"releaseTag\": \"v1.9.0\"");
    } finally {
      cleanup();
    }
  });
});
