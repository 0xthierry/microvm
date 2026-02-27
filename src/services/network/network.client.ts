import { z } from "zod";
import { getAppConfig } from "../../config/runtime-context";
import { processRunner } from "../../lib/process/process-runner";
import { NetworkDefaultInterfaceNotFoundError } from "./errors";

export type NetworkRuntime = {
  vmId: string;
  tapDev: string;
  hostIp: string;
  guestIp: string;
  maskBits: string;
  hostIface?: string;
};

type IptablesTable = "nat" | null;

type RuleId =
  | "AllowVmOutboundViaHostNat"
  | "AllowVmForwardToHostUplink"
  | "AllowHostToVmEstablishedTraffic"
  | "DenyVmToVmTraffic"
  | "AllowVmToHostEstablishedTraffic"
  | "AllowVmToHostServicePort"
  | "DenyVmToHostOtherTraffic";

type RuleDefinition = {
  id: RuleId;
  description: string;
  table: IptablesTable;
  chain: string;
  args: string[];
  position?: number;
};

export const NETWORK_RULE_CATALOG: ReadonlyArray<{
  id: RuleId;
  description: string;
}> = [
  {
    id: "AllowVmOutboundViaHostNat",
    description: "Allow VM egress traffic to host uplink using NAT masquerade.",
  },
  {
    id: "AllowVmForwardToHostUplink",
    description: "Allow VM forwarded traffic out through host uplink.",
  },
  {
    id: "AllowHostToVmEstablishedTraffic",
    description: "Allow return traffic from host uplink back to VM for established flows.",
  },
  {
    id: "DenyVmToVmTraffic",
    description: "Deny VM-to-VM forwarding between tap devices.",
  },
  {
    id: "AllowVmToHostEstablishedTraffic",
    description: "Allow established reply traffic from VM to host services.",
  },
  {
    id: "AllowVmToHostServicePort",
    description: "Allow VM ingress to configured host service TCP port.",
  },
  {
    id: "DenyVmToHostOtherTraffic",
    description: "Deny all other VM-to-host ingress traffic.",
  },
] as const;

const tableArgs = (table: IptablesTable): string[] =>
  table ? ["-t", table] : [];

export class NetworkClient {
  private readonly hostAllowedTcpPort = getAppConfig().defaults.network.hostAllowedTcpPort;

  getDefaultHostIface(): string {
    const result = processRunner.run(["ip", "-j", "route", "list", "default"]);
    const payload = JSON.parse(result.stdout) as unknown;
    const routes = z.array(z.object({ dev: z.string().optional() })).parse(payload);
    const dev = routes[0]?.dev;

    if (!dev) {
      throw new NetworkDefaultInterfaceNotFoundError();
    }

    return dev;
  }

  ensureTapDevice(runtime: NetworkRuntime): void {
    processRunner.runRoot(["ip", "link", "del", runtime.tapDev], {
      allowFailure: true,
    });
    processRunner.runRoot([
      "ip",
      "tuntap",
      "add",
      "dev",
      runtime.tapDev,
      "mode",
      "tap",
      "user",
      processRunner.targetUser(),
    ]);
    processRunner.runRoot([
      "ip",
      "addr",
      "add",
      `${runtime.hostIp}/${runtime.maskBits}`,
      "dev",
      runtime.tapDev,
    ]);
    processRunner.runRoot(["ip", "link", "set", "dev", runtime.tapDev, "up"]);
    processRunner.runRoot(["sysctl", "-w", "net.ipv4.ip_forward=1"]);
  }

  removeTapDevice(tapDev: string): void {
    processRunner.runRoot(["ip", "link", "del", tapDev], {
      allowFailure: true,
    });
  }

  applyRules(runtime: NetworkRuntime): string {
    const hostIface = this.resolveHostIface(runtime.hostIface);
    const rules = this.ruleCatalog(runtime, hostIface);
    for (const rule of rules) {
      this.applyRule(rule);
    }
    return hostIface;
  }

  removeRules(runtime: NetworkRuntime): void {
    const hostIface = this.resolveHostIface(runtime.hostIface);
    const rules = this.ruleCatalog(runtime, hostIface).reverse();
    for (const rule of rules) {
      this.removeRule(rule);
    }
  }

  private ruleCatalog(runtime: NetworkRuntime, hostIface: string): RuleDefinition[] {
    return [
      {
        id: "AllowVmOutboundViaHostNat",
        description: "Allow VM egress traffic to host uplink using NAT masquerade.",
        table: "nat",
        chain: "POSTROUTING",
        args: ["-s", runtime.guestIp, "-o", hostIface, "-j", "MASQUERADE"],
      },
      {
        id: "AllowVmForwardToHostUplink",
        description: "Allow VM forwarded traffic out through host uplink.",
        table: null,
        chain: "FORWARD",
        args: ["-i", runtime.tapDev, "-o", hostIface, "-j", "ACCEPT"],
      },
      {
        id: "AllowHostToVmEstablishedTraffic",
        description: "Allow return traffic from host uplink back to VM for established flows.",
        table: null,
        chain: "FORWARD",
        args: [
          "-i",
          hostIface,
          "-o",
          runtime.tapDev,
          "-m",
          "conntrack",
          "--ctstate",
          "RELATED,ESTABLISHED",
          "-j",
          "ACCEPT",
        ],
      },
      {
        id: "DenyVmToVmTraffic",
        description: "Deny VM-to-VM forwarding between tap devices.",
        table: null,
        chain: "FORWARD",
        position: 1,
        args: ["-i", runtime.tapDev, "-o", "tap-vm+", "-j", "DROP"],
      },
      {
        id: "AllowVmToHostEstablishedTraffic",
        description: "Allow established reply traffic from VM to host services.",
        table: null,
        chain: "INPUT",
        position: 1,
        args: [
          "-i",
          runtime.tapDev,
          "-s",
          runtime.guestIp,
          "-m",
          "conntrack",
          "--ctstate",
          "RELATED,ESTABLISHED",
          "-j",
          "ACCEPT",
        ],
      },
      {
        id: "AllowVmToHostServicePort",
        description: "Allow VM ingress to configured host service TCP port.",
        table: null,
        chain: "INPUT",
        position: 2,
        args: [
          "-i",
          runtime.tapDev,
          "-s",
          runtime.guestIp,
          "-p",
          "tcp",
          "--dport",
          this.hostAllowedTcpPort,
          "-j",
          "ACCEPT",
        ],
      },
      {
        id: "DenyVmToHostOtherTraffic",
        description: "Deny all other VM-to-host ingress traffic.",
        table: null,
        chain: "INPUT",
        position: 3,
        args: ["-i", runtime.tapDev, "-s", runtime.guestIp, "-j", "DROP"],
      },
    ];
  }

  private applyRule(rule: RuleDefinition): void {
    const check = [
      "iptables",
      ...tableArgs(rule.table),
      "-C",
      rule.chain,
      ...rule.args,
    ];
    const checked = processRunner.runRoot(check, {
      allowFailure: true,
    });

    if (checked.exitCode === 0) {
      return;
    }

    const mode = rule.position ? "-I" : "-A";
    const insertArgs = rule.position
      ? [String(rule.position), ...rule.args]
      : rule.args;

    processRunner.runRoot([
      "iptables",
      ...tableArgs(rule.table),
      mode,
      rule.chain,
      ...insertArgs,
    ]);
  }

  private removeRule(rule: RuleDefinition): void {
    processRunner.runRoot([
      "iptables",
      ...tableArgs(rule.table),
      "-D",
      rule.chain,
      ...rule.args,
    ], {
      allowFailure: true,
    });
  }

  private resolveHostIface(candidate: string | undefined): string {
    if (candidate && candidate.trim().length > 0) {
      return candidate;
    }
    return this.getDefaultHostIface();
  }
}
