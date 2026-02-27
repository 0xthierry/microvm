import Table from "cli-table3";

type TerminalStream = {
  isTTY?: boolean;
  hasColors?: (count?: number, env?: NodeJS.ProcessEnv) => boolean;
};

type TableRow = Array<string | number>;

type VmListRow = {
  name: string;
  id: string;
  status: string;
  guestIp: string;
  firecrackerPid?: number;
};

type VmStatusField = {
  label: string;
  value: string | number;
};

type DoctorCheckRow = {
  name: string;
  ok: boolean;
  details: string;
  hint?: string;
};

type RootHelpGroup = {
  name: string;
  commands: Array<{
    term: string;
    summary: string;
  }>;
};

const ansi =
  (open: number, close: number) =>
  (input: string): string =>
    `\u001B[${open}m${input}\u001B[${close}m`;

const colorBold = ansi(1, 22);
const colorCyan = ansi(36, 39);
const colorGray = ansi(90, 39);
const colorGreen = ansi(32, 39);
const colorBlue = ansi(34, 39);
const colorMagenta = ansi(35, 39);
const colorRed = ansi(31, 39);
const colorWhite = ansi(37, 39);
const colorYellow = ansi(33, 39);

const palette = {
  accent: (input: string) => styleStdout(input, colorCyan),
  dim: (input: string) => styleStdout(input, colorGray),
  success: (input: string) => styleStdout(input, colorGreen),
  warning: (input: string) => styleStdout(input, colorYellow),
  danger: (input: string) => styleStdout(input, colorRed),
  heading: (input: string) => styleStdout(input, colorBold),
};

const stderrPalette = {
  errorPrefix: (input: string) => styleStderr(input, colorRed),
  errorMessage: (input: string) => styleStderr(input, (value) => colorBold(colorWhite(value))),
  hintPrefix: (input: string) => styleStderr(input, colorCyan),
  hintMessage: (input: string) => styleStderr(input, colorGray),
};

const rootHelpGroupColors = {
  Lifecycle: colorGreen,
  Configuration: colorCyan,
  Access: colorYellow,
  Observe: colorBlue,
  Support: colorMagenta,
} as const;

const removeTerminalColorDisablers = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const nextEnv = {
    ...env,
  };

  delete nextEnv["NO_COLOR"];
  delete nextEnv["NODE_DISABLE_COLORS"];

  return nextEnv;
};

export const resolveTerminalColorsEnabled = (
  stream: TerminalStream,
  env: NodeJS.ProcessEnv = process.env,
): boolean => {
  const colorMode = env["MICROVM_COLOR"]?.toLowerCase();
  if (colorMode === "never") {
    return false;
  }
  if (colorMode === "always") {
    return true;
  }

  if (env["FORCE_COLOR"] === "0") {
    return false;
  }
  if (!stream.isTTY) {
    return false;
  }
  if (env["TERM"]?.toLowerCase() === "dumb") {
    return false;
  }
  if (typeof stream.hasColors === "function") {
    return stream.hasColors(16, removeTerminalColorDisablers(env));
  }

  return true;
};

const styleForStream = (
  stream: TerminalStream,
  input: string,
  style: (value: string) => string,
): string => (resolveTerminalColorsEnabled(stream) ? style(input) : input);

const styleStdout = (input: string, style: (value: string) => string): string =>
  styleForStream(process.stdout, input, style);

const styleStderr = (input: string, style: (value: string) => string): string =>
  styleForStream(process.stderr, input, style);

const createBorderlessTable = (params: { head?: string[]; rows: TableRow[] }): string => {
  const table = new Table({
    ...(params.head ? { head: params.head } : {}),
    style: {
      head: [],
      border: [],
      compact: true,
      "padding-left": 0,
      "padding-right": 2,
    },
    chars: {
      top: "",
      "top-mid": "",
      "top-left": "",
      "top-right": "",
      bottom: "",
      "bottom-mid": "",
      "bottom-left": "",
      "bottom-right": "",
      left: "",
      "left-mid": "",
      mid: "",
      "mid-mid": "",
      right: "",
      "right-mid": "",
      middle: "",
    },
  });

  table.push(...params.rows);
  return table.toString();
};

const formatVmStatus = (status: string): string => {
  switch (status) {
    case "running":
      return palette.success(status);
    case "starting":
    case "stopping":
      return palette.warning(status);
    case "failed":
      return palette.danger(status);
    default:
      return status;
  }
};

const formatDoctorStatus = (ok: boolean): string =>
  ok ? palette.success("OK") : palette.danger("FAIL");

export const formatHeading = (heading: string): string => palette.heading(heading);

export const formatAccentText = (value: string): string => palette.accent(value);

export const formatMutedText = (value: string): string => palette.dim(value);

export const formatWarningText = (value: string): string => palette.warning(value);

export const formatInfoLine = (label: string, value: string): string =>
  `[microvm] ${palette.accent(label)}: ${value}`;

export const formatCliErrorOutput = (message: string): string => {
  const [firstLine = "", ...rest] = message.split("\n");
  const prefix = "error:";
  const suggestionPattern = /^\(Did you mean (.+)\?\)$/;
  let firstLineMessage = firstLine.startsWith(prefix)
    ? firstLine.slice(prefix.length).trimStart()
    : firstLine;

  const formattedRest: string[] = [];
  for (const line of rest) {
    const suggestionMatch = line.match(suggestionPattern);
    if (suggestionMatch) {
      firstLineMessage = `${firstLineMessage}. Did you mean '${suggestionMatch[1]}'?`;
      continue;
    }

    const hintPrefix = "hint:";
    if (!line.startsWith(hintPrefix)) {
      formattedRest.push(line);
      continue;
    }

    formattedRest.push(
      `${stderrPalette.hintPrefix("hint:")} ${stderrPalette.hintMessage(line.slice(hintPrefix.length).trimStart())}`,
    );
  }

  const formattedFirstLine = `${stderrPalette.errorPrefix(prefix)} ${stderrPalette.errorMessage(firstLineMessage)}`;

  if (formattedRest.length === 0) {
    return formattedFirstLine;
  }

  return [formattedFirstLine, ...formattedRest].join("\n");
};

const formatRootCommandTerm = (term: string, groupName: string): string => {
  const [commandName = "", ...rest] = term.split(" ");
  const groupColor =
    rootHelpGroupColors[groupName as keyof typeof rootHelpGroupColors] ?? colorCyan;

  const styledCommandName = styleStdout(commandName, (value) => colorBold(groupColor(value)));
  if (rest.length === 0) {
    return styledCommandName;
  }

  return `${styledCommandName} ${formatMutedText(rest.join(" "))}`;
};

export const formatRootHelpOverview = (params: {
  name: string;
  description: string;
  usage: string;
  groups: RootHelpGroup[];
}): string => {
  const commandSections = params.groups
    .map((group) =>
      createBorderlessTable({
        rows: group.commands.map((command) => [
          formatRootCommandTerm(command.term, group.name),
          command.summary,
        ]),
      }),
    )
    .filter((section) => section.length > 0);

  const footerTable = createBorderlessTable({
    rows: [
      [
        `${formatWarningText("<command>")} ${formatAccentText("--help")}`,
        "Print help text for command.",
      ],
    ],
  });

  return (
    [
      formatHeading(params.name),
      formatMutedText(params.description),
      "",
      `${formatHeading("Usage:")} ${params.usage}`,
      "",
      ...commandSections.flatMap((section, index) => (index === 0 ? [section] : ["", section])),
      "",
      footerTable,
    ].join("\n") + "\n"
  );
};

export const formatHelpOverview = (params: {
  usage: string;
  options: Array<{ flags: string; description: string }>;
  topics: Array<{ topic: string; summary: string }>;
}): string => {
  const optionsTable = createBorderlessTable({
    rows: params.options.map((option) => [option.flags, option.description]),
  });

  const commandTable = createBorderlessTable({
    head: ["Command", "Summary"],
    rows: params.topics.map((topic) => [topic.topic, topic.summary]),
  });

  return [
    formatHeading("microvm"),
    palette.dim("Manage Firecracker microVMs."),
    "",
    formatHeading("Usage"),
    "",
    params.usage,
    "",
    formatHeading("Options"),
    "",
    optionsTable,
    "",
    formatHeading("Commands"),
    "",
    commandTable,
    "",
    palette.dim("Run `microvm help <command>` or `microvm <command> --help` for details."),
  ].join("\n");
};

export const formatVmList = (vms: VmListRow[]): string =>
  createBorderlessTable({
    head: ["Name", "ID", "Status", "Guest IP", "PID"],
    rows: vms.map((vm) => [
      vm.name,
      vm.id,
      formatVmStatus(vm.status),
      vm.guestIp,
      vm.firecrackerPid ?? "-",
    ]),
  });

export const formatVmDetails = (params: {
  title: string;
  fields: VmStatusField[];
  runtimeFields?: VmStatusField[];
}): string => {
  const sections = [
    formatHeading(params.title),
    "",
    createBorderlessTable({
      rows: params.fields.map((field) => [palette.dim(field.label), String(field.value)]),
    }),
  ];

  if (params.runtimeFields && params.runtimeFields.length > 0) {
    sections.push(
      "",
      formatHeading("Runtime"),
      "",
      createBorderlessTable({
        rows: params.runtimeFields.map((field) => [palette.dim(field.label), String(field.value)]),
      }),
    );
  }

  return sections.join("\n");
};

export const formatDoctorChecks = (checks: DoctorCheckRow[]): string =>
  createBorderlessTable({
    head: checks.some((check) => check.hint) ? ["Status", "Check", "Details", "How to fix"] : ["Status", "Check", "Details"],
    rows: checks.map((check) =>
      checks.some((candidate) => candidate.hint)
        ? [formatDoctorStatus(check.ok), check.name, check.details, check.hint ?? "-"]
        : [formatDoctorStatus(check.ok), check.name, check.details]),
  });
