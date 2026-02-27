import type { CommandMiddleware } from "../../cli/command";
import type { VmIdPolicyService } from "../../services/vm-id-policy";

export const assertVmIdMiddleware = (
  vmIdPolicy: VmIdPolicyService,
): CommandMiddleware => ({ parsed }) => {
  const vmId = vmIdPolicy.normalizeVmId(parsed.positionals[0]);
  vmIdPolicy.assertVmId(vmId);
};

export const assertJailerSafeVmIdMiddleware = (
  vmIdPolicy: VmIdPolicyService,
): CommandMiddleware => ({ parsed }) => {
  const vmId = vmIdPolicy.normalizeVmId(parsed.positionals[0]);
  vmIdPolicy.assertJailerSafeVmId(vmId);
};

export const assertJailerSocketPathLengthMiddleware = (
  vmIdPolicy: VmIdPolicyService,
): CommandMiddleware => ({ parsed }) => {
  const vmId = vmIdPolicy.normalizeVmId(parsed.positionals[0]);
  vmIdPolicy.assertJailerSocketPathLength(vmId);
};
