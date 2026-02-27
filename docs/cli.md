# `microvm` CLI Guide

`microvm` is a beta Linux-only CLI for creating and running local Firecracker microVMs from a Dockerfile-backed root filesystem.

This guide documents the CLI from the user's point of view, based on the current command surface and behavior in the repository as of March 7, 2026.

The current install path is from source with Bun.

## Mental Model

The CLI revolves around a simple lifecycle:

1. Check the host with `microvm doctor`.
2. Create a VM record and root filesystem with `microvm create`.
3. Boot it with `microvm up`.
4. Inspect it with `microvm list` and `microvm status`.
5. Access it with `microvm ssh`.
6. Update mutable settings with `microvm set`.
7. Stop it with `microvm down`.
8. Remove it with `microvm delete`.

The user chooses the VM name. The CLI generates the VM id.

## Install And First Run

For project-local state during evaluation:

```bash
export MICROVM_HOME=.microvm
```

For local installation from the repository:

```bash
bun install
bun run install:cli
```

Basic verification:

```bash
microvm help
microvm doctor
```

`microvm doctor` currently checks:

- required binaries: `firecracker`, `jailer`, `curl`, `ip`, `iptables`, `ssh`
- `/dev/kvm` read/write access
- cgroup v2 availability

`microvm doctor` exits non-zero when the host is not ready.

## Defaults

If you do not pass explicit sizing flags, the CLI currently uses:

- `--cpus`: `2`
- `--memory-mib`: `1024`
- disk size: `10240 MiB` (`10 GiB`)
- `--ssh-user`: `root`

You must pass `--dockerfile <path>` when creating a VM.

## Common Workflow

Create a VM:

```bash
microvm create --name api-dev --dockerfile scripts/Dockerfile.test-ubuntu
```

Create a VM with explicit settings:

```bash
microvm create \
  --name api-dev \
  --cpus 4 \
  --memory-mib 2048 \
  --disk-gib 12 \
  --dockerfile scripts/Dockerfile.test-ubuntu \
  --ssh-user thierry
```

Start it:

```bash
microvm up api-dev
```

Start it without printing the SSH command:

```bash
microvm up api-dev --no-attach
```

Check current VMs:

```bash
microvm list
microvm status api-dev
```

Open an interactive SSH session:

```bash
microvm ssh api-dev
```

Run a command over SSH:

```bash
microvm ssh api-dev uname -a
microvm ssh api-dev 'cat /etc/os-release'
```

Update mutable settings:

```bash
microvm set api-dev --cpus 6 --memory-mib 4096
microvm set api-dev --ssh-user root
```

Those changes update stored VM configuration. CPU, memory, and SSH user changes should be treated as next-boot settings rather than live reconfiguration of a running guest.

Resize disk while the VM is stopped:

```bash
microvm down api-dev
microvm set api-dev --disk-gib 20
```

Stop and delete:

```bash
microvm down api-dev
microvm delete api-dev
```

## Command Reference

### `microvm help [command]`

Shows top-level help or command-specific help.

Examples:

```bash
microvm help
microvm help create
microvm status --help
```

### `microvm doctor`

Checks current host prerequisites before you try to create or boot VMs.

Examples:

```bash
microvm doctor
microvm doctor --json
```

Notes:

- current checks cover `firecracker`, `jailer`, `curl`, `ip`, `iptables`, `ssh`, `/dev/kvm`, and cgroup v2
- failing checks include remediation guidance in human-readable output
- the command exits non-zero when one or more checks fail

### `microvm create --name <name>`

Creates a stopped VM record, clones or builds the root filesystem, assigns networking metadata, and stores the VM for later boot.

Accepted options:

- `--name <name>` required
- `--dockerfile <path>` required
- `--cpus <count>`
- `--memory-mib <size>`
- `--disk-mib <size>`
- `--disk-gib <size>`
- `--ssh-user <user>`
- `--json [value]`

Notes:

- `--disk-mib` and `--disk-gib` are mutually exclusive.
- `create` requires a name and does not accept a user-supplied VM id.
- `create` requires an explicit Dockerfile path and does not fall back to any repo-local example Dockerfile
- the command creates the VM but does not boot it

### `microvm up <idOrName>`

Boots a created or stopped VM and waits for SSH readiness.

Accepted options:

- `--no-attach [value]`
- `--json [value]`

Notes:

- without `--no-attach`, the command prints the SSH command after the VM is reachable
- even with `--no-attach`, the command still waits for SSH readiness before returning
- `up` does not accept create-time flags such as `--cpus`, `--memory-mib`, `--disk-gib`, `--dockerfile`, or `--ssh-user`

### `microvm down <idOrName>`

Stops a running VM and tears down its runtime networking/process state.

Accepted options:

- `--json [value]`

### `microvm set <idOrName>`

Updates stored VM configuration.

Accepted options:

- `--cpus <count>`
- `--memory-mib <size>`
- `--disk-mib <size>`
- `--disk-gib <size>`
- `--ssh-user <user>`
- `--json [value]`

Notes:

- at least one mutable flag is required
- CPU and memory updates should be treated as next-boot settings
- changing `--ssh-user` updates what the CLI records and later targets for SSH
- disk resizing is grow-only
- disk resizing is rejected while the VM is running
- `--disk-mib` and `--disk-gib` are mutually exclusive

### `microvm ssh <idOrName> [command...]`

If no command is given, the CLI opens an interactive SSH session.

If a trailing command is given, the CLI executes it over SSH.

Accepted options:

- `--json [value]`

Notes:

- the VM must already be running
- `--json` preserves the rendered SSH command for scripting instead of opening an interactive session
- trailing arguments are joined into a single remote command

### `microvm list`

Lists tracked VMs.

Accepted options:

- `--json [value]`

Human output shows:

- name
- id
- status
- guest IP
- Firecracker PID when available

### `microvm status <idOrName>`

Shows stored VM configuration plus tracked runtime metadata for one VM.

Accepted options:

- `--json [value]`

Human output shows:

- status
- guest IP
- vCPU count
- memory
- disk size
- SSH user
- rootfs path
- tracked runtime details when the VM is running

Notes:

- this is a view of persisted state and tracked runtime metadata, not live introspection of the guest or Firecracker process

### `microvm delete <idOrName>`

Deletes a VM record and its on-disk artifacts.

Accepted options:

- `--json [value]`

Notes:

- deleting a running VM auto-stops it first
- the CLI refuses deletion if persisted paths point outside configured runtime roots

## JSON Mode

Every command supports `--json`.

Examples:

```bash
microvm list --json
microvm status api-dev --json
microvm doctor --json
```

The current CLI also accepts explicit boolean values such as:

```bash
microvm list --json true
microvm up api-dev --no-attach false
```

That is flexible, but it is less typical than plain boolean flags, so users will usually only need the bare flag form.

`--json` is available on every top-level command.

JSON payloads are command-specific. Use them for scripting and automation, and treat each command's schema as its own contract.

## Identifiers And Names

Most lifecycle commands accept either a VM id or VM name as `<idOrName>`.

In practice, the common flow is:

1. create with a stable human name
2. use that name in day-to-day commands
3. fall back to the VM id when scripting or debugging

## State And Paths

By default, the CLI stores state in XDG-style directories under the current user's home directory.

Useful current behavior:

- `MICROVM_HOME=.microvm` forces a project-local state directory
- the shared SSH keypair is managed by the CLI

## Current UX Observations

From a user perspective, the strongest parts of the current CLI are:

- the verb set is small and predictable
- the lifecycle maps well to how users think about a VM
- `help`, `list`, `status`, and `doctor` are easy to discover
- most domain errors include a concrete next-step hint
- JSON output is consistent enough to support shell scripting and e2e tests

The rougher edges in the current UX are:

- defaults are real but mostly hidden from `--help`, so users have to read docs or code to learn them
- `--no-attach` sounds like it should return immediately, but it still waits for SSH readiness
- `ssh` is practical once understood, but the dual behavior "print a command" vs "run a command" is not obvious at first glance
- `doctor` reports what failed, but not yet in a remediation-oriented way
- some commands are operationally opinionated in useful ways, but the help text does not surface those opinions

## Current UX Writing Observations

The writing is already better than average in a few places:

- command names are plain and direct
- summaries are short and consistent
- many errors include a useful hint instead of only a failure message
- root help grouping helps the command list scan well

The writing still has OSS-readiness gaps:

- some help text is accurate but not explanatory enough for a first-time user
- several flags describe what they are, but not when a user should reach for them
- defaults and side effects are under-documented in the help surface
- the CLI speaks clearly once a command fails, but it could teach more before the user makes the mistake
