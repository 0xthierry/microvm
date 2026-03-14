# microvm

`microvm` is a Linux CLI for creating and running local Firecracker microVMs from Dockerfiles.

> [!WARNING]
> This project is experimental. I actively develop and test it myself, but it is still evolving and should be used with caution.

The main use case behind this project is simple: give coding agents like Codex, Claude Code, Gemini, or any other automation a real VM boundary instead of another process on your host. Build the guest image you want, boot it fast, SSH in, run work, tear it down, and keep the host out of the blast radius.

It is not limited to AI workflows. If you can describe a Linux guest in a Dockerfile, `microvm` can turn that into a bootable microVM root filesystem and manage the VM lifecycle locally.

Status: beta (`0.1.x`). Interfaces and behavior can still change.

## Why this exists

- Stronger isolation than a local agent process or container alone.
- Repeatable guest environments defined by Dockerfiles.
- Fast local lifecycle: create, boot, SSH, stop, restart, delete.
- Persistent VM disks across stop/start cycles.
- Opinionated host networking that allows outbound internet while blocking VM-to-VM traffic.
- A practical way to run agent sandboxes that can still reach a host-side service port like `11434`.

## What you can create today

Today, `microvm` creates Firecracker guests backed by a Dockerfile-built root filesystem.

That means you can build microVMs for:

- coding agents and automation runners
- isolated dev environments
- integration or security experiments
- disposable toolboxes with SSH access

The guest image is yours to define, but the resulting rootfs must satisfy the current boot contract:

- executable `/sbin/init`
- `sshd` installed at `/usr/bin/sshd` or `/usr/sbin/sshd`
- a `root` user in `/etc/passwd`
- the configured `--ssh-user` present in `/etc/passwd`

The repo includes working example guests under [`examples/`](./examples), including an Arch Linux starter at [`examples/archlinux`](./examples/archlinux).

## Quick start

For early evaluation, keep all state inside the repo:

```bash
export MICROVM_HOME=.microvm
```

Install from source, verify the host, and install the CLI:

```bash
bun install
bun run install:cli
microvm doctor
```

Create and boot your first VM:

```bash
microvm create \
  --name codex-dev \
  --dockerfile scripts/Dockerfile.test-ubuntu \
  --ssh-user thierry

microvm up codex-dev
microvm status codex-dev
microvm ssh codex-dev
```

Notes:

- `create` builds or reuses a cached rootfs artifact, then creates a stopped VM record.
- `up` boots the VM and waits for SSH readiness before returning.
- `ssh` opens an interactive SSH session unless you pass a remote command.

Run a remote command directly:

```bash
microvm ssh codex-dev 'uname -a'
```

Stop and delete it:

```bash
microvm down codex-dev
microvm delete codex-dev
```

If you want a ready-made starter, the Arch Linux example creates a VM named `example-archlinux` with 2 vCPUs, 2048 MiB RAM, and a 10 GiB disk:

```bash
./examples/archlinux/install.sh
```

## The workflow

`microvm` is built around a small lifecycle:

1. `microvm doctor`
2. `microvm create --name <name> --dockerfile <path>`
3. `microvm up <name>`
4. `microvm ssh <name>` or `microvm ssh <name> [command...]`
5. `microvm list` / `microvm status <name>`
6. `microvm set <name> ...`
7. `microvm down <name>`
8. `microvm delete <name>`

The user chooses the VM name. The CLI generates the VM id and internal network assignment.

## Agent-oriented example

The intended pattern is:

1. Write a Dockerfile that installs the tools your agent needs.
2. Create a VM from that Dockerfile.
3. Boot it only when work is needed.
4. Attach with `microvm ssh <name>` or execute a remote command with `microvm ssh <name> ...`.

Example:

```bash
microvm create \
  --name claude-sandbox \
  --dockerfile ./infra/agent-vm/Dockerfile \
  --cpus 4 \
  --memory-mib 4096 \
  --disk-gib 20 \
  --ssh-user dev

microvm up claude-sandbox
microvm ssh claude-sandbox
```

If your agents need outbound internet, package managers, Git, language runtimes, or even a local host-side service, put that in the guest image and let the VM reach it through the supported network model.

## Examples

- [`examples/archlinux`](./examples/archlinux) contains a starter Arch Linux guest image.
- Run [`examples/archlinux/install.sh`](./examples/archlinux/install.sh) to create `example-archlinux` with `2` vCPUs, `2048` MiB memory, and a `10` GiB disk using [`examples/archlinux/Dockerfile`](./examples/archlinux/Dockerfile).
- [`scripts/Dockerfile.test-ubuntu`](./scripts/Dockerfile.test-ubuntu) is still used by the repo’s test and e2e workflows.

## Networking model

Each VM gets its own TAP device and a deterministic private `/30` subnet under `172.16.x.x`.

Current behavior:

- outbound traffic from the VM is NATed through the host uplink
- host-to-VM SSH works
- VM-to-VM traffic is blocked
- VM-to-host ingress is blocked except for established replies and one allowed TCP port

The default allowed host service port is `11434`, which is useful for reaching a host-side Ollama instance from inside the guest.

## Isolation model

`microvm` uses several isolation layers together:

- Firecracker microVMs on KVM provide the primary boundary: each VM gets its own guest kernel, vCPU allocation, memory allocation, root disk, and TAP device.
- `jailer` adds a second boundary around the Firecracker process with a chroot, dedicated uid/gid, cgroup v2 controls, and RLIMITs.
- Per-VM networking is isolated with dedicated TAP interfaces and iptables rules.
- Persistent state and artifacts are stored under `microvm`-managed directories rather than mixed into your project tree unless you explicitly use `MICROVM_HOME=.microvm`.

Current runtime limits applied through `jailer` include:

- memory cgroup limit
- swap disabled
- CPU quota
- PID limit
- file descriptor limit
- file size limit sized to the VM disk

What the network policy currently allows:

- host -> VM: SSH access
- VM -> internet: allowed through host NAT
- VM -> other VMs: blocked
- VM -> host: blocked by default except established replies and one allowed TCP port (`11434` by default)

What this means in practice:

- This is materially stronger isolation than running an agent directly on the host or in a normal local process sandbox.
- It is designed to contain agent workloads behind a real VM boundary while still keeping them usable for development.
- It is not a “zero access” environment inside the guest. If your guest image allows root SSH, the workload can become root inside that VM.
- The CLI itself still performs privileged host operations with `sudo` for networking and some image-preparation steps, so the orchestration layer is trusted.

## Commands you'll actually use

Every top-level command supports `--json` for scripting.

| Command | Purpose | Key options |
| --- | --- | --- |
| `microvm create` | Create a stopped VM record and rootfs | `--name`, `--dockerfile`, `--cpus`, `--memory-mib`, `--disk-mib`, `--disk-gib`, `--ssh-user` |
| `microvm up <idOrName>` | Boot a VM and wait for SSH | `--no-attach` |
| `microvm down <idOrName>` | Stop a running VM and tear down runtime state | `--json` |
| `microvm set <idOrName>` | Update stored VM config | `--cpus`, `--memory-mib`, `--disk-mib`, `--disk-gib`, `--ssh-user` |
| `microvm ssh <idOrName> [command...]` | Open SSH or execute a remote command | `--json` |
| `microvm list` | List tracked VMs | `--json` |
| `microvm status <idOrName>` | Show stored config and runtime metadata | `--json` |
| `microvm doctor` | Check host readiness | `--json` |
| `microvm delete <idOrName>` | Delete a VM record and its files | `--json` |
| `microvm help [command]` | Show CLI help | `--json` |

Examples:

```bash
# Create a VM with explicit sizing
microvm create \
  --name api-dev \
  --dockerfile scripts/Dockerfile.test-ubuntu \
  --cpus 4 \
  --memory-mib 2048 \
  --disk-gib 12 \
  --ssh-user thierry

# Boot without printing the SSH command
microvm up api-dev --no-attach

# Inspect state
microvm list
microvm status api-dev

# Update next-boot config
microvm set api-dev --cpus 6 --memory-mib 4096

# Grow the disk while stopped
microvm down api-dev
microvm set api-dev --disk-gib 20
```

Behavior notes:

- `--disk-mib` and `--disk-gib` are mutually exclusive on `create` and `set`.
- `set` requires at least one mutable flag.
- CPU, memory, and SSH user changes are stored config and should be treated as next-boot settings.
- disk resizing is grow-only and is rejected while the VM is running.
- `ssh` without a trailing command opens an interactive SSH session.

## Defaults

If you do not specify sizing flags, the CLI currently uses:

- `--cpus`: `2`
- `--memory-mib`: `1024`
- disk size: `10240 MiB` (`10 GiB`)
- `--ssh-user`: `root`

## Host requirements

Current host expectations:

- Linux host
- supported host architectures: `x86_64` and `aarch64`
- KVM available and readable/writable at `/dev/kvm`
- cgroup v2
- `sudo` access for host networking and runtime setup
- Bun for development and source-based installation

`microvm doctor` currently checks for:

- `firecracker`
- `jailer`
- `curl`
- `ip`
- `iptables`
- `ssh`
- `/dev/kvm` access
- cgroup v2 availability

Creating VMs also requires additional host tools such as:

- `docker`
- `mkfs.ext4`
- `tar`
- `ssh-keygen`
- `e2fsck`
- `resize2fs`

## Install

The supported install path today is from source with Bun.

One-command install to `~/.local/bin`:

```bash
bun run install:cli
```

That script:

- installs dependencies
- runs `microvm doctor`
- builds a standalone binary at `dist/microvm`
- installs `microvm` to `~/.local/bin/microvm`

If `~/.local/bin` is not on your `PATH`, the script prints the export line to add.

## What happens under the hood

- `create` builds a rootfs from your Dockerfile using Docker, exports it, injects managed SSH keys, and stores the VM metadata on disk.
- `up` prepares host networking, stages assets into a Firecracker jail, requires a repo-local kernel build under `kernel/dist/<arch>/`, configures Firecracker, boots the guest, and waits for SSH.
- `down` stops the VM process, tears down networking, and clears runtime metadata.
- `delete` removes the VM record, runtime artifacts, and disk files. Running VMs are stopped first.

## State and artifacts

By default, persistent state lives under XDG paths for the current user, with `HOME` fallbacks such as:

- `~/.local/share/microvm`
- `~/.local/state/microvm`
- `~/.cache/microvm`

For project-local state during development or testing:

```bash
export MICROVM_HOME=.microvm
```

The CLI also manages a shared SSH keypair under the configured state directories and reuses cached rootfs artifacts when possible.

Per-VM lifecycle events are also written as NDJSON logs under the runtime `events/` directory.

## Current limitations

This project is intentionally narrow right now:

- Linux host only
- local Firecracker workflows only
- source install only
- Dockerfile-backed rootfs creation only
- no built-in image catalog for Codex, Claude Code, Gemini, or other agents yet

## More docs

- [CLI guide](docs/cli.md)
- [Install details](docs/install.md)
- [Firecracker notes](docs/firecracker.md)
- [Kernel workspace](kernel/README.md)

## Development

```bash
bun run check
bun test
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

See [SECURITY.md](SECURITY.md).

## License

MIT, see [LICENSE](LICENSE).
