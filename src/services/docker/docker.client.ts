import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getAppConfig } from "../../config/runtime-context";
import { processRunner } from "../../lib/process/process-runner";

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

export class DockerClient {
  private readonly artifactsDir: string;
  private readonly rootfsTmpDir: string;
  private readonly rootfsBuildFormatVersion: number;
  private readonly runner: typeof processRunner;

  constructor(params: {
    runner?: typeof processRunner;
    config?: ReturnType<typeof getAppConfig>;
  } = {}) {
    const config = params.config ?? getAppConfig();
    this.runner = params.runner ?? processRunner;
    this.artifactsDir = config.paths.artifactsDir;
    this.rootfsTmpDir = config.paths.rootfsTmpDir;
    this.rootfsBuildFormatVersion = config.defaults.runtime.rootfsBuildFormatVersion;
  }

  ensureSshKeyPair(privateKeyPath: string): SshKeyPair {
    const publicKeyPath = `${privateKeyPath}.pub`;
    mkdirSync(dirname(privateKeyPath), { recursive: true });

    if (!existsSync(privateKeyPath) || !existsSync(publicKeyPath)) {
      this.runner.run([
        "ssh-keygen",
        "-t",
        "ed25519",
        "-N",
        "",
        "-f",
        privateKeyPath,
      ]);
      chmodSync(privateKeyPath, 0o600);
      chmodSync(publicKeyPath, 0o644);
    }

    return {
      privateKeyPath,
      publicKeyPath,
    };
  }

  ensureRootfsFromDocker(params: {
    dockerfilePath: string;
    sshPublicKeyPath: string;
    sshUser: string;
  }): RootfsArtifact {
    const dockerfileSha = this.sha256OfFile(params.dockerfilePath);
    const sshPubKeySha = this.sha256OfFile(params.sshPublicKeyPath);

    const rootfsDir = join(this.artifactsDir, "rootfs");
    const source = `dockerfile:${params.dockerfilePath}`;
    const buildHash = createHash("sha256")
      .update(`${this.rootfsBuildFormatVersion}:${params.dockerfilePath}:${dockerfileSha}:${sshPubKeySha}:${params.sshUser}`)
      .digest("hex")
      .slice(0, 24);
    const ext4Path = join(rootfsDir, `${buildHash}.ext4`);
    const metaPath = join(rootfsDir, `${buildHash}.json`);
    const cachedMeta = this.readBuildMeta(metaPath);

    mkdirSync(rootfsDir, { recursive: true });
    if (
      existsSync(ext4Path)
      && cachedMeta
      && cachedMeta.formatVersion === this.rootfsBuildFormatVersion
      && cachedMeta.dockerfilePath === params.dockerfilePath
      && cachedMeta.dockerfileSha256 === dockerfileSha
      && cachedMeta.sshPubKeySha256 === sshPubKeySha
      && cachedMeta.sshUser === params.sshUser
    ) {
      return {
        source,
        ext4Path,
        buildHash,
      };
    }

    const buildId = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const tempDir = join(this.rootfsTmpDir, `rootfs-${buildId}`);
    const treePath = join(tempDir, "tree");
    const tarPath = join(tempDir, "rootfs.tar");
    const ext4TempPath = `${ext4Path}.tmp.${buildId}`;

    mkdirSync(tempDir, { recursive: true });
    mkdirSync(treePath, { recursive: true });

    const imageTag = `microvm-rootfs-${buildHash}`;
    const contextPath = dirname(params.dockerfilePath);
    this.runner.run(["docker", "build", "-f", params.dockerfilePath, "-t", imageTag, contextPath], {
      inherit: true,
    });

    let containerId = "";
    try {
      const created = this.runner.run(["docker", "create", imageTag]);
      containerId = created.stdout.trim();
      if (!containerId) {
        throw new Error("Failed to create docker container for rootfs export.");
      }

      this.runner.run(["docker", "export", "-o", tarPath, containerId]);
      this.runner.runRoot(["tar", "-xpf", tarPath, "-C", treePath]);
      this.runner.runRoot(["rm", "-f", join(treePath, ".dockerenv")], {
        allowFailure: true,
      });

      this.writeDeterministicResolvConf(treePath);
      this.validateRootfsTree(treePath, params.sshUser);
      this.injectAuthorizedKeys(treePath, params.sshPublicKeyPath, params.sshUser);

      const sizeMib = this.recommendedRootfsSizeMib(treePath);
      const inodeCount = this.recommendedRootfsInodeCount(treePath);
      rmSync(ext4TempPath, {
        force: true,
      });
      this.runner.run(["truncate", "-s", `${sizeMib}M`, ext4TempPath]);
      this.runner.runRoot(["mkfs.ext4", "-F", "-N", inodeCount.toString(), "-d", treePath, ext4TempPath]);

      if (existsSync(ext4Path)) {
        rmSync(ext4Path, {
          force: true,
        });
      }
      renameSync(ext4TempPath, ext4Path);

      const meta: RootfsBuildMeta = {
        formatVersion: this.rootfsBuildFormatVersion,
        dockerfilePath: params.dockerfilePath,
        dockerfileSha256: dockerfileSha,
        sshPubKeySha256: sshPubKeySha,
        sshUser: params.sshUser,
        source,
        builtAt: new Date().toISOString(),
      };
      writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
    } finally {
      if (containerId) {
        this.runner.run(["docker", "rm", "-f", containerId], {
          allowFailure: true,
        });
      }
      this.runner.run(["rm", "-rf", tempDir], {
        allowFailure: true,
      });
      this.runner.run(["rm", "-f", ext4TempPath], {
        allowFailure: true,
      });
    }

    return {
      source,
      ext4Path,
      buildHash,
    };
  }

  private sha256OfFile(path: string): string {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  }

  private readBuildMeta(metaPath: string): RootfsBuildMeta | undefined {
    if (!existsSync(metaPath)) {
      return undefined;
    }
    try {
      return JSON.parse(readFileSync(metaPath, "utf8")) as RootfsBuildMeta;
    } catch {
      return undefined;
    }
  }

  private resolvePathInTree(treePath: string, rootfsPath: string): string {
    const root = resolve(treePath);
    let current = join(root, rootfsPath.replace(/^\/+/, ""));

    for (let hop = 0; hop < 40; hop += 1) {
      const currentResolved = resolve(current);
      if (!(currentResolved === root || currentResolved.startsWith(`${root}/`))) {
        throw new Error(`Resolved path escapes rootfs tree: ${currentResolved}`);
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

    throw new Error(`Too many symlink hops while resolving rootfs path: ${rootfsPath}`);
  }

  private hasExecutableInTree(treePath: string, rootfsPath: string): boolean {
    try {
      const resolvedPath = this.resolvePathInTree(treePath, rootfsPath);
      return (statSync(resolvedPath).mode & 0o111) !== 0;
    } catch {
      return false;
    }
  }

  private parsePasswdUsers(treePath: string): Record<string, { uid: string; gid: string; home: string }> {
    const passwdPath = join(treePath, "etc", "passwd");
    const passwd = readFileSync(passwdPath, "utf8");

    return passwd
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .reduce<Record<string, { uid: string; gid: string; home: string }>>((acc, line) => {
        const [username, _password, uid, gid, _gecos, home] = line.split(":");
        if (username && uid && gid && home) {
          acc[username] = {
            uid,
            gid,
            home,
          };
        }
        return acc;
      }, {});
  }

  private validateRootfsTree(treePath: string, sshUser: string): void {
    if (!this.hasExecutableInTree(treePath, "/sbin/init")) {
      throw new Error("Rootfs is missing executable /sbin/init.");
    }

    const hasSshd = ["/usr/bin/sshd", "/usr/sbin/sshd"].some((candidate) =>
      this.hasExecutableInTree(treePath, candidate));
    if (!hasSshd) {
      throw new Error("Rootfs is missing sshd binary (/usr/bin/sshd or /usr/sbin/sshd).");
    }

    const users = this.parsePasswdUsers(treePath);
    for (const user of ["root", sshUser]) {
      if (!users[user]) {
        throw new Error(`Rootfs is missing expected user in /etc/passwd: ${user}`);
      }
    }
  }

  private injectAuthorizedKeys(treePath: string, sshPublicKeyPath: string, sshUser: string): void {
    const users = this.parsePasswdUsers(treePath);

    for (const user of new Set(["root", sshUser])) {
      const record = users[user];
      if (!record) {
        throw new Error(`Rootfs is missing expected user in /etc/passwd: ${user}`);
      }

      const homePath = join(treePath, record.home.replace(/^\/+/, ""));
      const sshDir = join(homePath, ".ssh");
      const authKeys = join(sshDir, "authorized_keys");

      this.runner.runRoot(["install", "-d", "-m", "700", sshDir]);
      this.runner.runRoot(["cp", sshPublicKeyPath, authKeys]);
      this.runner.runRoot(["chmod", "600", authKeys]);
      this.runner.runRoot(["chown", "-R", `${record.uid}:${record.gid}`, sshDir]);
    }
  }

  private writeDeterministicResolvConf(treePath: string): void {
    const resolvPath = join(treePath, "etc", "resolv.conf");
    const content = ["nameserver 1.1.1.1", "nameserver 8.8.8.8", ""].join("\n");
    const command = `cat > ${this.runner.shellQuote(resolvPath)} <<'EOF'\n${content}EOF`;
    this.runner.runRoot(["bash", "-lc", command]);
  }

  private recommendedRootfsSizeMib(treePath: string): number {
    const usage = this.runner.runRoot(["du", "-sm", treePath]);
    const used = Number((usage.stdout.split(/\s+/).at(0) ?? "0").trim());
    if (!Number.isFinite(used) || used <= 0) {
      return 1024;
    }
    return Math.max(1024, used + 256);
  }

  private recommendedRootfsInodeCount(treePath: string): number {
    const entries = this.countTreeEntries(treePath);
    const withHeadroom = Math.ceil(entries * 1.25);
    return Math.max(65_536, withHeadroom + 4_096);
  }

  private countTreeEntries(path: string): number {
    const command = `find ${this.runner.shellQuote(path)} -print | wc -l`;
    const result = this.runner.runRoot(["bash", "-lc", command]);
    const entries = Number.parseInt(result.stdout.trim(), 10);
    if (!Number.isFinite(entries) || entries <= 0) {
      return 1;
    }
    return entries;
  }
}
