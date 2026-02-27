import process from "node:process";
import { AppError } from "../errors/app-error";

export type ProcessRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export class ProcessSpawnFailedError extends AppError {
  constructor(params: {
    args: string[];
    cause?: unknown;
  }) {
    super(`Command spawn failed: ${params.args.join(" ")}`, {
      cause: params.cause,
      details: {
        args: params.args,
      },
    });
  }
}

export class ProcessRunFailedError extends AppError {
  constructor(params: {
    args: string[];
    exitCode: number;
    stdout: string;
    stderr: string;
    cause?: unknown;
  }) {
    const output = [params.stderr, params.stdout].filter(Boolean).join("\n");
    super(`Command failed (${params.exitCode}): ${params.args.join(" ")}${output ? `\n${output}` : ""}`, {
      cause: params.cause,
      details: {
        args: params.args,
        exitCode: params.exitCode,
        stdout: params.stdout,
        stderr: params.stderr,
      },
    });
  }
}

export class ProcessRunner {
  private readonly decoder = new TextDecoder();
  private readonly cwd: string;

  constructor(options: { cwd?: string } = {}) {
    this.cwd = options.cwd ?? process.cwd();
  }

  run(
    args: string[],
    options: {
      allowFailure?: boolean;
      inherit?: boolean;
    } = {},
  ): ProcessRunResult {
    const allowFailure = options.allowFailure ?? false;
    const inherit = options.inherit ?? false;

    let result: ReturnType<typeof Bun.spawnSync>;
    try {
      result = Bun.spawnSync(args, {
        cwd: this.cwd,
        stdin: inherit ? "inherit" : "ignore",
        stdout: inherit ? "inherit" : "pipe",
        stderr: inherit ? "inherit" : "pipe",
      });
    } catch (cause) {
      throw new ProcessSpawnFailedError({ args, cause });
    }

    const output: ProcessRunResult = {
      exitCode: result.exitCode ?? 1,
      stdout: result.stdout ? this.decoder.decode(result.stdout).trim() : "",
      stderr: result.stderr ? this.decoder.decode(result.stderr).trim() : "",
    };

    if (output.exitCode !== 0 && !allowFailure) {
      throw new ProcessRunFailedError({
        args,
        exitCode: output.exitCode,
        stdout: output.stdout,
        stderr: output.stderr,
      });
    }

    return output;
  }

  runRoot(
    args: string[],
    options: {
      allowFailure?: boolean;
      inherit?: boolean;
    } = {},
  ): ProcessRunResult {
    return this.run(this.isRoot() ? args : ["sudo", ...args], options);
  }

  spawnInherit(args: string[]): number {
    try {
      const result = Bun.spawnSync(args, {
        cwd: this.cwd,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      return result.exitCode ?? 1;
    } catch {
      return 1;
    }
  }

  isRoot(): boolean {
    return typeof process.getuid === "function" ? process.getuid() === 0 : false;
  }

  targetUser(): string {
    return process.env["SUDO_USER"] ?? process.env["USER"] ?? "root";
  }

  shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
  }

  shellJoin(args: string[]): string {
    return args.map((arg) => this.shellQuote(arg)).join(" ");
  }
}

export const processRunner = new ProcessRunner();
