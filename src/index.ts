#!/usr/bin/env bun

import { registerCommands } from "./commands/register";
import { runCli } from "./cli/program";

const exitCode = await runCli(process.argv.slice(2), {
  register: registerCommands,
});
if (exitCode !== 0) {
  process.exit(exitCode);
}
