import { copyFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAppConfig, type AppConfig } from "../config/app-config";
import { setAppConfigForTesting } from "../config/runtime-context";
import { loadEnvironment } from "../env";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

const stagedProjectFixtures = [
  {
    sourcePath: join(repoRoot, "scripts", "Dockerfile.test-ubuntu"),
    targetPath: ["scripts", "Dockerfile.test-ubuntu"],
  },
  {
    sourcePath: join(repoRoot, "examples", "archlinux", "Dockerfile"),
    targetPath: ["examples", "archlinux", "Dockerfile"],
  },
] as const;

const stageProjectFixtures = (rootDir: string): void => {
  for (const fixture of stagedProjectFixtures) {
    const targetPath = join(rootDir, ...fixture.targetPath);
    mkdirSync(dirname(targetPath), { recursive: true });
    copyFileSync(fixture.sourcePath, targetPath);
  }
};

export const createTestAppConfig = (): {
  config: AppConfig;
  rootDir: string;
  cleanup: () => void;
} => {
  const rootDir = mkdtempSync(join(tmpdir(), "microvm-test-"));
  stageProjectFixtures(rootDir);
  const config = buildAppConfig({
    projectRoot: rootDir,
    env: loadEnvironment({
      HOME: rootDir,
    }),
  });

  setAppConfigForTesting(config);

  return {
    config,
    rootDir,
    cleanup: () => {
      setAppConfigForTesting(undefined);
      rmSync(rootDir, {
        recursive: true,
        force: true,
      });
    },
  };
};
