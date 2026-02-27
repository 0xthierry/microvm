import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAppConfig } from "../../config/runtime-context";
import {
  KernelCacheWriteFailedError,
  KernelCandidateListRequestFailedError,
  KernelCandidatesNotFoundError,
  KernelDownloadFailedError,
  KernelLatestReleaseRedirectInvalidError,
  KernelLatestReleaseRequestFailedError,
  KernelUnsupportedHostArchError,
} from "./errors";

type KernelCandidate = {
  key: string;
  version: string;
};

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

const buildMirrorS3Url = (url: string): string | undefined => {
  const legacyPrefix = "https://s3.amazonaws.com/spec.ccfc.min/";
  const virtualHostedPrefix = "https://spec.ccfc.min.s3.amazonaws.com/";
  if (url.startsWith(legacyPrefix)) {
    return `${virtualHostedPrefix}${url.slice(legacyPrefix.length)}`;
  }
  if (url.startsWith(virtualHostedPrefix)) {
    return `${legacyPrefix}${url.slice(virtualHostedPrefix.length)}`;
  }
  return undefined;
};

const compareDottedVersions = (a: string, b: string): number => {
  const aParts = a.split(".").map((part) => Number(part));
  const bParts = b.split(".").map((part) => Number(part));
  const length = Math.max(aParts.length, bParts.length);
  for (let index = 0; index < length; index += 1) {
    const left = aParts[index] ?? 0;
    const right = bParts[index] ?? 0;
    if (left !== right) return left - right;
  }
  return 0;
};

const mapHostArchToFirecrackerArch = (hostArch: string): string => {
  if (hostArch === "x64") return "x86_64";
  if (hostArch === "arm64") return "aarch64";
  throw new KernelUnsupportedHostArchError({
    hostArch,
  });
};

const parseCiVersion = (releaseTag: string): string => {
  const match = releaseTag.match(/^v(\d+)\.(\d+)\.\d+$/);
  if (!match) {
    throw new KernelLatestReleaseRedirectInvalidError({
      url: `tag/${releaseTag}`,
    });
  }
  return `v${match[1]}.${match[2]}`;
};

const selectLatestKernelCandidate = (keys: string[], prefix: string): KernelCandidate => {
  const candidates = keys
    .map((key) => {
      const match = key.match(/vmlinux-(\d+\.\d+\.\d+)$/);
      if (!match) return null;
      return {
        key,
        version: match[1],
      };
    })
    .filter((candidate): candidate is KernelCandidate => candidate !== null)
    .sort((a, b) => compareDottedVersions(a.version, b.version));

  const latest = candidates.at(-1);
  if (!latest) {
    throw new KernelCandidatesNotFoundError({
      prefix,
    });
  }
  return latest;
};

export class KernelService {
  async ensureKernelArtifact(): Promise<KernelArtifact> {
    const config = getAppConfig();
    const kernelDir = join(config.paths.artifactsDir, "kernel");
    const kernelPath = join(kernelDir, "vmlinux");
    const metaPath = join(kernelDir, "vmlinux.meta.json");

    if (existsSync(kernelPath)) {
      const metadata = this.readMetadata(metaPath);
      return {
        path: kernelPath,
        releaseTag: metadata?.releaseTag ?? "local",
        ciVersion: metadata?.ciVersion ?? "local",
        version: metadata?.version ?? "local",
      };
    }

    const arch = mapHostArchToFirecrackerArch(process.arch);
    const releaseTag = await this.fetchLatestReleaseTag();
    const ciVersion = parseCiVersion(releaseTag);
    const prefix = `firecracker-ci/${ciVersion}/${arch}/vmlinux-`;
    const keys = await this.listKernelKeys(prefix);
    const latest = selectLatestKernelCandidate(keys, prefix);
    const sourceUrl = `https://s3.amazonaws.com/spec.ccfc.min/${latest.key}`;
    const kernelBytes = await this.downloadKernelBytes(sourceUrl);

    try {
      mkdirSync(kernelDir, { recursive: true });
      const tempPath = `${kernelPath}.tmp.${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
      await Bun.write(tempPath, kernelBytes);
      if (existsSync(kernelPath)) {
        rmSync(tempPath, { force: true });
      } else {
        renameSync(tempPath, kernelPath);
      }
    } catch (cause) {
      throw new KernelCacheWriteFailedError({
        path: kernelPath,
        cause,
      });
    }

    try {
      const metadata: KernelMetadata = {
        releaseTag,
        ciVersion,
        version: latest.version,
        sourceUrl,
        downloadedAt: new Date().toISOString(),
      };
      writeFileSync(metaPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    } catch {
      // Non-critical: runtime can proceed with the cached kernel binary.
    }

    return {
      path: kernelPath,
      releaseTag,
      ciVersion,
      version: latest.version,
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
        typeof parsed.releaseTag !== "string"
        || typeof parsed.ciVersion !== "string"
        || typeof parsed.version !== "string"
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

  private async fetchLatestReleaseTag(): Promise<string> {
    let response: Response;
    try {
      response = await fetch("https://github.com/firecracker-microvm/firecracker/releases/latest", {
        redirect: "follow",
      });
    } catch (cause) {
      throw new KernelLatestReleaseRequestFailedError({
        cause,
      });
    }

    if (!response.ok) {
      throw new KernelLatestReleaseRequestFailedError({
        status: response.status,
      });
    }

    const tag = new URL(response.url).pathname.split("/").filter(Boolean).at(-1);
    if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) {
      throw new KernelLatestReleaseRedirectInvalidError({
        url: response.url,
      });
    }

    return tag;
  }

  private async listKernelKeys(prefix: string): Promise<string[]> {
    const url = new URL("https://spec.ccfc.min.s3.amazonaws.com/");
    url.searchParams.set("prefix", prefix);
    url.searchParams.set("list-type", "2");

    let response: Response;
    try {
      response = await fetch(url.toString());
    } catch (cause) {
      throw new KernelCandidateListRequestFailedError({
        prefix,
        cause,
      });
    }

    if (!response.ok) {
      throw new KernelCandidateListRequestFailedError({
        prefix,
        status: response.status,
      });
    }

    const xml = await response.text();
    return [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)]
      .map((match) => match[1])
      .filter((key): key is string => typeof key === "string");
  }

  private async downloadKernelBytes(url: string): Promise<Uint8Array> {
    const mirror = buildMirrorS3Url(url);
    const urls = mirror && mirror !== url ? [url, mirror] : [url];

    let lastError: KernelDownloadFailedError | undefined;
    for (const candidateUrl of urls) {
      try {
        const response = await fetch(candidateUrl);
        if (!response.ok) {
          lastError = new KernelDownloadFailedError({
            url: candidateUrl,
            status: response.status,
          });
          continue;
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length === 0) {
          lastError = new KernelDownloadFailedError({
            url: candidateUrl,
            cause: new Error("Downloaded kernel artifact is empty."),
          });
          continue;
        }
        return bytes;
      } catch (cause) {
        lastError = new KernelDownloadFailedError({
          url: candidateUrl,
          cause,
        });
      }
    }

    throw lastError ?? new KernelDownloadFailedError({
      url,
    });
  }
}

export const kernelService = new KernelService();
