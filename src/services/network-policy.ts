type IptablesTable = "nat" | null;

export type NetworkConfig = {
  tapDev: string;
  hostIp: string;
  guestIp: string;
  maskBits: string;
};

export type NetworkContext = {
  config: NetworkConfig;
  hostIface: string;
  hostAllowedTcpPort: string;
};

export type NetworkRule = {
  name: string;
  apply: (context: NetworkContext) => void;
  remove: (context: NetworkContext) => void;
};

export type NetworkPolicy = {
  name: string;
  rules: NetworkRule[];
};

type NetworkPolicyRuleOps = {
  ensureRule: (table: IptablesTable, ruleArgs: string[]) => void;
  insertRule: (table: IptablesTable, chain: string, position: number, matchArgs: string[]) => void;
  deleteRule: (table: IptablesTable, ruleArgs: string[]) => void;
};

const createLetVmUseHostForInternetRule = ({ ensureRule, deleteRule }: NetworkPolicyRuleOps): NetworkRule => ({
  name: "LetVmUseHostForInternetRule",
  apply: ({ config, hostIface }) => {
    ensureRule("nat", [
      "POSTROUTING",
      "-s",
      config.guestIp,
      "-o",
      hostIface,
      "-j",
      "MASQUERADE",
    ]);
  },
  remove: ({ config, hostIface }) => {
    deleteRule("nat", [
      "POSTROUTING",
      "-s",
      config.guestIp,
      "-o",
      hostIface,
      "-j",
      "MASQUERADE",
    ]);
  },
});

const createAllowVmToSendTrafficOutRule = ({ ensureRule, deleteRule }: NetworkPolicyRuleOps): NetworkRule => ({
  name: "AllowVmToSendTrafficOutRule",
  apply: ({ config, hostIface }) => {
    ensureRule(null, [
      "FORWARD",
      "-i",
      config.tapDev,
      "-o",
      hostIface,
      "-j",
      "ACCEPT",
    ]);
  },
  remove: ({ config, hostIface }) => {
    deleteRule(null, [
      "FORWARD",
      "-i",
      config.tapDev,
      "-o",
      hostIface,
      "-j",
      "ACCEPT",
    ]);
  },
});

const createAllowReturnTrafficBackToVmRule = ({ ensureRule, deleteRule }: NetworkPolicyRuleOps): NetworkRule => ({
  name: "AllowReturnTrafficBackToVmRule",
  apply: ({ config, hostIface }) => {
    ensureRule(null, [
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
  },
  remove: ({ config, hostIface }) => {
    deleteRule(null, [
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
  },
});

const createBlockTrafficBetweenVmsRule = ({ insertRule, deleteRule }: NetworkPolicyRuleOps): NetworkRule => ({
  name: "BlockTrafficBetweenVmsRule",
  apply: ({ config }) => {
    insertRule(null, "FORWARD", 1, [
      "-i",
      config.tapDev,
      "-o",
      "tap-vm+",
      "-j",
      "DROP",
    ]);
  },
  remove: ({ config }) => {
    deleteRule(null, [
      "FORWARD",
      "-i",
      config.tapDev,
      "-o",
      "tap-vm+",
      "-j",
      "DROP",
    ]);
  },
});

const createAllowOnlyReplyTrafficFromVmToHostRule = ({
  insertRule,
  deleteRule,
}: NetworkPolicyRuleOps): NetworkRule => ({
  name: "AllowOnlyReplyTrafficFromVmToHostRule",
  apply: ({ config }) => {
    insertRule(null, "INPUT", 1, [
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
  },
  remove: ({ config }) => {
    deleteRule(null, [
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
  },
});

const createAllowVmToReachHostServicePortRule = ({
  insertRule,
  deleteRule,
}: NetworkPolicyRuleOps): NetworkRule => ({
  name: "AllowVmToReachHostServicePortRule",
  apply: ({ config, hostAllowedTcpPort: port }) => {
    insertRule(null, "INPUT", 2, [
      "-i",
      config.tapDev,
      "-s",
      config.guestIp,
      "-p",
      "tcp",
      "--dport",
      port,
      "-j",
      "ACCEPT",
    ]);
  },
  remove: ({ config, hostAllowedTcpPort: port }) => {
    deleteRule(null, [
      "INPUT",
      "-i",
      config.tapDev,
      "-s",
      config.guestIp,
      "-p",
      "tcp",
      "--dport",
      port,
      "-j",
      "ACCEPT",
    ]);
  },
});

const createBlockAllOtherVmToHostTrafficRule = ({
  insertRule,
  deleteRule,
}: NetworkPolicyRuleOps): NetworkRule => ({
  name: "BlockAllOtherVmToHostTrafficRule",
  apply: ({ config }) => {
    insertRule(null, "INPUT", 3, [
      "-i",
      config.tapDev,
      "-s",
      config.guestIp,
      "-j",
      "DROP",
    ]);
  },
  remove: ({ config }) => {
    deleteRule(null, [
      "INPUT",
      "-i",
      config.tapDev,
      "-s",
      config.guestIp,
      "-j",
      "DROP",
    ]);
  },
});

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const createDefaultVmNetworkPolicy = (ops: NetworkPolicyRuleOps): NetworkPolicy => ({
  name: "DefaultVmNetworkPolicy",
  rules: [
    createLetVmUseHostForInternetRule(ops),
    createAllowVmToSendTrafficOutRule(ops),
    createAllowReturnTrafficBackToVmRule(ops),
    createBlockTrafficBetweenVmsRule(ops),
    createAllowOnlyReplyTrafficFromVmToHostRule(ops),
    createAllowVmToReachHostServicePortRule(ops),
    createBlockAllOtherVmToHostTrafficRule(ops),
  ],
});

export const applyNetworkPolicy = (policy: NetworkPolicy, context: NetworkContext): void => {
  for (const rule of policy.rules) {
    try {
      rule.apply(context);
    } catch (error) {
      throw new Error(
        `Failed to apply network rule "${rule.name}" from policy "${policy.name}": ${toErrorMessage(error)}`,
      );
    }
  }
};

export const removeNetworkPolicy = (policy: NetworkPolicy, context: NetworkContext): void => {
  for (const rule of [...policy.rules].reverse()) {
    try {
      rule.remove(context);
    } catch (error) {
      throw new Error(
        `Failed to remove network rule "${rule.name}" from policy "${policy.name}": ${toErrorMessage(error)}`,
      );
    }
  }
};
