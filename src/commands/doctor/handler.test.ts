import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { doctorService, type DoctorCheckResult } from "../../services/doctor/doctor.service";
import { handleDoctor } from "./handler";

describe("handleDoctor", () => {
  afterEach(() => {
    mock.restore();
    process.exitCode = undefined;
  });

  it("renders deterministic status, check, and detail columns for human output", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    spyOn(doctorService, "runChecks").mockReturnValue([
      {
        name: "dependency:firecracker",
        ok: true,
        details: "firecracker is available.",
      },
      {
        name: "kvm",
        ok: false,
        details: "/dev/kvm is not readable/writable.",
        hint: "Enable KVM and ensure your user can read and write `/dev/kvm`.",
      },
    ] satisfies DoctorCheckResult[]);

    await handleDoctor({
      outputJson: false,
    });

    expect(logSpy).toHaveBeenCalledTimes(2);
    const output = String(logSpy.mock.calls[0]?.[0] ?? "");
    expect(output).toContain("Doctor checks");
    expect(output).toContain("Status");
    expect(output).toContain("Check");
    expect(output).toContain("Details");
    expect(output).toContain("How to fix");
    expect(output).toContain("dependency:firecracker");
    expect(output).toContain("kvm");
    expect(output).toContain("Enable KVM and ensure your user can read and write `/dev/kvm`.");
    expect(String(logSpy.mock.calls[1]?.[0] ?? "")).toContain("Host is not ready. Fix the failing checks and rerun `microvm doctor`.");
    expect(process.exitCode).toBe(1);
  });

  it("keeps doctor --json free of ANSI sequences", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    spyOn(doctorService, "runChecks").mockReturnValue([
      {
        name: "dependency:firecracker",
        ok: true,
        details: "firecracker is available.",
      },
    ] satisfies DoctorCheckResult[]);

    await handleDoctor({
      outputJson: true,
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const raw = String(logSpy.mock.calls[0]?.[0] ?? "");
    expect(raw.includes("\u001B[")).toBe(false);

    const parsed = JSON.parse(raw) as {
      command?: string;
      healthy?: boolean;
      failingCount?: number;
      checks?: Array<{ name?: string; ok?: boolean; details?: string }>;
    };

    expect(parsed).toEqual({
      command: "doctor",
      healthy: true,
      failingCount: 0,
      checks: [
        {
          name: "dependency:firecracker",
          ok: true,
          details: "firecracker is available.",
        },
      ],
    });
    expect(process.exitCode).toBe(0);
  });
});
