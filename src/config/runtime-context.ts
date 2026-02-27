import { loadEnvironment } from "../env";
import { buildAppConfig, type AppConfig } from "./app-config";

let cachedConfig: AppConfig | undefined;

export const getAppConfig = (): AppConfig => {
  if (cachedConfig) {
    return cachedConfig;
  }

  cachedConfig = buildAppConfig({
    projectRoot: process.cwd(),
    env: loadEnvironment(),
  });

  return cachedConfig;
};

export const setAppConfigForTesting = (config: AppConfig | undefined): void => {
  cachedConfig = config;
};
