import { existsSync } from "node:fs";
import { processRunner } from "../../lib/process/process-runner";
import { DoctorCheckFailedError } from "./errors";

export type DoctorCheckResult = {
  name: string;
  ok: boolean;
  details: string;
  hint?: string;
};

export class DoctorService {
  runChecks(): DoctorCheckResult[] {
    try {
      const requiredBinaries = [
        "firecracker",
        "jailer",
        "curl",
        "ip",
        "iptables",
        "ssh",
      ];

      const binaryChecks: DoctorCheckResult[] = requiredBinaries.map((binary) => {
        const result = processRunner.run(
          ["bash", "-lc", `command -v -- ${processRunner.shellQuote(binary)}`],
          { allowFailure: true },
        );

        return {
          name: `dependency:${binary}`,
          ok: result.exitCode === 0,
          details: result.exitCode === 0
            ? `${binary} is available.`
            : `${binary} is missing.`,
          ...(result.exitCode === 0
            ? {}
            : { hint: `Install ${binary} and ensure \`${binary}\` is on PATH.` }),
        };
      });

      const kvmOk = existsSync("/dev/kvm")
        && processRunner.run(["bash", "-lc", "[ -r /dev/kvm ] && [ -w /dev/kvm ]"], {
          allowFailure: true,
        }).exitCode === 0;

      const cgroupV2 = existsSync("/sys/fs/cgroup/cgroup.controllers");

      return [
        ...binaryChecks,
        {
          name: "kvm",
          ok: kvmOk,
          details: kvmOk
            ? "/dev/kvm is accessible."
            : "/dev/kvm is not readable/writable.",
          ...(kvmOk
            ? {}
            : { hint: "Enable KVM and ensure your user can read and write `/dev/kvm`." }),
        },
        {
          name: "cgroup_v2",
          ok: cgroupV2,
          details: cgroupV2
            ? "cgroup v2 is available."
            : "cgroup v2 is unavailable.",
          ...(cgroupV2
            ? {}
            : { hint: "Use a Linux host with cgroup v2 enabled." }),
        },
      ];
    } catch (cause) {
      throw new DoctorCheckFailedError({
        message: "Failed to run doctor checks.",
        cause,
      });
    }
  }
}

export const doctorService = new DoctorService();
