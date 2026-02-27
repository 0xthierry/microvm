import type { Environment } from "../env";
import { jailerDefaults } from "./defaults/jailer";
import { networkDefaults } from "./defaults/network";
import { runtimeDefaults } from "./defaults/runtime";
import { vmDefaults } from "./defaults/vm";
import { buildRuntimePaths, type RuntimePaths } from "./paths";

export type AppConfig = {
  env: Environment;
  paths: RuntimePaths;
  defaults: {
    vm: typeof vmDefaults;
    network: typeof networkDefaults;
    jailer: typeof jailerDefaults;
    runtime: typeof runtimeDefaults;
  };
};

export const buildAppConfig = ({
  projectRoot,
  env,
}: {
  projectRoot: string;
  env: Environment;
}): AppConfig => {
  const paths = buildRuntimePaths({ projectRoot, env });

  return {
    env,
    paths,
    defaults: {
      vm: vmDefaults,
      network: networkDefaults,
      jailer: jailerDefaults,
      runtime: runtimeDefaults,
    },
  };
};
