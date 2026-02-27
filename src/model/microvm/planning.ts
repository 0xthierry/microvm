import { AppError } from "../../lib/errors/app-error";
import { join } from "node:path";

export type SupportedHostArch = "x86_64" | "aarch64";

export type PlannedVmNetwork = {
  tapDev: string;
  hostIp: string;
  guestIp: string;
  maskBits: string;
  maskLong: string;
  guestMac: string;
};

export class VmIndexOutOfRangeError extends AppError {
  constructor(index: number) {
    super(`VM index ${index} exceeds supported /30 address space.`, {
      details: { index },
    });
  }
}

export class TapDeviceNameTooLongError extends AppError {
  constructor(tapDev: string) {
    super(`Computed tap device name is too long: ${tapDev}.`, {
      details: { tapDev, maxLength: 15 },
    });
  }
}

export class UnsupportedHostArchitectureError extends AppError {
  constructor(hostArch: string) {
    super(`Unsupported architecture: ${hostArch}.`, {
      details: { hostArch },
    });
  }
}

const formatHexByte = (value: number): string =>
  value.toString(16).padStart(2, "0").toUpperCase();

export const planVmNetwork = (index: number): PlannedVmNetwork => {
  const subnetBase = index * 4;
  const thirdOctet = Math.floor(subnetBase / 256);
  const fourthBase = subnetBase % 256;

  if (thirdOctet > 255 || fourthBase > 252) {
    throw new VmIndexOutOfRangeError(index);
  }

  const tapDev = `tap-vm${index}`;
  if (tapDev.length > 15) {
    throw new TapDeviceNameTooLongError(tapDev);
  }

  const hostLast = fourthBase + 1;
  const guestLast = fourthBase + 2;

  return {
    tapDev,
    hostIp: `172.16.${thirdOctet}.${hostLast}`,
    guestIp: `172.16.${thirdOctet}.${guestLast}`,
    maskBits: "30",
    maskLong: "255.255.255.252",
    guestMac: `06:00:AC:10:${formatHexByte(thirdOctet)}:${formatHexByte(guestLast)}`,
  };
};

export const resolveHostArch = (arch: string): SupportedHostArch => {
  if (arch === "x64") {
    return "x86_64";
  }
  if (arch === "arm64") {
    return "aarch64";
  }
  throw new UnsupportedHostArchitectureError(arch);
};

export const buildBootArgs = (params: {
  guestIp: string;
  hostIp: string;
  maskLong: string;
  vmId: string;
  arch: SupportedHostArch;
}): string => {
  const args = [
    "console=ttyS0",
    "reboot=k",
    "panic=1",
    "pci=off",
    "root=/dev/vda",
    "rw",
    `ip=${params.guestIp}::${params.hostIp}:${params.maskLong}:${params.vmId}:eth0:off`,
  ];

  if (params.arch === "aarch64") {
    args.unshift("keep_bootcon");
  }

  return args.join(" ");
};

export const buildFirecrackerLogPath = (runtimeDir: string, vmId: string): string =>
  join(runtimeDir, vmId, "firecracker.log");
