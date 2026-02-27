import type { AppConfig } from "../config/app-config";
import { z } from "zod";
import {
  applyNetworkPolicy,
  createDefaultVmNetworkPolicy,
  removeNetworkPolicy,
  type NetworkConfig,
  type NetworkContext,
} from "./network-policy";
import type { ProcessService } from "./process";

type IptablesTable = "nat" | null;

export type NetworkManagerService = {
  getDefaultHostIface: () => string;
  setupHostNetwork: (config: NetworkConfig, hostIface: string) => Promise<void>;
  teardownHostNetwork: (config: NetworkConfig, hostIface: string) => Promise<void>;
};

export const createNetworkManagerService = ({
  process,
  appConfig,
}: {
  process: ProcessService;
  appConfig: AppConfig;
}): NetworkManagerService => {
  const defaultRouteListSchema = z.array(z.object({
    dev: z.string().optional(),
  }));
  const hostAllowedTcpPort = appConfig.defaults.network.hostAllowedTcpPort;
  const tableArgs = (table: IptablesTable): string[] => (table ? ["-t", table] : []);

  const ensureIptablesRule = (table: IptablesTable, ruleArgs: string[]): void => {
    const check = ["iptables", ...tableArgs(table), "-C", ...ruleArgs];
    const add = ["iptables", ...tableArgs(table), "-A", ...ruleArgs];
    const checked = process.runRoot(check, { allowFailure: true });
    if (checked.exitCode !== 0) {
      process.runRoot(add);
    }
  };

  const ensureIptablesRuleInserted = (
    table: IptablesTable,
    chain: string,
    position: number,
    matchArgs: string[],
  ): void => {
    const check = ["iptables", ...tableArgs(table), "-C", chain, ...matchArgs];
    const insert = ["iptables", ...tableArgs(table), "-I", chain, String(position), ...matchArgs];
    const checked = process.runRoot(check, { allowFailure: true });
    if (checked.exitCode !== 0) {
      process.runRoot(insert);
    }
  };

  const deleteIptablesRule = (table: IptablesTable, ruleArgs: string[]): void => {
    const remove = ["iptables", ...tableArgs(table), "-D", ...ruleArgs];
    process.runRoot(remove, { allowFailure: true });
  };

  const defaultVmNetworkPolicy = createDefaultVmNetworkPolicy({
    ensureRule: ensureIptablesRule,
    insertRule: ensureIptablesRuleInserted,
    deleteRule: deleteIptablesRule,
  });

  const getDefaultHostIface = (): string => {
    const result = process.run(["ip", "-j", "route", "list", "default"]);
    let payload: unknown;
    try {
      payload = JSON.parse(result.stdout);
    } catch {
      throw new Error("Cannot parse `ip -j route` output while determining default host interface.");
    }
    const parsed = defaultRouteListSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error("Unexpected `ip -j route` JSON format while determining default host interface.");
    }
    const routes = parsed.data;
    const dev = routes[0]?.dev;
    if (!dev) {
      throw new Error("Cannot determine default host interface from `ip route`.");
    }
    return dev;
  };

  const setupHostNetwork = async (config: NetworkConfig, hostIface: string): Promise<void> => {
    process.runRoot(["ip", "link", "del", config.tapDev], { allowFailure: true });
    process.runRoot(["ip", "tuntap", "add", "dev", config.tapDev, "mode", "tap", "user", process.targetUser()]);
    process.runRoot(["ip", "addr", "add", `${config.hostIp}/${config.maskBits}`, "dev", config.tapDev]);
    process.runRoot(["ip", "link", "set", "dev", config.tapDev, "up"]);
    process.runRoot(["sysctl", "-w", "net.ipv4.ip_forward=1"]);
    const context: NetworkContext = {
      config,
      hostIface,
      hostAllowedTcpPort,
    };
    applyNetworkPolicy(defaultVmNetworkPolicy, context);
  };

  const teardownHostNetwork = async (config: NetworkConfig, hostIface: string): Promise<void> => {
    const context: NetworkContext = {
      config,
      hostIface,
      hostAllowedTcpPort,
    };
    removeNetworkPolicy(defaultVmNetworkPolicy, context);
    process.runRoot(["ip", "link", "del", config.tapDev], { allowFailure: true });
  };

  return {
    getDefaultHostIface,
    setupHostNetwork,
    teardownHostNetwork,
  };
};
