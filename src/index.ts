#!/usr/bin/env bun

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type VmConfig = {
  vmId: string;
  tapDev: string;
  hostIp: string;
  guestIp: string;
  maskBits: string;
  maskLong: string;
  guestMac: string;
  apiSocketPath: string;
  logPath: string;
  sshUser: string;
};

type KernelArtifact = {
  releaseTag: string;
  ciVersion: string;
  arch: string;
  key: string;
  url: string;
  path: string;
  version: string;
};

type RootfsArtifact = {
  source: string;
  ext4Path: string;
  buildHash: string;
};

type SshKeyPair = {
  privateKeyPath: string;
  publicKeyPath: string;
};

type RootfsBuildMeta = {
  formatVersion: number;
  dockerfileSha256: string;
  sshPubKeySha256: string;
  source: string;
  builtAt: string;
};

type VmState = VmConfig & {
  firecrackerPid: number;
  hostIface: string;
  bootArgs: string;
  kernelPath: string;
  rootfsPath: string;
  sshKeyPath: string;
  releaseTag: string;
  kernelCiVersion: string;
  kernelVersion: string;
  rootfsCiVersion: string;
  rootfsUbuntuVersion: string;
  rootfsBuildHash?: string;
  createdAt: string;
};

const PROJECT_ROOT = process.cwd();
const WORK_DIR = resolve(PROJECT_ROOT, ".microvm");
const ARTIFACTS_DIR = join(WORK_DIR, "artifacts");
const RUNTIME_DIR = join(WORK_DIR, "runtime");
const STATE_FILE = join(RUNTIME_DIR, "state.json");
const ARCH_ROOTFS_DOCKERFILE = resolve(PROJECT_ROOT, "Dockerfile.arch");
const ARCH_ROOTFS_EXT4 = resolve(ARTIFACTS_DIR, "rootfs", "archlinux.ext4");
const ARCH_ROOTFS_META = resolve(ARTIFACTS_DIR, "rootfs", "archlinux.ext4.meta.json");
const ROOTFS_TMP_DIR = resolve(WORK_DIR, "tmp");
const ROOTFS_BUILD_FORMAT_VERSION = 2;
const HOST_ALLOWED_TCP_PORT = "11434";

const DEFAULTS: VmConfig = {
  vmId: "vm0",
  tapDev: "tap-vm0",
  hostIp: "172.16.0.1",
  guestIp: "172.16.0.2",
  maskBits: "30",
  maskLong: "255.255.255.252",
  guestMac: "06:00:AC:10:00:02",
  apiSocketPath: "/tmp/microvm-vm0.firecracker.sock",
  logPath: join(RUNTIME_DIR, "firecracker.log"),
  sshUser: "thierry",
};
const SSH_PRIVATE_KEY_PATH = resolve(ARTIFACTS_DIR, "keys", `${DEFAULTS.vmId}.id_ed25519`);

const HELP = `
Usage:
  bun src/index.ts up [--no-attach]
  bun src/index.ts ssh
  bun src/index.ts down
  bun src/index.ts status

What "up" does:
  - resolves latest Firecracker release and CI kernel
  - downloads kernel artifact only when missing
  - builds/reuses Arch Linux rootfs.ext4 from Dockerfile.arch
  - configures tap + forwarding + iptables
  - boots a Firecracker microVM
  - waits for SSH and optionally attaches
`.trim();

const decoder = new TextDecoder();

const main = async (): Promise<void> => {
  const command = process.argv[2] ?? "up";
  const attach = !process.argv.includes("--no-attach");

  if (command === "up") {
    await runUp(attach);
    return;
  }

  if (command === "ssh") {
    await runSsh();
    return;
  }

  if (command === "down") {
    await runDown();
    return;
  }

  if (command === "status") {
    await runStatus();
    return;
  }

  if (command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }

  throw new Error(`Unknown command "${command}".\n\n${HELP}`);
};

const runUp = async (attach: boolean): Promise<void> => {
  ensureDirs([WORK_DIR, ARTIFACTS_DIR, RUNTIME_DIR]);
  ensureDependencies(["firecracker", "curl", "ip", "iptables", "ssh", "ssh-keygen", "sudo", "docker", "mkfs.ext4", "tar"]);
  ensureKvmAccess();
  ensureNoRunningVm();
  await ensureSudoSession();

  const arch = getHostArch();
  const kernel = await resolveLatestKernelArtifact(arch);
  const sshKeyPair = ensureSshKeyPair(SSH_PRIVATE_KEY_PATH);
  const rootfs = await ensureArchRootfsFromDocker({
    dockerfilePath: ARCH_ROOTFS_DOCKERFILE,
    ext4Path: ARCH_ROOTFS_EXT4,
    metaPath: ARCH_ROOTFS_META,
    sshPublicKeyPath: sshKeyPair.publicKeyPath,
  });

  logStep(`latest Firecracker release: ${kernel.releaseTag}`);
  logStep(`latest kernel: ${kernel.version} (${kernel.ciVersion})`);
  logStep(`rootfs source: ${rootfs.source}`);

  await downloadIfMissing(kernel.url, kernel.path);
  chmodSync(sshKeyPair.privateKeyPath, 0o600);

  const hostIface = getDefaultHostIface();
  let networkReady = false;
  let firecrackerPid = 0;

  try {
    await setupHostNetwork(DEFAULTS, hostIface);
    networkReady = true;

    firecrackerPid = launchFirecracker(DEFAULTS.apiSocketPath, DEFAULTS.logPath);
    await waitForFirecrackerApi(DEFAULTS.apiSocketPath, 10_000);

    const bootArgs = buildBootArgs(DEFAULTS, arch);
    await configureAndStartVm({
      config: DEFAULTS,
      kernelPath: kernel.path,
      rootfsPath: rootfs.ext4Path,
      bootArgs,
    });

    const state: VmState = {
      ...DEFAULTS,
      firecrackerPid,
      hostIface,
      bootArgs,
      kernelPath: kernel.path,
      rootfsPath: rootfs.ext4Path,
      sshKeyPath: sshKeyPair.privateKeyPath,
      releaseTag: kernel.releaseTag,
      kernelCiVersion: kernel.ciVersion,
      kernelVersion: kernel.version,
      rootfsCiVersion: "local-docker",
      rootfsUbuntuVersion: rootfs.source,
      rootfsBuildHash: rootfs.buildHash,
      createdAt: new Date().toISOString(),
    };
    writeJson(STATE_FILE, state);

    await waitForSshReady(state, 120_000);
    logStep(`VM is ready. SSH command: ${renderSshCommand(state)}`);

    if (attach) {
      const sshExitCode = spawnInherit(sshBaseArgs(state));
      if (sshExitCode !== 0) {
        logStep(`ssh session ended with exit code ${sshExitCode}`);
      }
    }
  } catch (error) {
    if (firecrackerPid > 0) {
      stopProcess(firecrackerPid);
    }
    if (networkReady) {
      await teardownHostNetwork(DEFAULTS, hostIface);
    }
    safeDelete(STATE_FILE);
    throw error;
  }
};

const runSsh = async (): Promise<void> => {
  const state = readState();
  if (!state) {
    throw new Error(`No VM state found at ${STATE_FILE}. Run "up" first.`);
  }
  const sshExitCode = spawnInherit(sshBaseArgs(state));
  if (sshExitCode !== 0) {
    logStep(`ssh session ended with exit code ${sshExitCode}`);
  }
};

const runDown = async (): Promise<void> => {
  const state = readState();
  if (!state) {
    logStep("No running VM state found.");
    return;
  }

  stopProcess(state.firecrackerPid);
  safeDelete(state.apiSocketPath);
  await teardownHostNetwork(state, state.hostIface);
  safeDelete(STATE_FILE);
  logStep("VM stopped and host network cleaned up.");
};

const runStatus = async (): Promise<void> => {
  const state = readState();
  if (!state) {
    logStep("No state file found.");
    return;
  }

  const alive = isProcessAlive(state.firecrackerPid);
  console.log(JSON.stringify({ state, firecrackerAlive: alive }, null, 2));
};

const ensureDirs = (paths: string[]): void => {
  paths.forEach((path) => mkdirSync(path, { recursive: true }));
};

const ensureDependencies = (binaries: string[]): void => {
  binaries.forEach((binary) => {
    const result = run(["bash", "-lc", `command -v ${binary}`], {
      allowFailure: true,
    });
    if (result.exitCode !== 0) {
      throw new Error(`Missing dependency: ${binary}`);
    }
  });
};

const ensureKvmAccess = (): void => {
  const canRead = run(["bash", "-lc", "[ -r /dev/kvm ]"], { allowFailure: true }).exitCode === 0;
  const canWrite = run(["bash", "-lc", "[ -w /dev/kvm ]"], { allowFailure: true }).exitCode === 0;
  if (!canRead || !canWrite) {
    throw new Error("Current user cannot read/write /dev/kvm.");
  }
};

const ensureSudoSession = async (): Promise<void> => {
  if (isRoot()) {
    return;
  }
  logStep("Requesting sudo for network setup...");
  run(["sudo", "-v"], { inherit: true });
};

const getHostArch = (): string => {
  if (process.arch === "x64") return "x86_64";
  if (process.arch === "arm64") return "aarch64";
  throw new Error(`Unsupported architecture: ${process.arch}`);
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
    path: resolve(join(ARTIFACTS_DIR, "kernel", latest.key.split("/").at(-1) ?? "vmlinux")),
    version: latest.version,
  };
};

const ensureSshKeyPair = (privateKeyPath: string): SshKeyPair => {
  const publicKeyPath = `${privateKeyPath}.pub`;
  ensureDirs([dirname(privateKeyPath)]);

  if (existsSync(privateKeyPath) && existsSync(publicKeyPath)) {
    logStep(`reuse: ${privateKeyPath}`);
    return { privateKeyPath, publicKeyPath };
  }

  safeDelete(privateKeyPath);
  safeDelete(publicKeyPath);

  logStep(`generate ssh key: ${privateKeyPath}`);
  run(["ssh-keygen", "-t", "ed25519", "-N", "", "-f", privateKeyPath, "-C", "microvm-access"], {
    allowFailure: false,
  });
  chmodSync(privateKeyPath, 0o600);
  chmodSync(publicKeyPath, 0o644);

  return { privateKeyPath, publicKeyPath };
};

const ensureArchRootfsFromDocker = async ({
  dockerfilePath,
  ext4Path,
  metaPath,
  sshPublicKeyPath,
}: {
  dockerfilePath: string;
  ext4Path: string;
  metaPath: string;
  sshPublicKeyPath: string;
}): Promise<RootfsArtifact> => {
  if (!existsSync(dockerfilePath)) {
    throw new Error(`Missing Dockerfile for rootfs build: ${dockerfilePath}`);
  }

  const dockerfileSha = sha256OfFile(dockerfilePath);
  const sshPubKeySha = sha256OfFile(sshPublicKeyPath);
  const buildHash = `${dockerfileSha}:${sshPubKeySha}`;

  if (existsSync(ext4Path) && existsSync(metaPath)) {
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as RootfsBuildMeta;
    if (
      meta.formatVersion === ROOTFS_BUILD_FORMAT_VERSION &&
      meta.dockerfileSha256 === dockerfileSha &&
      meta.sshPubKeySha256 === sshPubKeySha
    ) {
      logStep(`reuse: ${ext4Path}`);
      return {
        source: "archlinux (docker)",
        ext4Path,
        buildHash,
      };
    }
  }

  const imageTag = "microvm-arch-rootfs:local";
  const buildId = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const tempDir = join(ROOTFS_TMP_DIR, `rootfs-build-${buildId}`);
  const tarPath = join(tempDir, "rootfs.tar");
  const treePath = join(tempDir, "rootfs-tree");

  ensureDirs([ROOTFS_TMP_DIR, tempDir, dirname(ext4Path)]);
  runRoot(["mkdir", "-p", treePath]);

  logStep(`building docker image: ${imageTag}`);
  run(["docker", "build", "-f", dockerfilePath, "-t", imageTag, PROJECT_ROOT], { inherit: true });

  const containerId = run(["docker", "create", imageTag]).stdout.trim();
  if (!containerId) {
    throw new Error("Failed to create docker container for rootfs export.");
  }

  try {
    logStep("exporting docker rootfs...");
    run(["docker", "export", "-o", tarPath, containerId]);
    runRoot(["tar", "-xpf", tarPath, "-C", treePath]);

    runRoot(["rm", "-f", join(treePath, ".dockerenv")], { allowFailure: true });
    writeDeterministicResolvConf(treePath);
    injectAuthorizedKeys(treePath, sshPublicKeyPath);
    validateRootfsForBoot(treePath);

    const sizeMib = recommendedRootfsSizeMiB(treePath);
    const ext4TempPath = `${ext4Path}.tmp`;

    safeDelete(ext4TempPath);
    run(["truncate", "-s", `${sizeMib}M`, ext4TempPath]);
    logStep(`creating ext4 rootfs (${sizeMib} MiB): ${ext4Path}`);
    runRoot(["mkfs.ext4", "-F", "-d", treePath, ext4TempPath]);

    renameSync(ext4TempPath, ext4Path);
    chmodSync(ext4Path, 0o644);

    const meta: RootfsBuildMeta = {
      formatVersion: ROOTFS_BUILD_FORMAT_VERSION,
      dockerfileSha256: dockerfileSha,
      sshPubKeySha256: sshPubKeySha,
      source: "archlinux (docker)",
      builtAt: new Date().toISOString(),
    };
    writeJson(metaPath, meta);
  } finally {
    run(["docker", "rm", "-f", containerId], { allowFailure: true });
    runRoot(["rm", "-rf", tempDir], { allowFailure: true });
  }

  return {
    source: "archlinux (docker)",
    ext4Path,
    buildHash,
  };
};

const injectAuthorizedKeys = (treePath: string, sshPublicKeyPath: string): void => {
  injectAuthorizedKeyAtHome(join(treePath, "root"), sshPublicKeyPath, "0:0");
  injectAuthorizedKeyAtHome(join(treePath, "home", "thierry"), sshPublicKeyPath, "1000:1000");
};

const injectAuthorizedKeyAtHome = (homePath: string, sshPublicKeyPath: string, ownership: string): void => {
  const sshDir = join(homePath, ".ssh");
  const authKeys = join(sshDir, "authorized_keys");

  runRoot(["install", "-d", "-m", "700", sshDir]);
  runRoot(["cp", sshPublicKeyPath, authKeys]);
  runRoot(["chmod", "600", authKeys]);
  runRoot(["chown", "-R", ownership, sshDir]);
};

const validateRootfsForBoot = (treePath: string): void => {
  assertExecutable(join(treePath, "sbin", "init"), "Rootfs is missing /sbin/init");

  const sshdCandidates = [join(treePath, "usr", "bin", "sshd"), join(treePath, "usr", "sbin", "sshd")];
  const hasSshd = sshdCandidates.some((candidate) => runRoot(["test", "-x", candidate], { allowFailure: true }).exitCode === 0);
  if (!hasSshd) {
    throw new Error("Rootfs is missing sshd binary (expected /usr/bin/sshd or /usr/sbin/sshd).");
  }

  assertDirectory(join(treePath, "home", "thierry"), "Rootfs is missing /home/thierry");
  assertPasswdUserExists(treePath, "thierry");
};

const writeDeterministicResolvConf = (treePath: string): void => {
  const resolvPath = join(treePath, "etc", "resolv.conf");
  const content = "nameserver 1.1.1.1\nnameserver 8.8.8.8\n";
  runRoot(["bash", "-lc", `cat > ${shellQuote(resolvPath)} <<'EOF'\n${content}EOF`]);
};

const recommendedRootfsSizeMiB = (treePath: string): number => {
  const usage = runRoot(["du", "-sm", treePath]);
  const used = Number((usage.stdout.split(/\s+/).at(0) ?? "0").trim());
  if (!Number.isFinite(used) || used <= 0) {
    return 1024;
  }
  return Math.max(1024, used + 256);
};

const assertExecutable = (path: string, message: string): void => {
  if (runRoot(["test", "-x", path], { allowFailure: true }).exitCode === 0) {
    return;
  }
  throw new Error(`${message}: ${path}`);
};

const assertDirectory = (path: string, message: string): void => {
  if (runRoot(["test", "-d", path], { allowFailure: true }).exitCode === 0) {
    return;
  }
  throw new Error(`${message}: ${path}`);
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

const sha256OfFile = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

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

  const tempPath = `${path}.tmp`;
  const bytes = new Uint8Array(await response.arrayBuffer());
  writeFileSync(tempPath, bytes);
  renameSync(tempPath, path);
};

const setupHostNetwork = async (config: VmConfig, hostIface: string): Promise<void> => {
  runRoot(["ip", "link", "del", config.tapDev], { allowFailure: true });
  runRoot(["ip", "tuntap", "add", "dev", config.tapDev, "mode", "tap", "user", targetUser()]);
  runRoot(["ip", "addr", "add", `${config.hostIp}/${config.maskBits}`, "dev", config.tapDev]);
  runRoot(["ip", "link", "set", "dev", config.tapDev, "up"]);
  runRoot(["sysctl", "-w", "net.ipv4.ip_forward=1"]);

  ensureIptablesRule("nat", [
    "POSTROUTING",
    "-s",
    config.guestIp,
    "-o",
    hostIface,
    "-j",
    "MASQUERADE",
  ]);
  ensureIptablesRule(null, [
    "FORWARD",
    "-i",
    config.tapDev,
    "-o",
    hostIface,
    "-j",
    "ACCEPT",
  ]);
  ensureIptablesRule(null, [
    "FORWARD",
    "-i",
    hostIface,
    "-o",
    config.tapDev,
    "-m",
    "conntrack",
    "--ctstate",
    "RELATED,ESTABLISHED",
    "-j",
    "ACCEPT",
  ]);

  // Restrict VM access to host services: allow only Ollama on 11434, drop everything else.
  ensureIptablesRuleInserted(null, "INPUT", 1, [
    "-i",
    config.tapDev,
    "-s",
    config.guestIp,
    "-m",
    "conntrack",
    "--ctstate",
    "RELATED,ESTABLISHED",
    "-j",
    "ACCEPT",
  ]);
  ensureIptablesRuleInserted(null, "INPUT", 2, [
    "-i",
    config.tapDev,
    "-s",
    config.guestIp,
    "-p",
    "tcp",
    "--dport",
    HOST_ALLOWED_TCP_PORT,
    "-j",
    "ACCEPT",
  ]);
  ensureIptablesRuleInserted(null, "INPUT", 3, [
    "-i",
    config.tapDev,
    "-s",
    config.guestIp,
    "-j",
    "DROP",
  ]);
};

const teardownHostNetwork = async (config: VmConfig, hostIface: string): Promise<void> => {
  deleteIptablesRule("nat", [
    "POSTROUTING",
    "-s",
    config.guestIp,
    "-o",
    hostIface,
    "-j",
    "MASQUERADE",
  ]);
  deleteIptablesRule(null, [
    "FORWARD",
    "-i",
    config.tapDev,
    "-o",
    hostIface,
    "-j",
    "ACCEPT",
  ]);
  deleteIptablesRule(null, [
    "FORWARD",
    "-i",
    hostIface,
    "-o",
    config.tapDev,
    "-m",
    "conntrack",
    "--ctstate",
    "RELATED,ESTABLISHED",
    "-j",
    "ACCEPT",
  ]);
  deleteIptablesRule(null, [
    "INPUT",
    "-i",
    config.tapDev,
    "-s",
    config.guestIp,
    "-m",
    "conntrack",
    "--ctstate",
    "RELATED,ESTABLISHED",
    "-j",
    "ACCEPT",
  ]);
  deleteIptablesRule(null, [
    "INPUT",
    "-i",
    config.tapDev,
    "-s",
    config.guestIp,
    "-p",
    "tcp",
    "--dport",
    HOST_ALLOWED_TCP_PORT,
    "-j",
    "ACCEPT",
  ]);
  deleteIptablesRule(null, [
    "INPUT",
    "-i",
    config.tapDev,
    "-s",
    config.guestIp,
    "-j",
    "DROP",
  ]);
  runRoot(["ip", "link", "del", config.tapDev], { allowFailure: true });
};

const ensureIptablesRule = (table: string | null, ruleArgs: string[]): void => {
  const check = ["iptables", ...tableArgs(table), "-C", ...ruleArgs];
  const add = ["iptables", ...tableArgs(table), "-A", ...ruleArgs];
  const checked = runRoot(check, { allowFailure: true });
  if (checked.exitCode !== 0) {
    runRoot(add);
  }
};

const ensureIptablesRuleInserted = (
  table: string | null,
  chain: string,
  position: number,
  matchArgs: string[],
): void => {
  const check = ["iptables", ...tableArgs(table), "-C", chain, ...matchArgs];
  const insert = ["iptables", ...tableArgs(table), "-I", chain, String(position), ...matchArgs];
  const checked = runRoot(check, { allowFailure: true });
  if (checked.exitCode !== 0) {
    runRoot(insert);
  }
};

const deleteIptablesRule = (table: string | null, ruleArgs: string[]): void => {
  const remove = ["iptables", ...tableArgs(table), "-D", ...ruleArgs];
  runRoot(remove, { allowFailure: true });
};

const tableArgs = (table: string | null): string[] => (table ? ["-t", table] : []);

const getDefaultHostIface = (): string => {
  const result = run(["ip", "-j", "route", "list", "default"]);
  const routes = JSON.parse(result.stdout) as Array<{ dev?: string }>;
  const dev = routes[0]?.dev;
  if (!dev) {
    throw new Error("Cannot determine default host interface from `ip route`.");
  }
  return dev;
};

const launchFirecracker = (socketPath: string, logPath: string): number => {
  safeDelete(socketPath);
  mkdirSync(dirname(logPath), { recursive: true });

  const command = `nohup firecracker --api-sock ${shellQuote(socketPath)} > ${shellQuote(logPath)} 2>&1 & echo $!`;
  const result = run(["bash", "-lc", command]);
  const pid = Number(result.stdout.trim());
  if (!Number.isFinite(pid) || pid <= 0) {
    throw new Error(`Failed to launch firecracker. Output: ${result.stdout}`);
  }
  return pid;
};

const waitForFirecrackerApi = async (socketPath: string, timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ping = run(
      [
        "curl",
        "--silent",
        "--show-error",
        "--fail",
        "--unix-socket",
        socketPath,
        "http://localhost/",
      ],
      { allowFailure: true },
    );
    if (ping.exitCode === 0) return;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for Firecracker API socket: ${socketPath}`);
};

const buildBootArgs = (config: VmConfig, arch: string): string => {
  const args = [
    "console=ttyS0",
    "reboot=k",
    "panic=1",
    "pci=off",
    "root=/dev/vda",
    "rw",
    `ip=${config.guestIp}::${config.hostIp}:${config.maskLong}:${config.vmId}:eth0:off`,
  ];
  if (arch === "aarch64") {
    args.unshift("keep_bootcon");
  }
  return args.join(" ");
};

const configureAndStartVm = async ({
  config,
  kernelPath,
  rootfsPath,
  bootArgs,
}: {
  config: VmConfig;
  kernelPath: string;
  rootfsPath: string;
  bootArgs: string;
}): Promise<void> => {
  firecrackerPut(config.apiSocketPath, "/machine-config", {
    vcpu_count: 2,
    mem_size_mib: 1024,
  });
  firecrackerPut(config.apiSocketPath, "/boot-source", {
    kernel_image_path: kernelPath,
    boot_args: bootArgs,
  });
  firecrackerPut(config.apiSocketPath, "/drives/rootfs", {
    drive_id: "rootfs",
    path_on_host: rootfsPath,
    is_root_device: true,
    is_read_only: false,
  });
  firecrackerPut(config.apiSocketPath, "/network-interfaces/eth0", {
    iface_id: "eth0",
    host_dev_name: config.tapDev,
    guest_mac: config.guestMac,
  });
  firecrackerPut(config.apiSocketPath, "/actions", {
    action_type: "InstanceStart",
  });
};

const firecrackerPut = (socketPath: string, endpoint: string, payload: unknown): void => {
  run([
    "curl",
    "--silent",
    "--show-error",
    "--fail",
    "--unix-socket",
    socketPath,
    "-X",
    "PUT",
    `http://localhost${endpoint}`,
    "-H",
    "Content-Type: application/json",
    "-d",
    JSON.stringify(payload),
  ]);
};

const waitForSshReady = async (state: VmState, timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const attempt = run([...sshBaseArgs(state), "true"], { allowFailure: true });
    if (attempt.exitCode === 0) return;
    await sleep(1500);
  }
  throw new Error("Timed out waiting for SSH to become available.");
};

const sshBaseArgs = (state: VmState): string[] => [
  "ssh",
  "-i",
  state.sshKeyPath,
  "-o",
  "StrictHostKeyChecking=no",
  "-o",
  "UserKnownHostsFile=/dev/null",
  "-o",
  "IdentitiesOnly=yes",
  "-o",
  "BatchMode=yes",
  "-o",
  "ConnectTimeout=3",
  `${state.sshUser}@${state.guestIp}`,
];

const renderSshCommand = (state: VmState): string =>
  [
    "ssh",
    "-i",
    shellQuote(state.sshKeyPath),
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
    `${state.sshUser}@${state.guestIp}`,
  ].join(" ");

const ensureNoRunningVm = (): void => {
  const state = readState();
  if (!state) return;

  if (isProcessAlive(state.firecrackerPid)) {
    throw new Error(`Existing VM appears to be running (pid ${state.firecrackerPid}). Run "bun src/index.ts down" first.`);
  }

  safeDelete(STATE_FILE);
  safeDelete(state.apiSocketPath);
};

const readState = (): VmState | null => {
  if (!existsSync(STATE_FILE)) return null;
  return JSON.parse(readFileSync(STATE_FILE, "utf8")) as VmState;
};

const writeJson = (path: string, data: unknown): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
};

const stopProcess = (pid: number): void => {
  if (!Number.isFinite(pid) || pid <= 0) return;
  run(["kill", "-TERM", String(pid)], { allowFailure: true });
  if (!isProcessAlive(pid)) return;
  run(["kill", "-KILL", String(pid)], { allowFailure: true });
};

const isProcessAlive = (pid: number): boolean =>
  run(["kill", "-0", String(pid)], { allowFailure: true }).exitCode === 0;

const targetUser = (): string => process.env.SUDO_USER ?? process.env.USER ?? "root";

const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\"'\"'`)}'`;

const safeDelete = (path: string): void => {
  if (!existsSync(path)) return;
  rmSync(path, { force: true, recursive: false });
};

const isRoot = (): boolean => (typeof process.getuid === "function" ? process.getuid() === 0 : false);

const withRoot = (args: string[]): string[] => (isRoot() ? args : ["sudo", ...args]);

const runRoot = (args: string[], options: { allowFailure?: boolean; inherit?: boolean } = {}): CommandResult =>
  run(withRoot(args), options);

const spawnInherit = (args: string[]): number => {
  const proc = Bun.spawnSync(args, {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return proc.exitCode ?? 1;
};

const run = (
  args: string[],
  options: { allowFailure?: boolean; inherit?: boolean } = {},
): CommandResult => {
  const inherit = options.inherit ?? false;
  const proc = Bun.spawnSync(args, {
    stdin: inherit ? "inherit" : "ignore",
    stdout: inherit ? "inherit" : "pipe",
    stderr: inherit ? "inherit" : "pipe",
    cwd: PROJECT_ROOT,
  });

  const stdout = proc.stdout ? decoder.decode(proc.stdout).trim() : "";
  const stderr = proc.stderr ? decoder.decode(proc.stderr).trim() : "";
  const result: CommandResult = {
    exitCode: proc.exitCode ?? 1,
    stdout,
    stderr,
  };

  if (result.exitCode !== 0 && !options.allowFailure) {
    const rendered = args.join(" ");
    const details = [stderr, stdout].filter(Boolean).join("\n");
    throw new Error(`Command failed (${result.exitCode}): ${rendered}${details ? `\n${details}` : ""}`);
  }

  return result;
};

const logStep = (message: string): void => {
  console.log(`[microvm] ${message}`);
};

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[microvm] ERROR: ${message}`);
  process.exit(1);
});
