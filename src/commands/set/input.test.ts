import { describe, expect, it } from "bun:test";
import { SetNoChangesRequestedError } from "./errors";
import { parseSetInput } from "./input";

const params = (
  overrides: Partial<{
    idOrName: string;
    cpus: number;
    memoryMib: number;
    diskMib: number;
    diskGib: number;
    sshUser: string;
    json: string | boolean;
  }> = {},
) => ({
  idOrName: overrides.idOrName ?? "vm-test",
  ...overrides,
});

describe("parseSetInput", () => {
  it("rejects set with no mutable change flags", () => {
    expect(() => parseSetInput(params())).toThrow(SetNoChangesRequestedError);
    expect(() =>
      parseSetInput(
        params({
          json: true,
        }),
      ),
    ).toThrow(SetNoChangesRequestedError);
  });

  it("parses mutable flags and optional json output", () => {
    const input = parseSetInput(
      params({
        cpus: 4,
        memoryMib: 2048,
        diskGib: 12,
        sshUser: "root",
        json: true,
      }),
    );

    expect(input.nameOrId).toBe("vm-test");
    expect(input.vcpuCount).toBe(4);
    expect(input.memSizeMib).toBe(2048);
    expect(input.diskSizeMib).toBe(12 * 1024);
    expect(input.sshUser).toBe("root");
    expect(input.outputJson).toBe(true);
  });

  it("still parses conflicting disk values when called directly without Commander", () => {
    const input = parseSetInput(
      params({
        diskMib: 1024,
        diskGib: 2,
      }),
    );

    expect(input.diskSizeMib).toBe(1024);
  });
});
