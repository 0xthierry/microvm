export const jailerDefaults = {
  apiSocketInJail: "/firecracker.socket",
  kernelPathInJail: "/kernel/vmlinux",
  rootfsPathInJail: "/rootfs.ext4",
  parentCgroup: "microvm",
  cgroupMemoryMax: "1610612736",
  cgroupMemorySwapMax: "0",
  cgroupCpuMax: "200000 100000",
  cgroupPidsMax: "512",
  rlimitNofile: "1024",
  rlimitFsize: "2147483648",
  maxUnixSocketPathLength: 107,
} as const;
