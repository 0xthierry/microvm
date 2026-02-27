import type { Command as CommanderCommand } from "commander";
import { parseDoctorInput, type DoctorCommandOptions } from "./input";
import { handleDoctor } from "./handler";

export const registerDoctorCommand = (program: CommanderCommand): void => {
  const command = program.command("doctor");
  command.summary("Check host prerequisites");
  command.description("Check current host prerequisites and exit non-zero when the host is not ready.");
  command.option("--json [value]", "Emit JSON output for scripting");
  command.action(async (options: DoctorCommandOptions) => {
    const input = parseDoctorInput(options);
    await handleDoctor(input);
  });
};
