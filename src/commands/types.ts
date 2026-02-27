import type { AppConfig } from "../config/app-config";
import type {
  CreateVmOptions,
  SetVmOptions,
  VmLifecycleService,
} from "../services/vm-lifecycle";
import type { VmIdPolicyService } from "../services/vm-id-policy";

export type { CreateVmOptions, SetVmOptions, VmLifecycleService };

export type HelpRendererService = {
  renderHelp: () => string;
};

export type CommandDeps = {
  vmIdPolicy: VmIdPolicyService;
  appConfig: AppConfig;
  vmLifecycle: VmLifecycleService;
  helpRenderer: HelpRendererService;
};
