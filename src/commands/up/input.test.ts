import { describe, expect, it } from "bun:test";
import { UpInputValidationError } from "./errors";
import { parseUpInput } from "./input";

const params = (
  overrides: Partial<{
    idOrName: string;
    noAttach: string | boolean;
    json: string | boolean;
  }> = {},
) => ({
  idOrName: overrides.idOrName ?? "vm-test",
  ...overrides,
});

describe("parseUpInput", () => {
  it("treats explicit string false values as false", () => {
    const input = parseUpInput(
      params({
        noAttach: "false",
        json: "false",
      }),
    );

    expect(input).toEqual({
      nameOrId: "vm-test",
      attach: true,
      outputJson: false,
    });
  });

  it("treats bare no-attach as disabling attachment", () => {
    const input = parseUpInput(
      params({
        noAttach: true,
      }),
    );

    expect(input.attach).toBe(false);
  });

  it("rejects invalid boolean values", () => {
    expect(() =>
      parseUpInput(
        params({
          json: "sometimes",
        }),
      ),
    ).toThrow(UpInputValidationError);
  });
});
