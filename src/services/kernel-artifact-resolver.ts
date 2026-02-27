import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { AppConfig } from "../config/app-config";

export type KernelArtifact = {
  releaseTag: string;
  ciVersion: string;
  arch: string;
  key: string;
  url: string;
  path: string;
  version: string;
};

export type KernelArtifactResolverService = {
  resolveLatestKernelArtifact: (arch: string) => Promise<KernelArtifact>;
  downloadIfMissing: (url: string, path: string) => Promise<void>;
};

export const createKernelArtifactResolverService = ({
  appConfig,
  logStep,
}: {
  appConfig: AppConfig;
  logStep: (message: string) => void;
}): KernelArtifactResolverService => {
  const artifactsDir = appConfig.paths.artifactsDir;
  const fetchLatestReleaseTag = async (): Promise<string> => {
    const response = await fetch("https://github.com/firecracker-microvm/firecracker/releases/latest", {
      redirect: "follow",
    });
    if (!response.ok) {
      throw new Error(`Failed to resolve latest Firecracker release: HTTP ${response.status}`);
    }

    const url = new URL(response.url);
    const tag = url.pathname.split("/").filter(Boolean).at(-1);
    if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) {
      throw new Error(`Unexpected latest release redirect URL: ${response.url}`);
    }
    return tag;
  };

  const releaseToCiVersion = (releaseTag: string): string => {
    const match = releaseTag.match(/^v(\d+)\.(\d+)\.\d+$/);
    if (!match) {
      throw new Error(`Unexpected release tag format: ${releaseTag}`);
    }
    return `v${match[1]}.${match[2]}`;
  };

  const listBucketKeys = async (prefix: string): Promise<string[]> => {
    const url = new URL("https://spec.ccfc.min.s3.amazonaws.com/");
    url.searchParams.set("prefix", prefix);
    url.searchParams.set("list-type", "2");

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Failed to list S3 prefix ${prefix}: HTTP ${response.status}`);
    }
    const xml = await response.text();
    return [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((match) => match[1]);
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

  const resolveLatestKernelArtifact = async (arch: string): Promise<KernelArtifact> => {
    const releaseTag = await fetchLatestReleaseTag();
    const ciVersion = releaseToCiVersion(releaseTag);
    const prefix = `firecracker-ci/${ciVersion}/${arch}/vmlinux-`;
    const keys = await listBucketKeys(prefix);

    const candidates = keys
      .map((key) => {
        const match = key.match(/vmlinux-(\d+\.\d+\.\d+)$/);
        if (!match) return null;
        return { key, version: match[1] };
      })
      .filter((item): item is { key: string; version: string } => item !== null)
      .sort((a, b) => compareDottedVersions(a.version, b.version));

    const latest = candidates.at(-1);
    if (!latest) {
      throw new Error(`No kernel key found for prefix: ${prefix}`);
    }

    return {
      releaseTag,
      ciVersion,
      arch,
      key: latest.key,
      url: `https://s3.amazonaws.com/spec.ccfc.min/${latest.key}`,
      path: resolve(join(artifactsDir, "kernel", latest.key.split("/").at(-1) ?? "vmlinux")),
      version: latest.version,
    };
  };

  const downloadIfMissing = async (url: string, path: string): Promise<void> => {
    if (existsSync(path)) {
      logStep(`reuse: ${path}`);
      return;
    }

    logStep(`download: ${url}`);
    mkdirSync(dirname(path), { recursive: true });
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Download failed (${response.status}) for ${url}`);
    }

    const tempPath = `${path}.tmp.${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const bytes = new Uint8Array(await response.arrayBuffer());
    writeFileSync(tempPath, bytes);
    if (existsSync(path)) {
      rmSync(tempPath, { force: true });
      logStep(`reuse: ${path}`);
      return;
    }
    renameSync(tempPath, path);
  };

  return {
    resolveLatestKernelArtifact,
    downloadIfMissing,
  };
};
