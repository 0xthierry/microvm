import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

import type { AppConfig } from "../config/app-config";
import type { ProcessService } from "./process";

export type RootfsArtifact = {
  source: string;
  ext4Path: string;
  buildHash: string;
};

export type SshKeyPair = {
  privateKeyPath: string;
  publicKeyPath: string;
};

type RootfsBuildMeta = {
  formatVersion: number;
  dockerfilePath: string;
  dockerfileSha256: string;
  sshPubKeySha256: string;
  sshUser: string;
  source: string;
  builtAt: string;
};

const rootfsBuildMetaSchema = z.object({
  formatVersion: z.number().int().nonnegative(),
  dockerfilePath: z.string().min(1),
  dockerfileSha256: z.string().min(1),
  sshPubKeySha256: z.string().min(1),
  sshUser: z.string().min(1),
  source: z.string().min(1),
  builtAt: z.string().min(1),
});

export type RootfsProvisionerService = {
  ensureSshKeyPair: (privateKeyPath: string) => SshKeyPair;
  ensureRootfsFromDocker: (params: {
    dockerfilePath: string;
    sshPublicKeyPath: string;
    sshUser: string;
  }) => Promise<RootfsArtifact>;
};

export const createRootfsProvisionerService = ({
  process,
  appConfig,
  logStep,
}: {
  process: ProcessService;
  appConfig: AppConfig;
  logStep: (message: string) => void;
}): RootfsProvisionerService => {
  const rootfsBuildFormatVersion = appConfig.defaults.runtime.rootfsBuildFormatVersion;
  const rootfsTmpDir = appConfig.paths.rootfsTmpDir;
  const artifactsDir = appConfig.paths.artifactsDir;

  const ensureDirs = (paths: string[]): void => {
    paths.forEach((path) => mkdirSync(path, { recursive: true }));
  };

  const deleteFileIfExists = (path: string): void => {
    if (!existsSync(path)) return;
    rmSync(path, { force: true, recursive: false });
  };

  const writeJson = (path: string, data: unknown): void => {
    mkdirSync(dirname(path), { recursive: true });
    const tempPath = `${path}.tmp.${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`);
    renameSync(tempPath, path);
  };

  const sha256OfFile = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

  const loadPasswdUsers = (treePath: string): Record<string, { uid: string; gid: string; home: string }> => {
    const passwdPath = join(treePath, "etc", "passwd");
    const passwd = readFileSync(passwdPath, "utf8");
    return passwd
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .reduce<Record<string, { uid: string; gid: string; home: string }>>((acc, line) => {
        const [username, _password, uid, gid, _gecos, home] = line.split(":");
        if (username && uid && gid && home) {
          acc[username] = { uid, gid, home };
        }
        return acc;
      }, {});
  };

  const resolveRootfsPath = (treePath: string, rootfsPath: string): string => {
    const root = resolve(treePath);
    let current = join(root, rootfsPath.replace(/^\/+/, ""));

    for (let hop = 0; hop < 40; hop += 1) {
      const currentResolved = resolve(current);
      if (!(currentResolved === root || currentResolved.startsWith(`${root}/`))) {
        throw new Error(`Resolved rootfs path escapes root tree: ${currentResolved}`);
      }

      const entry = lstatSync(currentResolved);
      if (!entry.isSymbolicLink()) {
        return currentResolved;
      }

      const linkTarget = readlinkSync(currentResolved);
      current = linkTarget.startsWith("/")
        ? join(root, linkTarget.replace(/^\/+/, ""))
        : resolve(dirname(currentResolved), linkTarget);
    }

    throw new Error(`Too many symbolic links while resolving rootfs path: ${rootfsPath}`);
  };

  const hasExecutableInRootfs = (treePath: string, rootfsPath: string): boolean => {
    try {
      const resolvedPath = resolveRootfsPath(treePath, rootfsPath);
      return (statSync(resolvedPath).mode & 0o111) !== 0;
    } catch {
      return false;
    }
  };

  const assertExecutableInRootfs = (treePath: string, rootfsPath: string, message: string): void => {
    if (hasExecutableInRootfs(treePath, rootfsPath)) {
      return;
    }
    throw new Error(`${message}: ${join(treePath, rootfsPath.replace(/^\/+/, ""))}`);
  };

  const assertPasswdUserExists = (treePath: string, username: string): void => {
    const passwdPath = join(treePath, "etc", "passwd");
    const passwd = readFileSync(passwdPath, "utf8");
    const found = passwd
      .split("\n")
      .some((line) => line.startsWith(`${username}:`));
    if (found) {
      return;
    }
    throw new Error(`Rootfs is missing expected user "${username}" in ${passwdPath}`);
  };

  const injectAuthorizedKeyAtHome = (homePath: string, sshPublicKeyPath: string, ownership: string): void => {
    const sshDir = join(homePath, ".ssh");
    const authKeys = join(sshDir, "authorized_keys");

    process.runRoot(["install", "-d", "-m", "700", sshDir]);
    process.runRoot(["cp", sshPublicKeyPath, authKeys]);
    process.runRoot(["chmod", "600", authKeys]);
    process.runRoot(["chown", "-R", ownership, sshDir]);
  };

  const injectAuthorizedKeys = (treePath: string, sshPublicKeyPath: string, sshUser: string): void => {
    const passwdUsers = loadPasswdUsers(treePath);
    for (const user of new Set(["root", sshUser])) {
      const record = passwdUsers[user];
      if (!record) {
        throw new Error(`Rootfs is missing expected user "${user}" in /etc/passwd`);
      }
      const homePath = join(treePath, record.home.replace(/^\/+/, ""));
      injectAuthorizedKeyAtHome(homePath, sshPublicKeyPath, `${record.uid}:${record.gid}`);
    }
  };

  const validateRootfsForBoot = (treePath: string, sshUser: string): void => {
    assertExecutableInRootfs(treePath, "/sbin/init", "Rootfs is missing /sbin/init");

    const sshdCandidates = ["/usr/bin/sshd", "/usr/sbin/sshd"];
    const hasSshd = sshdCandidates.some((candidate) => hasExecutableInRootfs(treePath, candidate));
    if (!hasSshd) {
      throw new Error("Rootfs is missing sshd binary (expected /usr/bin/sshd or /usr/sbin/sshd).");
    }

    assertPasswdUserExists(treePath, "root");
    assertPasswdUserExists(treePath, sshUser);
  };

  const writeDeterministicResolvConf = (treePath: string): void => {
    const resolvPath = join(treePath, "etc", "resolv.conf");
    const content = "nameserver 1.1.1.1\\nnameserver 8.8.8.8\\n";
    process.runRoot(["bash", "-lc", `cat > ${process.shellQuote(resolvPath)} <<'EOF'\\n${content}EOF`]);
  };

  const recommendedRootfsSizeMiB = (treePath: string): number => {
    const usage = process.runRoot(["du", "-sm", treePath]);
    const used = Number((usage.stdout.split(/\s+/).at(0) ?? "0").trim());
    if (!Number.isFinite(used) || used <= 0) {
      return 1024;
    }
    return Math.max(1024, used + 256);
  };

  const ensureSshKeyPair = (privateKeyPath: string): SshKeyPair => {
    const publicKeyPath = `${privateKeyPath}.pub`;
    ensureDirs([dirname(privateKeyPath)]);

    if (existsSync(privateKeyPath) && existsSync(publicKeyPath)) {
      logStep(`reuse: ${privateKeyPath}`);
      return { privateKeyPath, publicKeyPath };
    }

    deleteFileIfExists(privateKeyPath);
    deleteFileIfExists(publicKeyPath);

    logStep(`generate ssh key: ${privateKeyPath}`);
    process.run(["ssh-keygen", "-t", "ed25519", "-N", "", "-f", privateKeyPath, "-C", "microvm-access"], {
      allowFailure: false,
    });
    chmodSync(privateKeyPath, 0o600);
    chmodSync(publicKeyPath, 0o644);

    return { privateKeyPath, publicKeyPath };
  };

  const ensureRootfsFromDocker = async ({
    dockerfilePath,
    sshPublicKeyPath,
    sshUser,
  }: {
    dockerfilePath: string;
    sshPublicKeyPath: string;
    sshUser: string;
  }): Promise<RootfsArtifact> => {
    if (!existsSync(dockerfilePath)) {
      throw new Error(`Missing Dockerfile for rootfs build: ${dockerfilePath}`);
    }

    const dockerfileSha = sha256OfFile(dockerfilePath);
    const sshPubKeySha = sha256OfFile(sshPublicKeyPath);
    const buildHash = `${dockerfileSha}:${sshPubKeySha}:${sshUser}`;
    const cacheKey = createHash("sha256")
      .update(`${rootfsBuildFormatVersion}:${dockerfilePath}:${buildHash}`)
      .digest("hex")
      .slice(0, 20);
    const source = `dockerfile:${dockerfilePath}`;
    const ext4Path = resolve(artifactsDir, "rootfs", `${cacheKey}.ext4`);
    const metaPath = resolve(artifactsDir, "rootfs", `${cacheKey}.meta.json`);
    const contextPath = dirname(dockerfilePath);

    if (existsSync(ext4Path) && existsSync(metaPath)) {
      try {
        const parsed = rootfsBuildMetaSchema.safeParse(JSON.parse(readFileSync(metaPath, "utf8")));
        if (parsed.success) {
          const meta: RootfsBuildMeta = parsed.data;
          if (
            meta.formatVersion === rootfsBuildFormatVersion &&
            meta.dockerfilePath === dockerfilePath &&
            meta.dockerfileSha256 === dockerfileSha &&
            meta.sshPubKeySha256 === sshPubKeySha &&
            meta.sshUser === sshUser
          ) {
            logStep(`reuse: ${ext4Path}`);
            return {
              source,
              ext4Path,
              buildHash,
            };
          }
        }
      } catch {
        // Ignore invalid metadata and rebuild artifact.
      }
    }

    const imageTag = `microvm-rootfs:${cacheKey}`;
    const buildId = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const tempDir = join(rootfsTmpDir, `rootfs-build-${buildId}`);
    const tarPath = join(tempDir, "rootfs.tar");
    const treePath = join(tempDir, "rootfs-tree");

    ensureDirs([rootfsTmpDir, tempDir, dirname(ext4Path)]);
    process.runRoot(["mkdir", "-p", treePath]);

    logStep(`building docker image: ${imageTag} from ${dockerfilePath}`);
    process.run(["docker", "build", "-f", dockerfilePath, "-t", imageTag, contextPath], { inherit: true });

    const containerId = process.run(["docker", "create", imageTag]).stdout.trim();
    if (!containerId) {
      throw new Error("Failed to create docker container for rootfs export.");
    }

    try {
      logStep("exporting docker rootfs...");
      process.run(["docker", "export", "-o", tarPath, containerId]);
      process.runRoot(["tar", "-xpf", tarPath, "-C", treePath]);

      process.runRoot(["rm", "-f", join(treePath, ".dockerenv")], { allowFailure: true });
      writeDeterministicResolvConf(treePath);
      validateRootfsForBoot(treePath, sshUser);
      injectAuthorizedKeys(treePath, sshPublicKeyPath, sshUser);

      const sizeMib = recommendedRootfsSizeMiB(treePath);
      const ext4TempPath = `${ext4Path}.tmp.${buildId}`;

      deleteFileIfExists(ext4TempPath);
      process.run(["truncate", "-s", `${sizeMib}M`, ext4TempPath]);
      logStep(`creating ext4 rootfs (${sizeMib} MiB): ${ext4Path}`);
      process.runRoot(["mkfs.ext4", "-F", "-d", treePath, ext4TempPath]);

      if (existsSync(ext4Path)) {
        deleteFileIfExists(ext4TempPath);
        logStep(`reuse: ${ext4Path}`);
      } else {
        renameSync(ext4TempPath, ext4Path);
        chmodSync(ext4Path, 0o644);
      }

      const meta: RootfsBuildMeta = {
        formatVersion: rootfsBuildFormatVersion,
        dockerfilePath,
        dockerfileSha256: dockerfileSha,
        sshPubKeySha256: sshPubKeySha,
        sshUser,
        source,
        builtAt: new Date().toISOString(),
      };
      writeJson(metaPath, meta);
    } finally {
      process.run(["docker", "rm", "-f", containerId], { allowFailure: true });
      process.runRoot(["rm", "-rf", tempDir], { allowFailure: true });
    }

    return {
      source,
      ext4Path,
      buildHash,
    };
  };

  return {
    ensureSshKeyPair,
    ensureRootfsFromDocker,
  };
};
