# Install `microvm`

`microvm` is currently a beta Linux-only CLI for local Firecracker workflows. The supported install path today is from source with Bun.

## One-command install to `~/.local/bin`

```bash
bun run install:cli
```

This command does all steps:

- installs dependencies (`bun install`)
- runs host checks (`bun src/index.ts doctor`)
- builds the standalone binary (`bun run build:binary`)
- installs `microvm` into `~/.local/bin/microvm`

If `~/.local/bin` is not in PATH, the script prints the export line to add.

## Build only

```text
bun run build:binary
```

This produces:

```text
dist/microvm
```

## Verify

```bash
microvm help
microvm doctor
```

`microvm doctor` currently checks:

- required binaries: `firecracker`, `jailer`, `curl`, `ip`, `iptables`, `ssh`
- `/dev/kvm` read/write access
- cgroup v2 availability

It exits non-zero when the host is not ready.

## Uninstall and Cleanup

```bash
bun run uninstall:cli
```

This command:

- deletes all tracked VMs via `microvm delete [id|name]` (turns them down first when needed)
- removes local microvm state directories
- removes `~/.local/bin/microvm`

## Notes

- `microvm create` requires `--dockerfile PATH`. The CLI does not fall back to a repo-local example Dockerfile.
- State directory behavior:
  - standard mode: XDG directories (`$XDG_DATA_HOME`, `$XDG_STATE_HOME`, `$XDG_CACHE_HOME`, `$XDG_RUNTIME_DIR`)
  - HOME fallbacks: `~/.local/share/microvm`, `~/.local/state/microvm`, `~/.cache/microvm`
  - dev-local override: set `MICROVM_HOME=.microvm`
  - convenience command: `bun run start -- <args>`
