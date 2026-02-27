import type { AppConfig } from "../config/app-config";
import type { ProcessService } from "./process";

type NetworkConfig = {
  tapDev: string;
  hostIp: string;
  guestIp: string;
  maskBits: string;
};

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
  const hostAllowedTcpPort = appConfig.defaults.network.hostAllowedTcpPort;
  const tableArgs = (table: string | null): string[] => (table ? ["-t", table] : []);

  const ensureIptablesRule = (table: string | null, ruleArgs: string[]): void => {
    const check = ["iptables", ...tableArgs(table), "-C", ...ruleArgs];
    const add = ["iptables", ...tableArgs(table), "-A", ...ruleArgs];
    const checked = process.runRoot(check, { allowFailure: true });
    if (checked.exitCode !== 0) {
      process.runRoot(add);
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
    const checked = process.runRoot(check, { allowFailure: true });
    if (checked.exitCode !== 0) {
      process.runRoot(insert);
    }
  };

  const deleteIptablesRule = (table: string | null, ruleArgs: string[]): void => {
    const remove = ["iptables", ...tableArgs(table), "-D", ...ruleArgs];
    process.runRoot(remove, { allowFailure: true });
  };

  const getDefaultHostIface = (): string => {
    const result = process.run(["ip", "-j", "route", "list", "default"]);
    const routes = JSON.parse(result.stdout) as Array<{ dev?: string }>;
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
    ensureIptablesRuleInserted(null, "FORWARD", 1, [
      "-i",
      config.tapDev,
      "-o",
      "tap-vm+",
      "-j",
      "DROP",
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
      hostAllowedTcpPort,
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

  const teardownHostNetwork = async (config: NetworkConfig, hostIface: string): Promise<void> => {
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
      "FORWARD",
      "-i",
      config.tapDev,
      "-o",
      "tap-vm+",
      "-j",
      "DROP",
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
      hostAllowedTcpPort,
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
    process.runRoot(["ip", "link", "del", config.tapDev], { allowFailure: true });
  };

  return {
    getDefaultHostIface,
    setupHostNetwork,
    teardownHostNetwork,
  };
};
