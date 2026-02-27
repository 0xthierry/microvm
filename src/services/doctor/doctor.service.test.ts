import { describe, expect, it } from "bun:test";
import { DoctorService } from "./doctor.service";

describe("DoctorService", () => {
  it("returns structured check results", () => {
    const service = new DoctorService();
    const checks = service.runChecks();

    expect(Array.isArray(checks)).toBe(true);
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.some((check) => check.name === "kvm")).toBe(true);
  });
});
