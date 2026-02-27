import type { Command as CommanderCommand } from "commander";
import { parseHelpInput, type HelpCommandParams } from "./input";
import { handleHelp } from "./handler";

type HelpTopic = {
  topic: string;
  summary: string;
  usage: string;
};

const commandSummary = (command: CommanderCommand): string =>
  command.summary() || command.description();

const commandUsage = (command: CommanderCommand): string => {
  const usage = command.usage().trim();
  return usage ? `microvm ${command.name()} ${usage}`.trim() : `microvm ${command.name()}`;
};

const listHelpTopics = (program: CommanderCommand): HelpTopic[] =>
  program.commands.map((command) => ({
    topic: command.name(),
    summary: commandSummary(command),
    usage: commandUsage(command),
  }));

const findCommand = (program: CommanderCommand, topic: string): CommanderCommand | undefined =>
  program.commands.find((command) => command.name() === topic);

export const registerHelpCommand = (program: CommanderCommand): void => {
  const command = program.command("help [command]");
  command.summary("Show top-level or command help");
  command.description("Show top-level help or detailed help for a specific command.");
  command.option("--json [value]", "Emit JSON output for scripting");
  command.action(async (topic: string | undefined, options: Omit<HelpCommandParams, "topic">) => {
    const input = parseHelpInput({
      ...(topic === undefined ? {} : { topic }),
      ...(options.json === undefined ? {} : { json: options.json }),
    });
    await handleHelp(input, {
      topics: listHelpTopics(program),
      outputRootHelp: () => program.outputHelp(),
      outputCommandHelp: (commandTopic) => {
        const target = findCommand(program, commandTopic);
        if (!target) {
          return false;
        }

        target.outputHelp();
        return true;
      },
    });
  });
};
