import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createTestAppConfig } from "../../test/test-app-config";
import { DockerClient } from "./docker.client";

const parseShellQuotedPath = (script: string): string => {
  const match = script.match(/cat > '([^']+)' <<'EOF'/);
  if (!match) {
    throw new Error(`Could not parse shell quoted path in script: ${script}`);
  }
  const path = match[1];
  if (!path) {
    throw new Error(`Could not parse shell quoted path in script: ${script}`);
  }
  return path;
};

const requiredArg = (args: string[], index: number): string => {
  const value = args[index];
  if (!value) {
    throw new Error(`Missing required arg at index ${index} for command: ${args.join(" ")}`);
  }
  return value;
};

describe("DockerClient", () => {
  it("reuses cached rootfs artifact without invoking docker commands", () => {
    const { config, cleanup } = createTestAppConfig();

    let runCalls = 0;
    let runRootCalls = 0;

    const runner = {
      run: () => {
        runCalls += 1;
        throw new Error("unexpected run() invocation for cache hit");
      },
      runRoot: () => {
        runRootCalls += 1;
        throw new Error("unexpected runRoot() invocation for cache hit");
      },
      shellQuote: (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`,
    } as any;

    try {
      const dockerfilePath = join(config.paths.projectRoot, "Dockerfile");
      const sshPubPath = join(config.paths.projectRoot, "id_test.pub");
      writeFileSync(dockerfilePath, "FROM scratch\n", "utf8");
      writeFileSync(sshPubPath, "ssh-ed25519 AAAATESTKEY user@test\n", "utf8");

      const dockerfileSha = createHash("sha256").update(readFileSync(dockerfilePath)).digest("hex");
      const sshPubKeySha = createHash("sha256").update(readFileSync(sshPubPath)).digest("hex");
      const sshUser = "thierry";
      const buildHash = createHash("sha256")
        .update(`${config.defaults.runtime.rootfsBuildFormatVersion}:${dockerfilePath}:${dockerfileSha}:${sshPubKeySha}:${sshUser}`)
        .digest("hex")
        .slice(0, 24);

      const rootfsDir = join(config.paths.artifactsDir, "rootfs");
      const ext4Path = join(rootfsDir, `${buildHash}.ext4`);
      const metaPath = join(rootfsDir, `${buildHash}.json`);
      mkdirSync(rootfsDir, { recursive: true });
      writeFileSync(ext4Path, "cached-ext4", "utf8");
      writeFileSync(metaPath, `${JSON.stringify({
        formatVersion: config.defaults.runtime.rootfsBuildFormatVersion,
        dockerfilePath,
        dockerfileSha256: dockerfileSha,
        sshPubKeySha256: sshPubKeySha,
        sshUser,
        source: `dockerfile:${dockerfilePath}`,
        builtAt: "2026-01-01T00:00:00.000Z",
      })}\n`, "utf8");

      const client = new DockerClient({
        runner,
        config,
      });
      const artifact = client.ensureRootfsFromDocker({
        dockerfilePath,
        sshPublicKeyPath: sshPubPath,
        sshUser,
      });

      expect(artifact.ext4Path).toBe(ext4Path);
      expect(runCalls).toBe(0);
      expect(runRootCalls).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("builds and caches rootfs artifact when cache is missing", () => {
    const { config, cleanup } = createTestAppConfig();

    let containerId = "cid-test-1";
    let mkfsArgs: string[] | undefined;

    const runner = {
      run: (args: string[]) => {
        if (args[0] === "docker" && args[1] === "build") {
          return { exitCode: 0, stdout: "", stderr: "" };
        }
        if (args[0] === "docker" && args[1] === "create") {
          return { exitCode: 0, stdout: `${containerId}\n`, stderr: "" };
        }
        if (args[0] === "docker" && args[1] === "export") {
          const tarPath = requiredArg(args, 3);
          writeFileSync(tarPath, "fake-tar", "utf8");
          return { exitCode: 0, stdout: "", stderr: "" };
        }
        if (args[0] === "docker" && args[1] === "rm") {
          return { exitCode: 0, stdout: "", stderr: "" };
        }
        if (args[0] === "truncate") {
          const target = requiredArg(args, 3);
          mkdirSync(dirname(target), { recursive: true });
          if (!existsSync(target)) {
            writeFileSync(target, "", "utf8");
          }
          truncateSync(target, 1024 * 1024);
          return { exitCode: 0, stdout: "", stderr: "" };
        }
        if (args[0] === "rm") {
          return { exitCode: 0, stdout: "", stderr: "" };
        }

        throw new Error(`Unexpected run() args: ${args.join(" ")}`);
      },
      runRoot: (args: string[]) => {
        if (args[0] === "tar") {
          const treePath = requiredArg(args, args.indexOf("-C") + 1);
          mkdirSync(join(treePath, "etc"), { recursive: true });
          mkdirSync(join(treePath, "sbin"), { recursive: true });
          mkdirSync(join(treePath, "usr", "sbin"), { recursive: true });
          mkdirSync(join(treePath, "root"), { recursive: true });
          mkdirSync(join(treePath, "home", "thierry"), { recursive: true });
          writeFileSync(join(treePath, "etc", "passwd"), [
            "root:x:0:0:root:/root:/bin/bash",
            "thierry:x:1000:1000:Thierry:/home/thierry:/bin/bash",
            "",
          ].join("\n"), "utf8");
          writeFileSync(join(treePath, "sbin", "init"), "#!/bin/sh\n", "utf8");
          writeFileSync(join(treePath, "usr", "sbin", "sshd"), "#!/bin/sh\n", "utf8");
          chmodSync(join(treePath, "sbin", "init"), 0o755);
          chmodSync(join(treePath, "usr", "sbin", "sshd"), 0o755);
          return { exitCode: 0, stdout: "", stderr: "" };
        }
        if (args[0] === "rm") {
          return { exitCode: 0, stdout: "", stderr: "" };
        }
        if (args[0] === "bash" && args[1] === "-lc") {
          const script = requiredArg(args, 2);
          if (script.includes("cat >")) {
            const path = parseShellQuotedPath(script);
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, "nameserver 1.1.1.1\nnameserver 8.8.8.8\n", "utf8");
            return { exitCode: 0, stdout: "", stderr: "" };
          }
          if (script.includes("find ") && script.includes("| wc -l")) {
            return { exitCode: 0, stdout: "42\n", stderr: "" };
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        }
        if (args[0] === "install") {
          const sshDir = requiredArg(args, args.length - 1);
          mkdirSync(sshDir, { recursive: true });
          return { exitCode: 0, stdout: "", stderr: "" };
        }
        if (args[0] === "cp") {
          copyFileSync(requiredArg(args, 1), requiredArg(args, 2));
          return { exitCode: 0, stdout: "", stderr: "" };
        }
        if (args[0] === "chmod") {
          chmodSync(requiredArg(args, 2), Number.parseInt(requiredArg(args, 1), 8));
          return { exitCode: 0, stdout: "", stderr: "" };
        }
        if (args[0] === "chown") {
          return { exitCode: 0, stdout: "", stderr: "" };
        }
        if (args[0] === "du") {
          return { exitCode: 0, stdout: "10\tfake\n", stderr: "" };
        }
        if (args[0] === "mkfs.ext4") {
          mkfsArgs = [...args];
          const ext4Path = requiredArg(args, args.length - 1);
          if (!existsSync(ext4Path)) {
            writeFileSync(ext4Path, "mkfs-ext4-output", "utf8");
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        }

        throw new Error(`Unexpected runRoot() args: ${args.join(" ")}`);
      },
      shellQuote: (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`,
    } as any;

    try {
      const dockerfilePath = join(config.paths.projectRoot, "Dockerfile");
      const sshPubPath = join(config.paths.projectRoot, "id_test.pub");
      writeFileSync(dockerfilePath, "FROM scratch\n", "utf8");
      writeFileSync(sshPubPath, "ssh-ed25519 AAAATESTKEY user@test\n", "utf8");

      const client = new DockerClient({
        runner,
        config,
      });
      const artifact = client.ensureRootfsFromDocker({
        dockerfilePath,
        sshPublicKeyPath: sshPubPath,
        sshUser: "thierry",
      });

      expect(existsSync(artifact.ext4Path)).toBe(true);
      expect(statSync(artifact.ext4Path).size).toBeGreaterThan(0);
      expect(mkfsArgs).toBeDefined();
      expect(mkfsArgs).toContain("-N");
      const inodeArg = mkfsArgs?.[mkfsArgs.indexOf("-N") + 1] ?? "0";
      expect(Number(inodeArg)).toBeGreaterThanOrEqual(65_536);

      const metaPath = artifact.ext4Path.replace(/\.ext4$/, ".json");
      const meta = JSON.parse(readFileSync(metaPath, "utf8")) as { formatVersion: number; sshUser: string };
      expect(meta.formatVersion).toBe(config.defaults.runtime.rootfsBuildFormatVersion);
      expect(meta.sshUser).toBe("thierry");
      expect(containerId).toBe("cid-test-1");
    } finally {
      cleanup();
    }
  });
});
