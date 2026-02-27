import { describe, expect, it } from "bun:test";
import { HostService } from "./host.service";
import {
  HostDependencyMissingError,
  HostKvmAccessDeniedError,
} from "./errors";

describe("HostService", () => {
  it("fails when up dependency is missing", () => {
    const service = new HostService({
      ensureDirs: () => undefined,
      commandExists: () => false,
      hasKvmAccess: () => true,
      ensureSudoSession: () => undefined,
    } as any);

    expect(() => service.prepareUpEnvironment()).toThrow(HostDependencyMissingError);
  });

  it("fails when kvm access is denied", () => {
    const service = new HostService({
      ensureDirs: () => undefined,
      commandExists: () => true,
      hasKvmAccess: () => false,
      ensureSudoSession: () => undefined,
    } as any);

    expect(() => service.ensureKvmAccess()).toThrow(HostKvmAccessDeniedError);
  });
});
