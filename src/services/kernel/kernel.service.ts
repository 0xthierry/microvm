import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAppConfig } from "../../config/runtime-context";
import { KernelArtifactMissingError, KernelUnsupportedHostArchError } from "./errors";

type KernelMetadata = {
  releaseTag: string;
  ciVersion: string;
  version: string;
  sourceUrl: string;
  downloadedAt: string;
};

export type KernelArtifact = {
  path: string;
  releaseTag: string;
  ciVersion: string;
  version: string;
};

const mapHostArchToFirecrackerArch = (hostArch: string): string => {
  if (hostArch === "x64") return "x86_64";
  if (hostArch === "arm64") return "aarch64";
  throw new KernelUnsupportedHostArchError({
    hostArch,
  });
};

export class KernelService {
  async ensureKernelArtifact(): Promise<KernelArtifact> {
    const config = getAppConfig();
    return this.readProjectKernelArtifact(config.paths.projectRoot);
  }

  private readProjectKernelArtifact(projectRoot: string): KernelArtifact {
    const arch = mapHostArchToFirecrackerArch(process.arch);
    const kernelDir = join(projectRoot, "kernel", "dist", arch);
    const kernelPath = join(kernelDir, "vmlinux");
    const metaPath = join(kernelDir, "vmlinux.meta.json");

    if (!existsSync(kernelPath)) {
      throw new KernelArtifactMissingError({
        path: kernelPath,
      });
    }

    const metadata = this.readMetadata(metaPath);
    return {
      path: kernelPath,
      releaseTag: metadata?.releaseTag ?? "local",
      ciVersion: metadata?.ciVersion ?? "local",
      version: metadata?.version ?? "local",
    };
  }

  private readMetadata(metaPath: string): KernelMetadata | undefined {
    if (!existsSync(metaPath)) {
      return undefined;
    }
    try {
      const raw = readFileSync(metaPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<KernelMetadata>;
      if (
        typeof parsed.releaseTag !== "string" ||
        typeof parsed.ciVersion !== "string" ||
        typeof parsed.version !== "string"
      ) {
        return undefined;
      }
      return {
        releaseTag: parsed.releaseTag,
        ciVersion: parsed.ciVersion,
        version: parsed.version,
        sourceUrl: typeof parsed.sourceUrl === "string" ? parsed.sourceUrl : "",
        downloadedAt: typeof parsed.downloadedAt === "string" ? parsed.downloadedAt : "",
      };
    } catch {
      return undefined;
    }
  }
}

export const kernelService = new KernelService();
