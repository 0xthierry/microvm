import { doctorService } from "../../services/doctor/doctor.service";
import { formatDoctorChecks, formatHeading } from "../../lib/terminal-output";
import type { DoctorInput } from "./input";

export const handleDoctor = async (input: DoctorInput): Promise<void> => {
  const checks = doctorService.runChecks();
  const failing = checks.filter((check) => !check.ok);
  process.exitCode = failing.length === 0 ? 0 : 1;

  if (input.outputJson) {
    console.log(
      JSON.stringify(
        {
          command: "doctor",
          healthy: failing.length === 0,
          failingCount: failing.length,
          checks,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log([formatHeading("Doctor checks"), "", formatDoctorChecks(checks)].join("\n"));

  if (failing.length === 0) {
    console.log("[microvm] Host is ready.");
    return;
  }

  console.log("[microvm] Host is not ready. Fix the failing checks and rerun `microvm doctor`.");
};
