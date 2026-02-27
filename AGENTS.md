# MicroVM Project Guide

## Objective
- Build an experimental Firecracker workflow that boots microVMs and allows SSH access.
- Develop incrementally, starting from a minimal reliable path.

## Hard Constraints
- Keep implementation code in `src/index.ts`.
- Runtime must be Bun.
- Prefer small functions and functional composition.
- Use `docs/firecracker.md` as the primary local reference.
- Use `../aidev` only as a reference when Firecracker behavior is unclear.

## Current Milestone
1. Resolve and download the latest Firecracker CI kernel for host architecture.
2. Reuse downloaded artifacts when already present.
3. Provision host networking (TAP + forwarding + NAT) for one microVM.
4. Start Firecracker, configure VM through the API socket, and boot.
5. SSH into the guest successfully.

## Practical Notes
- Kernel strategy follows the installer pattern from `../aidev/installer/install.sh`: download if missing, skip if already present.
- For SSH bootstrap, prefer Firecracker CI rootfs artifacts that already include an SSH key when available.
- Keep all runtime artifacts under `.microvm/` so cleanup is straightforward.

## Local References
- Firecracker guide: `docs/firecracker.md`
- Upstream docs: `.repositories/firecracker/docs/getting-started.md`
- Upstream networking: `.repositories/firecracker/docs/network-setup.md`
- AIDEV installer reference: `../aidev/installer/install.sh`
