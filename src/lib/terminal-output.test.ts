import { describe, expect, it } from "bun:test";
import { resolveTerminalColorsEnabled } from "./terminal-output";

type MockStream = {
  isTTY?: boolean;
  hasColors?: (count?: number, env?: NodeJS.ProcessEnv) => boolean;
};

describe("resolveTerminalColorsEnabled", () => {
  it("enables colors when explicitly forced", () => {
    const stream: MockStream = {
      isTTY: false,
    };

    expect(
      resolveTerminalColorsEnabled(stream, {
        MICROVM_COLOR: "always",
      }),
    ).toBe(true);
  });

  it("disables colors when explicitly turned off", () => {
    const stream: MockStream = {
      isTTY: true,
      hasColors: () => true,
    };

    expect(
      resolveTerminalColorsEnabled(stream, {
        MICROVM_COLOR: "never",
      }),
    ).toBe(false);
  });

  it("disables colors for non-interactive output", () => {
    const stream: MockStream = {
      isTTY: false,
      hasColors: () => true,
    };

    expect(resolveTerminalColorsEnabled(stream, {})).toBe(false);
  });

  it("ignores inherited NO_COLOR when the terminal supports colors", () => {
    const stream: MockStream = {
      isTTY: true,
      hasColors: (_count, env) => env?.["NO_COLOR"] === undefined,
    };

    expect(
      resolveTerminalColorsEnabled(stream, {
        NO_COLOR: "1",
        TERM: "xterm-256color",
      }),
    ).toBe(true);
  });

  it("disables colors for dumb terminals", () => {
    const stream: MockStream = {
      isTTY: true,
      hasColors: () => true,
    };

    expect(
      resolveTerminalColorsEnabled(stream, {
        TERM: "dumb",
      }),
    ).toBe(false);
  });
});
