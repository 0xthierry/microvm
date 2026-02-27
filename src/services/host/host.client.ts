import { mkdirSync } from "node:fs";
import { processRunner } from "../../lib/process/process-runner";

export class HostClient {
  ensureDirs(paths: string[]): void {
    for (const path of paths) {
      mkdirSync(path, { recursive: true });
    }
  }

  commandExists(binary: string): boolean {
    const result = processRunner.run(
      ["bash", "-lc", `command -v -- ${processRunner.shellQuote(binary)}`],
      { allowFailure: true },
    );
    return result.exitCode === 0;
  }

  hasKvmAccess(): boolean {
    const result = processRunner.run(["bash", "-lc", "[ -r /dev/kvm ] && [ -w /dev/kvm ]"], {
      allowFailure: true,
    });
    return result.exitCode === 0;
  }

  ensureSudoSession(): void {
    if (processRunner.isRoot()) {
      return;
    }
    processRunner.run(["sudo", "-v"], {
      inherit: true,
    });
  }
}
