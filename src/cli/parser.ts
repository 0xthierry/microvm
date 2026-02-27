import type { ParsedArgs } from "./command";

export const parseArgs = (args: string[]): ParsedArgs => {
  const positionals: string[] = [];
  const flags = new Map<string, string | boolean>();

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const eq = token.indexOf("=");
    const key = eq >= 0 ? token.slice(2, eq) : token.slice(2);
    if (!key) {
      throw new Error(`Invalid flag syntax: ${token}`);
    }
    if (flags.has(key)) {
      throw new Error(`Flag provided more than once: --${key}`);
    }

    if (eq >= 0) {
      flags.set(key, token.slice(eq + 1));
      continue;
    }
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(key, next);
      index += 1;
      continue;
    }
    flags.set(key, true);
  }

  return { positionals, flags };
};
