import { ZodError, type ZodTypeAny } from "zod";

export type FlagValue = string | boolean;

export type ParsedArgs = {
  positionals: string[];
  flags: Map<string, FlagValue>;
};

type CommandExecuteInput<TPositionals extends ZodTypeAny, TFlags extends ZodTypeAny> = {
  parsed: ParsedArgs;
  positionals: ReturnType<TPositionals["parse"]>;
  flags: ReturnType<TFlags["parse"]>;
};

export type CommandMiddleware<
  TPositionals extends ZodTypeAny = ZodTypeAny,
  TFlags extends ZodTypeAny = ZodTypeAny,
> = (input: CommandExecuteInput<TPositionals, TFlags>) => void | Promise<void>;

type CommandConfig<TPositionals extends ZodTypeAny, TFlags extends ZodTypeAny> = {
  name: string;
  aliases?: string[];
  usage: string;
  summary: string;
  showInHelp?: boolean;
  schemas: {
    positionals: TPositionals;
    flags: TFlags;
  };
  middlewares?: CommandMiddleware<TPositionals, TFlags>[];
  execute: (input: CommandExecuteInput<TPositionals, TFlags>) => Promise<void>;
};

export class Command<TPositionals extends ZodTypeAny, TFlags extends ZodTypeAny> {
  readonly name: string;
  readonly aliases: string[];
  readonly usage: string;
  readonly summary: string;
  readonly showInHelp: boolean;

  private readonly positionalsSchema: TPositionals;
  private readonly flagsSchema: TFlags;
  private readonly middlewares: CommandMiddleware<TPositionals, TFlags>[];
  private readonly executeFn: CommandConfig<TPositionals, TFlags>["execute"];

  constructor(config: CommandConfig<TPositionals, TFlags>) {
    this.name = config.name;
    this.aliases = config.aliases ?? [];
    this.usage = config.usage;
    this.summary = config.summary;
    this.showInHelp = config.showInHelp ?? true;
    this.positionalsSchema = config.schemas.positionals;
    this.flagsSchema = config.schemas.flags;
    this.middlewares = config.middlewares ?? [];
    this.executeFn = config.execute;
  }

  async execute(parsed: ParsedArgs): Promise<void> {
    const flagsObject = Object.fromEntries(parsed.flags.entries());

    let positionals: ReturnType<TPositionals["parse"]>;
    try {
      positionals = this.positionalsSchema.parse(parsed.positionals);
    } catch (error) {
      throw new Error(this.formatSchemaError(error, "positionals"));
    }

    let flags: ReturnType<TFlags["parse"]>;
    try {
      flags = this.flagsSchema.parse(flagsObject);
    } catch (error) {
      throw new Error(this.formatSchemaError(error, "flags"));
    }

    const input = {
      parsed,
      positionals,
      flags,
    } as CommandExecuteInput<TPositionals, TFlags>;

    for (const middleware of this.middlewares) {
      await middleware(input);
    }

    await this.executeFn(input);
  }

  private formatSchemaError(error: unknown, field: "positionals" | "flags"): string {
    if (!(error instanceof ZodError)) {
      return `${this.name}: invalid ${field}`;
    }

    const unknownFlagIssue = error.issues.find((issue) => issue.code === "unrecognized_keys");
    if (unknownFlagIssue && "keys" in unknownFlagIssue) {
      const keys = (unknownFlagIssue.keys ?? []) as string[];
      if (keys.length > 0) {
        return `Unknown flag(s): ${keys.map((key) => `--${key}`).join(", ")}`;
      }
    }

    const firstIssue = error.issues.at(0);
    if (!firstIssue) {
      return `${this.name}: invalid ${field}`;
    }
    if (typeof firstIssue.message === "string" && firstIssue.message.length > 0) {
      return firstIssue.message;
    }
    return `${this.name}: invalid ${field}`;
  }
}
