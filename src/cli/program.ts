import {
  Argument,
  Command as CommanderCommand,
  CommanderError,
  Help as CommanderHelp,
} from "commander";
import { formatCliError } from "../lib/errors/format-cli-error";
import {
  formatAccentText,
  formatCliErrorOutput,
  formatHeading,
  formatRootHelpOverview,
  resolveTerminalColorsEnabled,
  formatWarningText,
} from "../lib/terminal-output";

type CliOutput = {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
};

const defaultOutput: CliOutput = {
  stdout: (message) => process.stdout.write(message),
  stderr: (message) => process.stderr.write(message),
};

const isHelpDisplayError = (error: CommanderError): boolean =>
  error.code === "commander.help" || error.code === "commander.helpDisplayed";

const shouldShowUsageHint = (error: CommanderError): boolean =>
  error.code !== "commander.unknownCommand";

const formatArgumentTerm = (argument: Argument): string => {
  const name = argument.name();
  if (argument.required) {
    return `<${name}>`;
  }

  if (argument.variadic) {
    return `[${name}...]`;
  }

  return `[${name}]`;
};

const formatRootCommandTerm = (command: CommanderCommand): string => {
  const args = command.registeredArguments.map((argument) => formatArgumentTerm(argument));
  return [command.name(), ...args].join(" ");
};

const formatRootHelp = (program: CommanderCommand): string => {
  const groupedCommands = new Map<string, Array<{ term: string; summary: string }>>();

  for (const command of program.commands) {
    const groupName = command.helpGroup() || "Commands";
    const groupCommands = groupedCommands.get(groupName) ?? [];
    groupCommands.push({
      term: formatRootCommandTerm(command),
      summary: command.summary() || command.description(),
    });
    groupedCommands.set(groupName, groupCommands);
  }

  return formatRootHelpOverview({
    name: program.name(),
    description: program.description(),
    usage: `${formatAccentText(program.name())} ${formatAccentText("[options]")} ${formatAccentText("[command]")}`,
    groups: Array.from(groupedCommands, ([name, commands]) => ({
      name,
      commands,
    })),
  });
};

export const createCliProgram = (output: CliOutput = defaultOutput): CommanderCommand => {
  const program = new CommanderCommand();
  program.name("microvm");
  program.description("Firecracker microVM orchestration CLI");
  program.exitOverride();
  program.helpCommand(false);
  program.enablePositionalOptions();
  program.showSuggestionAfterError();
  program.configureHelp({
    styleTitle: (title) => formatHeading(title),
    styleCommandText: (value) => formatAccentText(value),
    styleSubcommandText: (value) => formatAccentText(value),
    styleOptionText: (value) => formatAccentText(value),
    styleArgumentText: (value) => formatWarningText(value),
    formatHelp: (command, helper) => {
      if (command === program) {
        return formatRootHelp(command);
      }

      return CommanderHelp.prototype.formatHelp.call(helper, command, helper);
    },
  });
  program.configureOutput({
    writeOut: output.stdout,
    writeErr: output.stderr,
    getOutHasColors: () => resolveTerminalColorsEnabled(process.stdout),
    getErrHasColors: () => resolveTerminalColorsEnabled(process.stderr),
    outputError: (message, write) => {
      write(formatCliErrorOutput(message));
    },
  });

  return program;
};

type RunCliOptions = {
  output?: CliOutput;
  register?: (program: CommanderCommand) => void;
};

export const runCli = async (argv: string[], options: RunCliOptions = {}): Promise<number> => {
  const output = options.output ?? defaultOutput;
  const program = createCliProgram(output);
  options.register?.(program);
  const effectiveArgv = argv.length > 0 ? argv : ["--help"];

  try {
    await program.parseAsync(effectiveArgv, {
      from: "user",
    });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) {
      if (isHelpDisplayError(error)) {
        return 0;
      }

      if (shouldShowUsageHint(error)) {
        output.stderr("(run with --help for usage)\n");
      }

      return error.exitCode;
    }

    output.stderr(`${formatCliErrorOutput(formatCliError(error))}\n`);
    return 1;
  }
};
