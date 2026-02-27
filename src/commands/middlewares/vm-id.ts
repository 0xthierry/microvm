import type { CommandMiddleware } from "../../cli/command";

export const assertVmIdMiddleware = (
  normalizeVmId: (value: string | undefined) => string,
  assertVmId: (vmId: string) => void,
): CommandMiddleware => ({ parsed }) => {
  const vmId = normalizeVmId(parsed.positionals[0]);
  assertVmId(vmId);
};

export const assertJailerSafeVmIdMiddleware = (
  normalizeVmId: (value: string | undefined) => string,
  assertJailerSafeVmId: (vmId: string) => void,
): CommandMiddleware => ({ parsed }) => {
  const vmId = normalizeVmId(parsed.positionals[0]);
  assertJailerSafeVmId(vmId);
};

export const assertJailerSocketPathLengthMiddleware = (
  normalizeVmId: (value: string | undefined) => string,
  assertJailerSocketPathLength: (vmId: string) => void,
): CommandMiddleware => ({ parsed }) => {
  const vmId = normalizeVmId(parsed.positionals[0]);
  assertJailerSocketPathLength(vmId);
};
