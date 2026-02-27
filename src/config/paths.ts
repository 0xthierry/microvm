import { join, resolve } from "node:path";

export type RuntimePaths = {
  projectRoot: string;
  workDir: string;
  artifactsDir: string;
  runtimeDir: string;
  vmsDir: string;
  vmDatabaseFile: string;
  defaultRootfsDockerfile: string;
  rootfsTmpDir: string;
  jailerBaseDir: string;
  sharedSshPrivateKeyPath: string;
};

export const buildRuntimePaths = ({ projectRoot }: { projectRoot: string }): RuntimePaths => {
  const workDir = resolve(projectRoot, ".microvm");
  const artifactsDir = join(workDir, "artifacts");

  return {
    projectRoot,
    workDir,
    artifactsDir,
    runtimeDir: join(workDir, "runtime"),
    vmsDir: join(workDir, "vms"),
    vmDatabaseFile: join(workDir, "runtime", "vms.json"),
    defaultRootfsDockerfile: resolve(projectRoot, "Dockerfile.arch"),
    rootfsTmpDir: resolve(workDir, "tmp"),
    jailerBaseDir: resolve(workDir, "jailer"),
    sharedSshPrivateKeyPath: resolve(artifactsDir, "keys", "microvm.id_ed25519"),
  };
};
