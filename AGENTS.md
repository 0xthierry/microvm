# MicroVM Project Guide

## Goal
- Build an experimental Firecracker-based system that boots microVMs and supports SSH access.
- Keep the implementation simple and iterative, with hardening enabled by default.

## Hard Constraints
- All project logic lives in `src/index.ts`.
- Runtime is Bun.
- Prefer small functions and composition.
- Use `docs/firecracker.md` and `.repositories/firecracker/docs/*` as primary references.

## VM ID Constraints (Important)
- For VM lifecycle commands that go through jailer (`create`, `start`, `up`), VM IDs must be **jailer-safe**:
  - allowed chars: lowercase letters, digits, `-`
  - disallowed: `_`
- VM ID length is also constrained by Unix socket path length (`<= 107` bytes).
  - The max VM ID length is computed from the current repo path.
  - In this repo path, errors show a practical max of around `15` characters.
  - If path length changes, this max changes too.

## Current Capabilities
- `bun src/index.ts up`:
  - resolves latest Firecracker release and latest CI kernel key for host arch.
  - downloads/reuses kernel artifact.
  - builds/reuses Arch Linux rootfs ext4 from `Dockerfile.arch`.
  - launches Firecracker through `jailer` (default, always).
  - configures host network (TAP + forwarding + NAT + host access policy).
  - waits for SSH readiness and optionally auto-attaches.
- `bun src/index.ts ssh`: attaches to running VM.
- `bun src/index.ts down`: stops VM and cleans host network/jailer runtime state.
- `bun src/index.ts status`: prints persisted runtime state.

## Current VM Defaults
- vCPU: `2`
- Memory: `1024 MiB`
- Root disk: ext4 image generated from `Dockerfile.arch` (minimum currently `1 GiB`, auto-sized from rootfs tree)
- Guest IP: `172.16.0.2/30`
- Host TAP IP: `172.16.0.1/30`
- SSH default user: `thierry` (key also injected for `root`)

## Networking Configuration
- TAP device: `tap-vm0`
- Host forwarding:
  - `net.ipv4.ip_forward=1`
  - `FORWARD` allow rules for `tap-vm0 <-> <host default iface>` with conntrack return path.
- Outbound NAT:
  - `POSTROUTING -s 172.16.0.2 -o <host iface> -j MASQUERADE`
- Host service isolation from VM:
  - allow `INPUT` from VM to host only on TCP `11434`.
  - allow `RELATED,ESTABLISHED` return traffic.
  - drop other VM->host `INPUT` traffic on TAP.
- DNS in rootfs:
  - `/etc/resolv.conf` generated with `1.1.1.1` and `8.8.8.8`.

## Security Measures Implemented
- Jailer-first execution (no direct Firecracker launch path).
- Firecracker runtime drops privileges to non-root UID/GID (`--uid/--gid` based on runtime user).
- Chrooted jail runtime under `.microvm/jailer`.
- Dynamic runtime dependency staging for distro-provided dynamic Firecracker binaries (linker/libs copied into jail root as needed).
- Cgroup v2 defaults (via jailer):
  - `memory.max=1610612736` (1.5 GiB)
  - `memory.swap.max=0`
  - `cpu.max=200000 100000` (2 CPUs worth)
  - `pids.max=512`
- Resource limits (via jailer):
  - `no-file=1024`
  - `fsize=2147483648` (2 GiB)
- SSH hardening:
  - key-based auth only.
  - authorized keys injected with strict permissions/ownership for both `root` and `thierry`.

## Configurable Limits (Env Overrides)
- `MICROVM_CGROUP_PARENT`
- `MICROVM_CGROUP_MEMORY_MAX`
- `MICROVM_CGROUP_MEMORY_SWAP_MAX`
- `MICROVM_CGROUP_CPU_MAX`
- `MICROVM_CGROUP_PIDS_MAX`
- `MICROVM_RLIMIT_NOFILE`
- `MICROVM_RLIMIT_FSIZE`

## Runtime Paths
- Working runtime root: `.microvm/`
- Artifacts: `.microvm/artifacts/`
- Runtime state: `.microvm/runtime/state.json`
- Jailer root base: `.microvm/jailer/`

## Local References
- Firecracker project guide: `docs/firecracker.md`
- Upstream getting started: `.repositories/firecracker/docs/getting-started.md`
- Upstream network setup: `.repositories/firecracker/docs/network-setup.md`
- Upstream jailer docs: `.repositories/firecracker/docs/jailer.md`
- AIDEV installer reference (kernel download pattern): `../aidev/installer/install.sh`
