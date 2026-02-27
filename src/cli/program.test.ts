import { describe, expect, it } from "bun:test";
import { registerCommands } from "../commands/register";
import { createCliProgram, runCli } from "./program";

// eslint-disable-next-line no-control-regex
const stripAnsi = (value: string): string => value.replace(/\u001B\[[0-9;]*m/g, "");

const createCapturedOutput = () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    stdout,
    stderr,
    output: {
      stdout: (message: string) => {
        stdout.push(message);
      },
      stderr: (message: string) => {
        stderr.push(message);
      },
    },
  };
};

describe("runCli", () => {
  it("defaults to the grouped root help overview when no argv is provided", async () => {
    const captured = createCapturedOutput();

    const exitCode = await runCli([], {
      output: captured.output,
      register: registerCommands,
    });

    expect(exitCode).toBe(0);
    const stdout = stripAnsi(captured.stdout.join(""));
    expect(stdout).toContain("microvm");
    expect(stdout).toContain("Firecracker microVM orchestration CLI");
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("microvm [options] [command]");
    expect(stdout).toContain("create");
    expect(stdout).toContain("delete");
    expect(stdout).toContain("ssh");
    expect(stdout).toContain("doctor");
    expect(stdout).toContain("help");
    expect(stdout).toContain("<command> --help");
    expect(stdout.endsWith("\n")).toBe(true);
  });

  it("supports the explicit help command for a specific topic", async () => {
    const captured = createCapturedOutput();

    const exitCode = await runCli(["help", "status"], {
      output: captured.output,
      register: registerCommands,
    });

    expect(exitCode).toBe(0);
    const stdout = stripAnsi(captured.stdout.join(""));
    expect(stdout).toContain("Usage: microvm status");
    expect(stdout).toContain("Show stored VM configuration and tracked runtime metadata.");
    expect(stdout).toContain("--json");
  });

  it("supports Commander-generated command help", async () => {
    const captured = createCapturedOutput();

    const exitCode = await runCli(["status", "--help"], {
      output: captured.output,
      register: registerCommands,
    });

    expect(exitCode).toBe(0);
    const stdout = stripAnsi(captured.stdout.join(""));
    expect(stdout).toContain("Usage: microvm status");
    expect(stdout).toContain("Show stored VM configuration and tracked runtime metadata.");
    expect(stdout).toContain("--json");
  });

  it("surfaces invalid option failures from Commander", async () => {
    const captured = createCapturedOutput();

    const exitCode = await runCli(["status", "vm-test", "--bogus"], {
      output: captured.output,
      register: registerCommands,
    });

    expect(exitCode).toBe(1);
    const stderr = stripAnsi(captured.stderr.join(""));
    expect(stderr).toContain("error: unknown option '--bogus'");
    expect(stderr).toContain("(run with --help for usage)");
  });

  it("does not show the usage hint for unknown commands", async () => {
    const captured = createCapturedOutput();

    const exitCode = await runCli(["as"], {
      output: captured.output,
      register: registerCommands,
    });

    expect(exitCode).toBe(1);
    const stderr = stripAnsi(captured.stderr.join(""));
    expect(stderr).toContain("error: unknown command 'as'");
    expect(stderr).not.toContain("(run with --help for usage)");
  });

  it("formats unknown-command suggestions inline", async () => {
    const captured = createCapturedOutput();

    const exitCode = await runCli(["crea"], {
      output: captured.output,
      register: registerCommands,
    });

    expect(exitCode).toBe(1);
    const stderr = stripAnsi(captured.stderr.join(""));
    expect(stderr).toContain("error: unknown command 'crea'. Did you mean 'create'?");
    expect(stderr).not.toContain("(Did you mean create?)");
  });

  it("surfaces Commander required option failures before command handlers run", async () => {
    const captured = createCapturedOutput();

    const exitCode = await runCli(["create"], {
      output: captured.output,
      register: registerCommands,
    });

    expect(exitCode).toBe(1);
    const stderr = stripAnsi(captured.stderr.join(""));
    expect(stderr).toContain("error: required option '--name <name>' not specified");
  });

  it("surfaces create dockerfile requirement before command handlers run", async () => {
    const captured = createCapturedOutput();

    const exitCode = await runCli(["create", "--name", "vm-test"], {
      output: captured.output,
      register: registerCommands,
    });

    expect(exitCode).toBe(1);
    const stderr = stripAnsi(captured.stderr.join(""));
    expect(stderr).toContain("error: required option '--dockerfile <path>' not specified");
  });

  it("surfaces Commander option conflict failures before command handlers run", async () => {
    const captured = createCapturedOutput();

    const exitCode = await runCli(["set", "vm-test", "--disk-mib", "1024", "--disk-gib", "2"], {
      output: captured.output,
      register: registerCommands,
    });

    expect(exitCode).toBe(1);
    const stderr = stripAnsi(captured.stderr.join(""));
    expect(stderr).toContain(
      "error: option '--disk-mib <size>' cannot be used with option '--disk-gib <size>'",
    );
  });

  it("surfaces Commander argument parser failures for positive integers", async () => {
    const captured = createCapturedOutput();

    const exitCode = await runCli(["create", "--name", "vm-test", "--cpus", "abc"], {
      output: captured.output,
      register: registerCommands,
    });

    expect(exitCode).toBe(1);
    const stderr = stripAnsi(captured.stderr.join(""));
    expect(stderr).toContain("error:");
    expect(stderr).toContain('Flag --cpus expects a positive integer, got "abc".');
  });

  it("formats AppError instances through formatCliError", async () => {
    const captured = createCapturedOutput();

    const exitCode = await runCli(["help", "bogus"], {
      output: captured.output,
      register: registerCommands,
    });

    expect(exitCode).toBe(1);
    const stderr = stripAnsi(captured.stderr.join(""));
    expect(stderr).toContain("error: Unknown help topic: bogus");
    expect(stderr).toContain("hint: Run `microvm help` to list available commands.");
  });

  it("registers --json on every top-level command", () => {
    const program = createCliProgram();
    registerCommands(program);

    for (const command of program.commands) {
      const jsonOption = command.options.find((option) => option.long === "--json");
      expect(jsonOption).toBeDefined();
    }
  });
});
