import { vmDefaults } from "./vm";

const BYTES_PER_MIB = 1024 * 1024;
const JAILER_MEMORY_HEADROOM_NUMERATOR = 3;
const JAILER_MEMORY_HEADROOM_DENOMINATOR = 2;

const bytesFromMib = (mib: number): number => mib * BYTES_PER_MIB;

const deriveMemoryMaxBytes = (vmMemoryMib: number): number =>
  Math.ceil(
    (bytesFromMib(vmMemoryMib) * JAILER_MEMORY_HEADROOM_NUMERATOR)
      / JAILER_MEMORY_HEADROOM_DENOMINATOR,
  );

const deriveFsizeBytes = (vmDiskMib: number): number => bytesFromMib(vmDiskMib);

export const buildJailerDefaults = ({
  vmMemoryMib,
  vmDiskMib,
}: {
  vmMemoryMib: number;
  vmDiskMib: number;
}) => ({
  apiSocketInJail: "/firecracker.socket",
  kernelPathInJail: "/kernel/vmlinux",
  rootfsPathInJail: "/rootfs.ext4",
  parentCgroup: "microvm",
  cgroupMemoryMax: String(deriveMemoryMaxBytes(vmMemoryMib)),
  cgroupMemorySwapMax: "0",
  cgroupCpuMax: "200000 100000",
  cgroupPidsMax: "512",
  rlimitNofile: "1024",
  rlimitFsize: String(deriveFsizeBytes(vmDiskMib)),
  maxUnixSocketPathLength: 107,
} as const);

export const jailerDefaults = buildJailerDefaults({
  vmMemoryMib: vmDefaults.memSizeMib,
  vmDiskMib: vmDefaults.diskSizeMib,
});
