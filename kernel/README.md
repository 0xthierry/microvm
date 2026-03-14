# Kernel Workspace

This directory contains the repo-local guest kernel workflow for `microvm`.

The goal is to stay very close to Firecracker's published Amazon Linux
microVM kernel recipe and make only the smallest change needed for Docker in
the guest: enable the raw iptables tables that Docker bridge networking expects.

## Source Versions

These files were synced on March 13, 2026.

- Firecracker config source repository:
  `https://github.com/firecracker-microvm/firecracker`
- Firecracker config source commit:
  `3839f6ad5`
- Amazon Linux kernel source repository:
  `https://github.com/amazonlinux/linux`
- Pinned Amazon Linux guest kernel tag:
  `microvm-kernel-6.1.164-23.303.amzn2023`

The pinned versions live in [`manifest/versions.env`](./manifest/versions.env).
The build script reads that file directly so the local build is reproducible.

## Layout

- `config/firecracker/`
  Copied config fragments from Firecracker's guest kernel recipe.
- `config/overlays/`
  `microvm`-specific config overlays layered on top of Firecracker's config.
- `patches/vmclock/6.1/`
  Copied `vmclock` patchset from Firecracker. We keep this to stay close to
  the upstream Firecracker guest kernel recipe.
- `scripts/build.sh`
  Builds a local guest kernel artifact into `kernel/dist/<arch>/`.
- `src/`
  Local checkout area for the Amazon Linux kernel source tree.
- `out/`
  Build output directory used by `make O=...`.
- `dist/`
  Final artifacts consumed by `microvm` when present.

## Config Files

### Firecracker Base Files

- `config/firecracker/microvm-kernel-ci-x86_64-6.1.config`
  Firecracker's x86_64 base guest kernel config for the 6.1 line.
- `config/firecracker/microvm-kernel-ci-aarch64-6.1.config`
  Firecracker's aarch64 base guest kernel config for the 6.1 line.
- `config/firecracker/ci.config`
  Shared CI-oriented additions used by Firecracker's own kernel build flow.
  This includes things like `IKCONFIG` exposure in `/proc/config.gz`.
- `config/firecracker/pcie.config`
  Enables PCI and `virtio-pci` guest support. We keep it for parity with
  Firecracker's recipe even though the current runtime still boots with
  `pci=off`.
- `config/firecracker/virtio-pmem.config`
  Enables Firecracker's persistent memory and DAX-related guest support.
- `config/firecracker/virtio-mem.config`
  Enables Firecracker's memory hotplug support.
- `config/firecracker/vmclock.config`
  Enables the `vmclock` guest-side config that pairs with the copied patchset.

### `microvm` Overlay

- `config/overlays/docker-netfilter.config`
  Our only intentional functional delta from Firecracker's default 6.1 guest
  recipe. This enables:
  - `CONFIG_IP_NF_RAW=y`
  - `CONFIG_IP6_NF_RAW=y`

Firecracker's checked-in guest configs explicitly disable both of those. Docker
bridge networking inside the guest expects the raw iptables tables to exist, so
this overlay restores them.

## Build Output

The build writes the following files to `kernel/dist/<arch>/`:

- `vmlinux`
  The guest kernel artifact that `microvm` can boot. On `aarch64`, this file is
  still named `vmlinux` for consistency even though it is built from the kernel
  `Image` output.
- `vmlinux.config`
  The resolved Kconfig used for the final build.
- `vmlinux.meta.json`
  Metadata consumed by `microvm` at runtime.

## How Runtime Picks It Up

When `microvm up` runs from this repository root, the kernel service requires
`kernel/dist/<host-arch>/vmlinux`.

There is no runtime fallback to downloaded Firecracker kernels or cached kernel
artifacts outside this workspace. If the file is missing, `up` fails fast and
asks you to build the repo-local kernel first.

## Build Command

From the repository root:

```bash
bun run kernel:build
```

You can also call the script directly:

```bash
./kernel/scripts/build.sh
```

By default, it builds the host architecture using the pinned Amazon Linux tag.

## Dependencies

The script does not install host packages automatically. It expects the normal
Linux kernel build toolchain to already be present.

Minimum practical dependencies:

- `git`
- `make`
- `gcc`
- `bc`
- `flex`
- `bison`
- `openssl` headers
- `libelf` headers

For `aarch64` builds on a non-`aarch64` host, you must provide a working
cross-compilation toolchain and set `CROSS_COMPILE` yourself. This repository
contains both architecture configs, but cross-compilation has not been verified
here.
