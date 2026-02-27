import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { Environment } from "../env";

export type RuntimePaths = {
  projectRoot: string;
  dataDir: string;
  stateDir: string;
  cacheDir: string;
  workDir: string;
  artifactsDir: string;
  runtimeDir: string;
  vmsDir: string;
  vmDatabaseFile: string;
  rootfsTmpDir: string;
  jailerBaseDir: string;
  sharedSshPrivateKeyPath: string;
};

const isMicrovmProjectRoot = (projectRoot: string): boolean => {
  const packageJsonPath = join(projectRoot, "package.json");
  const sourceEntrypointPath = join(projectRoot, "src", "index.ts");
  if (!existsSync(packageJsonPath) || !existsSync(sourceEntrypointPath)) {
    return false;
  }
  try {
    const raw = readFileSync(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { name?: unknown };
    return parsed.name === "microvm";
  } catch {
    return false;
  }
};

const absoluteOrUndefined = (value: string | undefined): string | undefined => {
  if (!value || !isAbsolute(value)) {
    return undefined;
  }
  return resolve(value);
};

export const buildRuntimePaths = ({
  projectRoot,
  env,
}: {
  projectRoot: string;
  env: Pick<
    Environment,
    | "MICROVM_HOME"
    | "XDG_DATA_HOME"
    | "XDG_STATE_HOME"
    | "XDG_CACHE_HOME"
    | "XDG_RUNTIME_DIR"
    | "HOME"
  >;
}): RuntimePaths => {
  const microvmHome = env.MICROVM_HOME ? resolve(env.MICROVM_HOME) : undefined;
  const homeDir = env.HOME ? resolve(env.HOME) : undefined;

  const xdgDataHome = absoluteOrUndefined(env.XDG_DATA_HOME);
  const xdgStateHome = absoluteOrUndefined(env.XDG_STATE_HOME);
  const xdgCacheHome = absoluteOrUndefined(env.XDG_CACHE_HOME);
  const xdgRuntimeHome = absoluteOrUndefined(env.XDG_RUNTIME_DIR);

  // Dev-local mode: explicit override or running from source repo with no XDG/HOME hints.
  if (microvmHome || (
    isMicrovmProjectRoot(projectRoot)
    && !xdgDataHome
    && !xdgStateHome
    && !xdgCacheHome
    && !homeDir
  )) {
    const workDir = microvmHome ?? resolve(projectRoot, ".microvm");
    const artifactsDir = join(workDir, "artifacts");
    return {
      projectRoot,
      dataDir: workDir,
      stateDir: workDir,
      cacheDir: workDir,
      workDir,
      artifactsDir,
      runtimeDir: join(workDir, "runtime"),
      vmsDir: join(workDir, "vms"),
      vmDatabaseFile: join(workDir, "runtime", "vms.json"),
      rootfsTmpDir: resolve(workDir, "tmp"),
      jailerBaseDir: resolve(workDir, "jailer"),
      sharedSshPrivateKeyPath: resolve(artifactsDir, "keys", "microvm.id_ed25519"),
    };
  }

  const dataDir = join(
    xdgDataHome ?? (homeDir ? join(homeDir, ".local", "share") : resolve(projectRoot, ".microvm", "data")),
    "microvm",
  );
  const stateDir = join(
    xdgStateHome ?? (homeDir ? join(homeDir, ".local", "state") : resolve(projectRoot, ".microvm", "state")),
    "microvm",
  );
  const cacheDir = join(
    xdgCacheHome ?? (homeDir ? join(homeDir, ".cache") : resolve(projectRoot, ".microvm", "cache")),
    "microvm",
  );
  const runtimeDir = xdgRuntimeHome ? join(xdgRuntimeHome, "microvm") : join(stateDir, "runtime");
  const artifactsDir = join(cacheDir, "artifacts");

  return {
    projectRoot,
    dataDir,
    stateDir,
    cacheDir,
    workDir: stateDir,
    artifactsDir,
    runtimeDir,
    vmsDir: join(dataDir, "vms"),
    vmDatabaseFile: join(stateDir, "vms.json"),
    rootfsTmpDir: resolve(cacheDir, "tmp"),
    jailerBaseDir: resolve(stateDir, "jailer"),
    sharedSshPrivateKeyPath: resolve(dataDir, "keys", "microvm.id_ed25519"),
  };
};
