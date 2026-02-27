import { Command } from "./command";

export class CommandRegistry {
  private readonly commands: Command<any, any>[] = [];
  private readonly byToken = new Map<string, Command<any, any>>();

  register(command: Command<any, any>): void {
    const tokens = [command.name, ...command.aliases];
    for (const token of tokens) {
      if (this.byToken.has(token)) {
        throw new Error(`Command token is already registered: ${token}`);
      }
    }

    this.commands.push(command);
    for (const token of tokens) {
      this.byToken.set(token, command);
    }
  }

  resolve(token: string): Command<any, any> | undefined {
    return this.byToken.get(token);
  }

  renderHelp(extraNotes: string[] = []): string {
    const usageLines = this.commands
      .filter((command) => command.showInHelp)
      .map((command) => `  ${command.usage}${command.summary ? `   # ${command.summary}` : ""}`);

    const notesBlock = extraNotes.length > 0
      ? `\n\nNotes:\n${extraNotes.map((note) => `  - ${note}`).join("\n")}`
      : "";

    return `Usage:\n${usageLines.join("\n")}${notesBlock}`;
  }
}
