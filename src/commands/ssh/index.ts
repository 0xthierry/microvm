import type { Command as CommanderCommand } from "commander";
import { parseSshInput, type SshCommandParams } from "./input";
import { handleSsh } from "./handler";

export const registerSshCommand = (program: CommanderCommand): void => {
  const command = program.command("ssh <idOrName> [command...]");
  command.summary("Open SSH or execute a remote command");
  command.description(
    "Without a command, open an interactive SSH session. With a command, execute it remotely over SSH.",
  );
  command.allowUnknownOption();
  command.option("--json [value]", "Emit JSON output for scripting");
  command.action(
    async (
      idOrName: string,
      commandParts: string[] | undefined,
      options: Omit<SshCommandParams, "idOrName" | "command">,
    ) => {
      const input = parseSshInput({
        idOrName,
        ...(commandParts === undefined ? {} : { command: commandParts }),
        ...(options.json === undefined ? {} : { json: options.json }),
      });
      await handleSsh(input);
    },
  );
};
