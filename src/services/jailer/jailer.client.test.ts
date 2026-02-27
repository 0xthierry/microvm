import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { processRunner, type ProcessRunResult } from "../../lib/process/process-runner";
import { createTestAppConfig } from "../../test/test-app-config";
import { JailerClient } from "./jailer.client";

const ok = (): ProcessRunResult => ({
  exitCode: 0,
  stdout: "",
  stderr: "",
});

const fail = (stderr = "failed"): ProcessRunResult => ({
  exitCode: 1,
  stdout: "",
  stderr,
});

describe("JailerClient", () => {
  afterEach(() => {
    mock.restore();
  });

  it("stages VM rootfs as a hard link when possible to preserve writes across restarts", () => {
    const { config, cleanup } = createTestAppConfig();
    const client = new JailerClient();

    const vmId = "vm-hardlink";
    const rootDir = join(config.paths.jailerBaseDir, "firecracker", vmId, "root");
    const layout = {
      vmDir: join(config.paths.jailerBaseDir, "firecracker", vmId),
      rootDir,
      apiSocketHostPath: join(rootDir, config.defaults.jailer.apiSocketInJail.slice(1)),
    };

    const kernelSourcePath = join(config.paths.artifactsDir, "kernel", "vmlinux");
    const rootfsSourcePath = join(config.paths.vmsDir, vmId, "rootfs.ext4");

    mkdirSync(dirname(kernelSourcePath), { recursive: true });
    mkdirSync(dirname(rootfsSourcePath), { recursive: true });
    writeFileSync(kernelSourcePath, "kernel", "utf8");
    writeFileSync(rootfsSourcePath, "rootfs", "utf8");

    const originalRun = processRunner.run.bind(processRunner);
    const originalRunRoot = processRunner.runRoot.bind(processRunner);
    const userCalls: string[][] = [];

    (processRunner as any).run = (args: string[]) => {
      userCalls.push(args);

      if (args[0] === "rm") {
        const target = args.at(-1);
        if (target) {
          rmSync(target, {
            force: true,
            recursive: args.includes("-rf"),
          });
        }
        return ok();
      }

      if (args[0] === "ln") {
        const source = args[1];
        const target = args[2];
        if (!source || !target) {
          throw new Error(`Missing ln args: ${args.join(" ")}`);
        }
        linkSync(source, target);
        return ok();
      }

      if (args[0] === "cp") {
        const source = args[2] ?? args[1];
        const target = args[3] ?? args[2];
        if (!source || !target) {
          throw new Error(`Missing cp args: ${args.join(" ")}`);
        }
        copyFileSync(source, target);
        return ok();
      }

      throw new Error(`Unexpected run call: ${args.join(" ")}`);
    };

    (processRunner as any).runRoot = (args: string[]) => {
      if (args[0] === "chown") {
        return ok();
      }

      if (args[0] === "chmod") {
        const mode = Number.parseInt(args[1] ?? "644", 8);
        for (const target of args.slice(2)) {
          chmodSync(target, mode);
        }
        return ok();
      }

      throw new Error(`Unexpected runRoot call: ${args.join(" ")}`);
    };

    try {
      client.stageVmAssets({
        layout,
        kernelSourcePath,
        rootfsSourcePath,
        runtimeUid: "1000",
        runtimeGid: "1000",
      });

      const rootfsTargetPath = join(rootDir, config.defaults.jailer.rootfsPathInJail.slice(1));
      expect(existsSync(rootfsTargetPath)).toBe(true);
      expect(statSync(rootfsSourcePath).ino).toBe(statSync(rootfsTargetPath).ino);

      const cpCalls = userCalls.filter((args) => args[0] === "cp");
      expect(cpCalls.length).toBe(0);
    } finally {
      (processRunner as any).run = originalRun;
      (processRunner as any).runRoot = originalRunRoot;
      cleanup();
    }
  });

  it("stops vm process only when /proc identity matches vm metadata", () => {
    const { config, cleanup } = createTestAppConfig();

    try {
      const client = new JailerClient();
      const calls: string[][] = [];
      let processExistsChecks = 0;
      const pid = "10101";

      spyOn(processRunner, "run").mockImplementation(((args: string[]) => {
        calls.push(args);

        if (args[0] === "test" && args[1] === "-d" && args[2] === `/proc/${pid}`) {
          processExistsChecks += 1;
          return processExistsChecks === 1 ? ok() : fail("not found");
        }

        if (args[0] === "cat" && args[1] === `/proc/${pid}/stat`) {
          return {
            exitCode: 0,
            stdout: `${pid} (firecracker) S 1 1 1 1 1 1 1 1 1 1`,
            stderr: "",
          };
        }

        if (args[0] === "cat" && args[1] === `/proc/${pid}/cmdline`) {
          return {
            exitCode: 0,
            stdout: `${join(config.paths.jailerBaseDir, "firecracker")} --id vm-safe --chroot-base-dir ${config.paths.jailerBaseDir}\u0000`,
            stderr: "",
          };
        }

        if (args[0] === "cat" && args[1] === `/proc/${pid}/cgroup`) {
          return {
            exitCode: 0,
            stdout: "0::/microvm/vm-safe\n",
            stderr: "",
          };
        }

        if (args[0] === "readlink" && args[1] === "-f" && args[2] === `/proc/${pid}/root`) {
          return {
            exitCode: 0,
            stdout: join(config.paths.jailerBaseDir, "firecracker", "vm-safe", "root"),
            stderr: "",
          };
        }

        if (args[0] === "kill" && args[1] === "-TERM" && args[2] === pid) {
          return ok();
        }

        throw new Error(`Unexpected run call: ${args.join(" ")}`);
      }) as any);

      client.stopVmProcess({
        vmId: "vm-safe",
        pid: Number(pid),
        jailerVmDir: join(config.paths.jailerBaseDir, "firecracker", "vm-safe"),
      });

      expect(calls.some((args) => args[0] === "kill" && args[1] === "-TERM")).toBe(true);
      expect(calls.some((args) => args[0] === "kill" && args[1] === "-KILL")).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("stops firecracker process when vm identity is anchored by cgroup path", () => {
    const { cleanup } = createTestAppConfig();

    try {
      const client = new JailerClient();
      const calls: string[][] = [];
      let processExistsChecks = 0;
      const pid = "13131";

      spyOn(processRunner, "run").mockImplementation(((args: string[]) => {
        calls.push(args);

        if (args[0] === "test" && args[1] === "-d" && args[2] === `/proc/${pid}`) {
          processExistsChecks += 1;
          return processExistsChecks === 1 ? ok() : fail("not found");
        }

        if (args[0] === "cat" && args[1] === `/proc/${pid}/stat`) {
          return {
            exitCode: 0,
            stdout: `${pid} (firecracker) S 1 1 1 1 1 1 1 1 1 1`,
            stderr: "",
          };
        }

        if (args[0] === "cat" && args[1] === `/proc/${pid}/cmdline`) {
          return {
            exitCode: 0,
            stdout: "/usr/bin/firecracker --api-sock /firecracker.socket\u0000",
            stderr: "",
          };
        }

        if (args[0] === "cat" && args[1] === `/proc/${pid}/cgroup`) {
          return {
            exitCode: 0,
            stdout: "0::/microvm/vm-cgroup\n",
            stderr: "",
          };
        }

        if (args[0] === "readlink" && args[1] === "-f" && args[2] === `/proc/${pid}/root`) {
          return {
            exitCode: 0,
            stdout: "/",
            stderr: "",
          };
        }

        if (args[0] === "kill" && args[1] === "-TERM" && args[2] === pid) {
          return ok();
        }

        throw new Error(`Unexpected run call: ${args.join(" ")}`);
      }) as any);

      client.stopVmProcess({
        vmId: "vm-cgroup",
        pid: Number(pid),
        jailerVmDir: "/tmp/jailer/firecracker/vm-cgroup",
      });

      expect(calls.some((args) => args[0] === "kill" && args[1] === "-TERM")).toBe(true);
      expect(calls.some((args) => args[0] === "kill" && args[1] === "-KILL")).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("refuses to stop process when /proc identity does not match vm metadata", () => {
    const { cleanup } = createTestAppConfig();

    try {
      const client = new JailerClient();
      const calls: string[][] = [];
      const pid = "20202";

      spyOn(processRunner, "run").mockImplementation(((args: string[]) => {
        calls.push(args);

        if (args[0] === "test" && args[1] === "-d" && args[2] === `/proc/${pid}`) {
          return ok();
        }

        if (args[0] === "cat" && args[1] === `/proc/${pid}/stat`) {
          return {
            exitCode: 0,
            stdout: `${pid} (bash) S 1 1 1 1 1 1 1 1 1 1`,
            stderr: "",
          };
        }

        if (args[0] === "cat" && args[1] === `/proc/${pid}/cmdline`) {
          return {
            exitCode: 0,
            stdout: "/usr/bin/bash -lc sleep 1000\u0000",
            stderr: "",
          };
        }

        if (args[0] === "cat" && args[1] === `/proc/${pid}/cgroup`) {
          return {
            exitCode: 0,
            stdout: "0::/user.slice/user-1000.slice/session-1.scope\n",
            stderr: "",
          };
        }

        if (args[0] === "readlink" && args[1] === "-f" && args[2] === `/proc/${pid}/root`) {
          return {
            exitCode: 0,
            stdout: "/",
            stderr: "",
          };
        }

        throw new Error(`Unexpected run call: ${args.join(" ")}`);
      }) as any);

      expect(() => client.stopVmProcess({
        vmId: "vm-safe",
        pid: Number(pid),
        jailerVmDir: "/tmp/jailer/firecracker/vm-safe",
      })).toThrow("Refusing to stop PID");

      expect(calls.some((args) => args[0] === "kill")).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("stops process when vm identity is anchored by jail root path", () => {
    const { config, cleanup } = createTestAppConfig();

    try {
      const client = new JailerClient();
      const calls: string[][] = [];
      let processExistsChecks = 0;
      const pid = "24242";

      spyOn(processRunner, "run").mockImplementation(((args: string[]) => {
        calls.push(args);

        if (args[0] === "test" && args[1] === "-d" && args[2] === `/proc/${pid}`) {
          processExistsChecks += 1;
          return processExistsChecks === 1 ? ok() : fail("not found");
        }

        if (args[0] === "cat" && args[1] === `/proc/${pid}/stat`) {
          return {
            exitCode: 0,
            stdout: `${pid} (firecracker) S 1 1 1 1 1 1 1 1 1 1`,
            stderr: "",
          };
        }

        if (args[0] === "cat" && args[1] === `/proc/${pid}/cmdline`) {
          return {
            exitCode: 0,
            stdout: "/usr/bin/firecracker --api-sock /firecracker.socket\u0000",
            stderr: "",
          };
        }

        if (args[0] === "cat" && args[1] === `/proc/${pid}/cgroup`) {
          return {
            exitCode: 0,
            stdout: "0::/microvm\n",
            stderr: "",
          };
        }

        if (args[0] === "readlink" && args[1] === "-f" && args[2] === `/proc/${pid}/root`) {
          return {
            exitCode: 0,
            stdout: join(config.paths.jailerBaseDir, "firecracker", "vm-root", "root"),
            stderr: "",
          };
        }

        if (args[0] === "kill" && args[1] === "-TERM" && args[2] === pid) {
          return ok();
        }

        throw new Error(`Unexpected run call: ${args.join(" ")}`);
      }) as any);

      client.stopVmProcess({
        vmId: "vm-root",
        pid: Number(pid),
        jailerVmDir: join(config.paths.jailerBaseDir, "firecracker", "vm-root"),
      });

      expect(calls.some((args) => args[0] === "kill" && args[1] === "-TERM")).toBe(true);
      expect(calls.some((args) => args[0] === "kill" && args[1] === "-KILL")).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("treats zombie process as terminated after SIGTERM", () => {
    const { cleanup } = createTestAppConfig();

    try {
      const client = new JailerClient();
      const calls: string[][] = [];
      const pid = "31313";
      let statReads = 0;

      spyOn(processRunner, "run").mockImplementation(((args: string[]) => {
        calls.push(args);

        if (args[0] === "test" && args[1] === "-d" && args[2] === `/proc/${pid}`) {
          return ok();
        }

        if (args[0] === "cat" && args[1] === `/proc/${pid}/stat`) {
          statReads += 1;
          const state = statReads === 1 ? "S" : "Z";
          return {
            exitCode: 0,
            stdout: `${pid} (firecracker) ${state} 1 1 1 1 1 1 1 1 1 1`,
            stderr: "",
          };
        }

        if (args[0] === "cat" && args[1] === `/proc/${pid}/cmdline`) {
          return {
            exitCode: 0,
            stdout: "/usr/bin/firecracker --id vm-zombie --api-sock /firecracker.socket\u0000",
            stderr: "",
          };
        }

        if (args[0] === "cat" && args[1] === `/proc/${pid}/cgroup`) {
          return {
            exitCode: 0,
            stdout: "0::/microvm/vm-zombie\n",
            stderr: "",
          };
        }

        if (args[0] === "readlink" && args[1] === "-f" && args[2] === `/proc/${pid}/root`) {
          return {
            exitCode: 0,
            stdout: "/",
            stderr: "",
          };
        }

        if (args[0] === "kill" && args[1] === "-TERM" && args[2] === pid) {
          return ok();
        }

        throw new Error(`Unexpected run call: ${args.join(" ")}`);
      }) as any);

      client.stopVmProcess({
        vmId: "vm-zombie",
        pid: Number(pid),
        jailerVmDir: "/tmp/jailer/firecracker/vm-zombie",
      });

      expect(calls.some((args) => args[0] === "kill" && args[1] === "-TERM")).toBe(true);
      expect(calls.some((args) => args[0] === "kill" && args[1] === "-KILL")).toBe(false);
    } finally {
      cleanup();
    }
  });
});
