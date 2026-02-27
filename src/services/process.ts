import process from "node:process";

import type { AppConfig } from "../config/app-config";

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type RunOptions = {
  allowFailure?: boolean;
  inherit?: boolean;
};

export type ProcessService = {
  run: (args: string[], options?: RunOptions) => CommandResult;
  runRoot: (args: string[], options?: RunOptions) => CommandResult;
  spawnInherit: (args: string[]) => number;
  shellQuote: (value: string) => string;
  shellJoin: (args: string[]) => string;
  targetUser: () => string;
  isRoot: () => boolean;
};

export const createProcessService = ({
  appConfig,
}: {
  appConfig: AppConfig;
}): ProcessService => {
  const cwd = appConfig.paths.projectRoot;
  const env = appConfig.env;
  const decoder = new TextDecoder();

  const isRoot = (): boolean => process.getuid() === 0;

  const withRoot = (args: string[]): string[] => (isRoot() ? args : ["sudo", ...args]);

  const run = (args: string[], options: RunOptions = {}): CommandResult => {
    const inherit = options.inherit ?? false;
    const proc = Bun.spawnSync(args, {
      stdin: inherit ? "inherit" : "ignore",
      stdout: inherit ? "inherit" : "pipe",
      stderr: inherit ? "inherit" : "pipe",
      cwd,
    });

    const stdout = proc.stdout ? decoder.decode(proc.stdout).trim() : "";
    const stderr = proc.stderr ? decoder.decode(proc.stderr).trim() : "";
    const result: CommandResult = {
      exitCode: proc.exitCode ?? 1,
      stdout,
      stderr,
    };

    if (result.exitCode !== 0 && !options.allowFailure) {
      const rendered = args.join(" ");
      const details = [stderr, stdout].filter(Boolean).join("\n");
      throw new Error(`Command failed (${result.exitCode}): ${rendered}${details ? `\n${details}` : ""}`);
    }

    return result;
  };

  const runRoot = (args: string[], options: RunOptions = {}): CommandResult => run(withRoot(args), options);

  const spawnInherit = (args: string[]): number => {
    const proc = Bun.spawnSync(args, {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    return proc.exitCode ?? 1;
  };

  const shellQuote = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`;

  const shellJoin = (args: string[]): string => args.map(shellQuote).join(" ");

  const targetUser = (): string => env.SUDO_USER ?? env.USER ?? "root";

  return {
    run,
    runRoot,
    spawnInherit,
    shellQuote,
    shellJoin,
    targetUser,
    isRoot,
  };
};
