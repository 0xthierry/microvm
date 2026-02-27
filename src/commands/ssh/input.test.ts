import { describe, expect, it } from "bun:test";
import { parseSshInput } from "./input";

const params = (
  overrides: Partial<{
    idOrName: string;
    command: string[];
    json: string | boolean;
  }> = {},
) => ({
  idOrName: overrides.idOrName ?? "vm-test",
  ...overrides,
});

describe("parseSshInput", () => {
  it("joins the trailing command payload into a single string", () => {
    const input = parseSshInput(
      params({
        command: ["echo", "hello", "from", "guest"],
      }),
    );

    expect(input).toEqual({
      nameOrId: "vm-test",
      command: "echo hello from guest",
      outputJson: false,
    });
  });

  it("omits the command when only the vm ref is provided", () => {
    const input = parseSshInput(params());

    expect(input).toEqual({
      nameOrId: "vm-test",
      outputJson: false,
    });
  });
});
