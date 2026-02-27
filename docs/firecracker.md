# Firecracker for orchestrator: Technical Reference

> This document is contextualized for the **orchestrator** project - a personal AI development system using Firecracker microVMs as isolated sandboxes.

---

## Rootfs Provisioning Gotchas

> **Read this first!** These issues caused multi-session debugging efforts. Learn from our pain.

### Docker Build Artifacts Persist in Rootfs

When building rootfs from Docker images via `docker export`, container build artifacts persist:

| Artifact | Problem | Solution |
|----------|---------|----------|
| `/.dockerenv` | OpenRC detects Docker environment, skips normal init | `rm -f /.dockerenv` in Dockerfile |
| File ownership | Files created by host have UID 0, not container user | `chown` to target user UID after writing |

### File Ownership Requirements

**SSH is strict about ownership.** The `authorized_keys` file MUST be owned by the target user:

```bash
# WRONG: Written from host as root
writeFileSync('/rootfs/home/dev/.ssh/authorized_keys', key)
# Result: "Permission denied (publickey)" - SSH rejects root-owned keys

# CORRECT: Set ownership after writing
writeFileSync('/rootfs/home/dev/.ssh/authorized_keys', key)
chownSync('/rootfs/home/dev/.ssh/authorized_keys', 1000, 1000)  # dev = UID 1000
```

**General principle:** When writing files into extracted rootfs from host:
1. Parse target user's UID from `/etc/passwd` in the rootfs
2. `chown` the file to that UID after writing

### OpenRC Console Output

OpenRC captures stdout from `/etc/local.d/*.start` scripts. To ensure output reaches serial console for debugging:

```bash
#!/bin/sh
exec > /dev/console 2>&1  # Redirect to console explicitly
echo "[network.start] Starting..."
```

### Serial Console is Essential

Without serial console capture, VM boot issues are invisible. Always wire Firecracker's stdout for debugging:

```typescript
const proc = Bun.spawn(['firecracker', '--api-sock', socketPath], {
  stdout: 'pipe',  // Capture serial output
  stderr: 'pipe',
})
// Buffer and log lines prefixed with [VM:id]
```

---

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [API Reference](#api-reference)
3. [Building Rootfs from Docker Images](#building-rootfs-from-docker-images)
4. [Network Setup](#network-setup)
5. [Domain-Based Firewall](#domain-based-firewall)
6. [SSH Key Management](#ssh-key-management)
7. [Snapshots](#snapshots)
8. [Running Docker Inside MicroVMs](#running-docker-inside-microvms)
9. [TypeScript SDK Design](#typescript-sdk-design)
10. [Jailer (Production Security)](#jailer-production-security)
11. [Troubleshooting](#troubleshooting)
12. [Open Questions & Future Work](#open-questions--future-work)

---

## Core Concepts

### What is Firecracker?

Firecracker is a Virtual Machine Monitor (VMM) that creates lightweight microVMs with:

- **~125ms boot time** - Fast enough for on-demand sandbox creation
- **<5MB memory overhead** per VM - Run many sandboxes on one host
- **Full KVM isolation** - Separate kernel per VM (not shared like containers)
- **Minimal attack surface** - Only essential devices (virtio-blk, virtio-net, serial console)

### Why Firecracker for orchestrator?

| Requirement | How Firecracker Helps |
|-------------|----------------------|
| Full AI permissions | Root access inside VM cannot affect host |
| Docker support | Can run Docker inside VM (nested virtualization) |
| Fast startup | ~125ms boot vs ~30s for traditional VMs |
| Persistence | Snapshot/restore for session continuity |
| Multiple sandboxes | Low overhead allows many concurrent VMs |
| Security | KVM hardware isolation + Jailer for defense-in-depth |

### Firecracker Process Model

```
┌─────────────────────────────────────────────────────────────────────┐
│  Host System                                                        │
│                                                                     │
│  ┌─────────────────────┐   ┌─────────────────────┐                 │
│  │ firecracker (pid 1) │   │ firecracker (pid 2) │   ...           │
│  │ ├── Unix Socket API │   │ ├── Unix Socket API │                 │
│  │ └── sandbox-a VM    │   │ └── sandbox-b VM    │                 │
│  └─────────────────────┘   └─────────────────────┘                 │
│         │                          │                                │
│  /tmp/sandbox-a.sock        /tmp/sandbox-b.sock                    │
│                                                                     │
│  One Firecracker process = One microVM                             │
│  Each has its own API socket                                        │
└─────────────────────────────────────────────────────────────────────┘
```

**Key insight:** Each sandbox gets its own Firecracker process with a dedicated Unix socket for API communication.

---

## API Reference

Firecracker exposes a RESTful API over a Unix domain socket. All communication is HTTP/JSON.

### API Socket Communication

```bash
# Start Firecracker with API socket
firecracker --api-sock /tmp/firecracker.socket

# All API calls go through this socket
curl --unix-socket /tmp/firecracker.socket \
     -X PUT "http://localhost/machine-config" \
     -H "Content-Type: application/json" \
     -d '{"vcpu_count": 2, "mem_size_mib": 1024}'
```

### Core Endpoints

| Endpoint | Method | Phase | Description |
|----------|--------|-------|-------------|
| `/boot-source` | PUT | Pre-boot | Set kernel and boot args |
| `/drives/{id}` | PUT | Pre-boot | Add block device (rootfs) |
| `/machine-config` | PUT | Pre-boot | Set vCPUs and memory |
| `/network-interfaces/{id}` | PUT | Pre-boot | Add network interface |
| `/vsock` | PUT | Pre-boot | Add vsock device |
| `/actions` | PUT | Any | InstanceStart, SendCtrlAltDel, FlushMetrics |
| `/vm` | PATCH | Post-boot | Pause/Resume VM |
| `/snapshot/create` | PUT | Post-boot | Create snapshot (VM must be paused) |
| `/snapshot/load` | PUT | Pre-boot | Load from snapshot |

### Request/Response Schemas

#### Boot Source
```typescript
interface BootSource {
  kernel_image_path: string;  // Path to uncompressed vmlinux
  boot_args?: string;         // Kernel command line
  initrd_path?: string;       // Optional initrd
}
```

#### Machine Configuration
```typescript
interface MachineConfiguration {
  vcpu_count: number;         // 1-32 vCPUs
  mem_size_mib: number;       // Memory in MiB
  smt?: boolean;              // Simultaneous multithreading (default: false)
  track_dirty_pages?: boolean; // For diff snapshots (default: false)
}
```

#### Drive (Block Device)
```typescript
interface Drive {
  drive_id: string;           // Unique ID for this drive
  path_on_host: string;       // Path to ext4 image
  is_root_device: boolean;    // Is this the rootfs?
  is_read_only?: boolean;     // Read-only mount (default: false)
  cache_type?: 'Unsafe' | 'Writeback';  // Caching strategy
  io_engine?: 'Sync' | 'Async';         // Async requires kernel 5.10.51+
  rate_limiter?: RateLimiter; // I/O rate limiting
}
```

#### Network Interface
```typescript
interface NetworkInterface {
  iface_id: string;           // Interface identifier
  host_dev_name: string;      // TAP device name on host
  guest_mac?: string;         // MAC address (auto-generated if not set)
  rx_rate_limiter?: RateLimiter;
  tx_rate_limiter?: RateLimiter;
}
```

#### VM State
```typescript
interface Vm {
  state: 'Paused' | 'Resumed';
}
```

#### Instance Action
```typescript
interface InstanceActionInfo {
  action_type: 'InstanceStart' | 'SendCtrlAltDel' | 'FlushMetrics';
}
```

#### Snapshot Create
```typescript
interface SnapshotCreateParams {
  snapshot_type: 'Full' | 'Diff';
  snapshot_path: string;      // VM state file
  mem_file_path: string;      // Memory dump file
}
```

#### Snapshot Load
```typescript
interface SnapshotLoadParams {
  snapshot_path: string;
  mem_backend: {
    backend_type: 'File' | 'Uffd';
    backend_path: string;
  };
  enable_diff_snapshots?: boolean;
  resume_vm?: boolean;        // Auto-resume after load
}
```

### API Flow for Starting a VM

```
┌─────────────────────────────────────────────────────────────────┐
│  1. Start Firecracker process                                   │
│     firecracker --api-sock /tmp/fc.sock                         │
├─────────────────────────────────────────────────────────────────┤
│  2. Configure boot source (kernel)                              │
│     PUT /boot-source                                            │
├─────────────────────────────────────────────────────────────────┤
│  3. Configure root drive                                        │
│     PUT /drives/rootfs                                          │
├─────────────────────────────────────────────────────────────────┤
│  4. Configure machine (vCPUs, memory)                           │
│     PUT /machine-config                                         │
├─────────────────────────────────────────────────────────────────┤
│  5. Configure network (optional)                                │
│     PUT /network-interfaces/eth0                                │
├─────────────────────────────────────────────────────────────────┤
│  6. Start the VM                                                │
│     PUT /actions { "action_type": "InstanceStart" }             │
├─────────────────────────────────────────────────────────────────┤
│  VM is now running!                                             │
│  Access via: serial console, SSH, or vsock                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Building Rootfs from Docker Images

This is a critical path for orchestrator: converting Docker images to Firecracker-bootable ext4 filesystems.

### Method 1: Docker Export + mkfs.ext4 (Recommended)

```bash
#!/bin/bash
# build-rootfs.sh - Convert Docker image to ext4 rootfs

DOCKER_IMAGE="$1"           # e.g., "orchestrator-base:latest"
OUTPUT_FILE="$2"            # e.g., "rootfs.ext4"
SIZE_MB="${3:-4096}"        # Default 4GB

# Create temporary container and export filesystem
CONTAINER_ID=$(docker create "$DOCKER_IMAGE")
docker export "$CONTAINER_ID" > /tmp/rootfs.tar
docker rm "$CONTAINER_ID"

# Create ext4 filesystem
truncate -s "${SIZE_MB}M" "$OUTPUT_FILE"
mkfs.ext4 -F "$OUTPUT_FILE"

# Mount and populate
MOUNT_DIR=$(mktemp -d)
sudo mount -o loop "$OUTPUT_FILE" "$MOUNT_DIR"
sudo tar -xf /tmp/rootfs.tar -C "$MOUNT_DIR"

# Ensure init system exists
if [ ! -f "$MOUNT_DIR/sbin/init" ]; then
    echo "ERROR: No /sbin/init found. Ensure image has systemd or another init."
    exit 1
fi

# Cleanup
sudo umount "$MOUNT_DIR"
rm -rf "$MOUNT_DIR" /tmp/rootfs.tar

echo "Created $OUTPUT_FILE (${SIZE_MB}MB)"
```

### Method 2: Direct Population (No Docker Daemon)

```bash
#!/bin/bash
# For CI/CD where Docker daemon isn't available

OUTPUT_FILE="rootfs.ext4"
SIZE_MB=4096

# Create and format
truncate -s "${SIZE_MB}M" "$OUTPUT_FILE"
mkfs.ext4 -F "$OUTPUT_FILE"

# Mount
MOUNT_DIR=$(mktemp -d)
sudo mount -o loop "$OUTPUT_FILE" "$MOUNT_DIR"

# Populate with Alpine base (minimal)
ALPINE_VERSION="3.19"
wget -O- "https://dl-cdn.alpinelinux.org/alpine/v${ALPINE_VERSION}/releases/x86_64/alpine-minirootfs-${ALPINE_VERSION}.0-x86_64.tar.gz" | \
    sudo tar -xzf - -C "$MOUNT_DIR"

# Install additional packages via chroot
sudo chroot "$MOUNT_DIR" /bin/sh -c "
    apk update
    apk add --no-cache openssh-server docker git nodejs npm python3
"

sudo umount "$MOUNT_DIR"
```

### orchestrator Base Dockerfile

```dockerfile
# templates/base/Dockerfile
FROM ubuntu:22.04

# Prevent interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# System packages
RUN apt-get update && apt-get install -y \
    # Init system
    systemd systemd-sysv \
    # SSH access
    openssh-server \
    # Docker (for nested containers)
    docker.io docker-compose \
    # Development tools
    git curl wget vim \
    nodejs npm python3 python3-pip \
    build-essential \
    # Shell
    zsh \
    && rm -rf /var/lib/apt/lists/*

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash

# Install Claude Code
RUN npm install -g @anthropic/claude-code

# Create dev user
RUN useradd -m -s /bin/zsh dev && \
    usermod -aG docker dev && \
    echo "dev ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# SSH setup
RUN mkdir -p /home/dev/.ssh && \
    chown -R dev:dev /home/dev/.ssh && \
    chmod 700 /home/dev/.ssh && \
    # Enable SSH daemon
    mkdir -p /run/sshd && \
    sed -i 's/#PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config && \
    sed -i 's/#PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config && \
    echo "AllowUsers dev" >> /etc/ssh/sshd_config

# Enable services
RUN systemctl enable ssh && \
    systemctl enable docker

# Default user
USER dev
WORKDIR /home/dev
```

### Kernel Requirements

The guest kernel must have:
- `CONFIG_VIRTIO_BLK=y` - Virtio block device
- `CONFIG_VIRTIO_NET=y` - Virtio network
- `CONFIG_VIRTIO_CONSOLE=y` - Serial console
- `CONFIG_EXT4_FS=y` - ext4 filesystem

**Pre-built kernels:** Download from Firecracker CI:
```bash
ARCH=$(uname -m)
wget "https://s3.amazonaws.com/spec.ccfc.min/firecracker-ci/v1.11/${ARCH}/vmlinux-5.10.225"
```

### Boot Arguments for orchestrator

```bash
BOOT_ARGS="console=ttyS0 reboot=k panic=1 pci=off ip=172.16.0.2::172.16.0.1:255.255.255.0::eth0:off"
```

| Argument | Purpose |
|----------|---------|
| `console=ttyS0` | Direct kernel output to serial console |
| `reboot=k` | Don't reboot on panic (halt instead) |
| `panic=1` | Wait 1 second before halt on panic |
| `pci=off` | Disable PCI (Firecracker uses MMIO for virtio) |
| `ip=...` | Configure static IP without DHCP |

---

## Network Setup

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  Host                                                               │
│                                                                     │
│  ┌──────────────┐                                                   │
│  │   Internet   │                                                   │
│  │   (eth0)     │                                                   │
│  └──────┬───────┘                                                   │
│         │ MASQUERADE (NAT)                                          │
│         │                                                           │
│  ┌──────┴───────┐                                                   │
│  │   iptables   │  (domain-based firewall rules)                    │
│  └──────┬───────┘                                                   │
│         │                                                           │
│  ┌──────┴───────┐  ┌─────────────┐  ┌─────────────┐                │
│  │  tap-sbx-a   │  │  tap-sbx-b  │  │  tap-sbx-c  │                │
│  │ 172.16.0.1   │  │ 172.16.1.1  │  │ 172.16.2.1  │                │
│  └──────┬───────┘  └──────┬──────┘  └──────┬──────┘                │
│         │                 │                │                        │
│  ┌──────┴───────┐  ┌──────┴──────┐  ┌──────┴──────┐                │
│  │  Sandbox A   │  │  Sandbox B  │  │  Sandbox C  │                │
│  │ 172.16.0.2   │  │ 172.16.1.2  │  │ 172.16.2.2  │                │
│  └──────────────┘  └─────────────┘  └─────────────┘                │
└─────────────────────────────────────────────────────────────────────┘
```

### IP Allocation Strategy

Each sandbox gets its own /30 subnet:

| Sandbox | Subnet | Host (TAP) IP | Guest IP | Broadcast |
|---------|--------|---------------|----------|-----------|
| sandbox-a | 172.16.0.0/30 | 172.16.0.1 | 172.16.0.2 | 172.16.0.3 |
| sandbox-b | 172.16.1.0/30 | 172.16.1.1 | 172.16.1.2 | 172.16.1.3 |
| sandbox-c | 172.16.2.0/30 | 172.16.2.1 | 172.16.2.2 | 172.16.2.3 |

### Creating TAP Devices

```bash
#!/bin/bash
# create-tap.sh <sandbox-name> <subnet-index>

SANDBOX_NAME="$1"
SUBNET_INDEX="$2"   # 0, 1, 2, ...

TAP_DEV="tap-${SANDBOX_NAME}"
HOST_IP="172.16.${SUBNET_INDEX}.1"
GUEST_IP="172.16.${SUBNET_INDEX}.2"
MASK="/30"

# Create TAP device
sudo ip tuntap add dev "$TAP_DEV" mode tap user "$USER"
sudo ip addr add "${HOST_IP}${MASK}" dev "$TAP_DEV"
sudo ip link set dev "$TAP_DEV" up

echo "Created $TAP_DEV with host IP $HOST_IP, guest will use $GUEST_IP"
```

### Host Network Configuration

```bash
#!/bin/bash
# setup-host-network.sh

# Enable IP forwarding
sudo sysctl -w net.ipv4.ip_forward=1
echo "net.ipv4.ip_forward=1" | sudo tee -a /etc/sysctl.conf

# Get default internet interface
HOST_IFACE=$(ip -j route list default | jq -r '.[0].dev')

# Enable NAT for all sandbox subnets
sudo iptables -t nat -A POSTROUTING -s 172.16.0.0/16 -o "$HOST_IFACE" -j MASQUERADE

# Allow forwarding
sudo iptables -A FORWARD -i "tap-+" -o "$HOST_IFACE" -j ACCEPT
sudo iptables -A FORWARD -i "$HOST_IFACE" -o "tap-+" -m state --state RELATED,ESTABLISHED -j ACCEPT
```

### MAC Address Generation

Firecracker can auto-generate MACs, but for consistency:

```typescript
function generateMac(sandboxIndex: number): string {
  // Format: 06:00:AC:10:XX:02
  // 06:00 = locally administered, unicast
  // AC:10 = 172.16 (the subnet we use)
  // XX = sandbox index
  // 02 = guest (.2 in the /30)
  const hex = sandboxIndex.toString(16).padStart(2, '0').toUpperCase();
  return `06:00:AC:10:${hex}:02`;
}
```

### Firecracker API Call

```typescript
const networkConfig = {
  iface_id: 'eth0',
  host_dev_name: `tap-${sandboxName}`,
  guest_mac: generateMac(sandboxIndex),
};

await fetch(`http://localhost/network-interfaces/eth0`, {
  socketPath: `/tmp/${sandboxName}.sock`,
  method: 'PUT',
  body: JSON.stringify(networkConfig),
});
```

### Guest Network Configuration via Kernel Args

Pass network config via kernel boot args (no DHCP needed):

```
ip=<guest-ip>::<gateway>:<netmask>:<hostname>:<device>:off
ip=172.16.0.2::172.16.0.1:255.255.255.0:sandbox-a:eth0:off
```

Or configure inside the guest:

```bash
# In guest /etc/network/interfaces or via systemd-networkd
ip addr add 172.16.0.2/30 dev eth0
ip route add default via 172.16.0.1
echo "nameserver 8.8.8.8" > /etc/resolv.conf
```

---

## Domain-Based Firewall

### Implementation Options

| Approach | Pros | Cons |
|----------|------|------|
| **iptables + ipset** | Well-known, mature | DNS resolution happens once |
| **nftables + sets** | Modern, integrated | Similar DNS limitation |
| **eBPF + DNS proxy** | Real-time DNS | Complex to implement |
| **Transparent proxy (squid)** | Full inspection | Performance overhead |

### Recommended: iptables + DNS Resolution Script

```bash
#!/bin/bash
# firewall-update.sh - Run periodically (cron) to refresh DNS

SANDBOX_NAME="$1"
IPSET_NAME="allow-${SANDBOX_NAME}"

# Allowlist from project config
ALLOWED_DOMAINS=(
  "github.com"
  "api.github.com"
  "registry.npmjs.org"
  "api.anthropic.com"
  "api.linear.app"
)

# Create or flush ipset
sudo ipset create "$IPSET_NAME" hash:ip timeout 300 -exist
sudo ipset flush "$IPSET_NAME"

# Resolve each domain and add IPs
for domain in "${ALLOWED_DOMAINS[@]}"; do
  IPS=$(dig +short "$domain" | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$')
  for ip in $IPS; do
    sudo ipset add "$IPSET_NAME" "$ip" -exist
  done
done

echo "Updated $IPSET_NAME with ${#ALLOWED_DOMAINS[@]} domains"
```

### iptables Rules per Sandbox

```bash
#!/bin/bash
# setup-sandbox-firewall.sh <sandbox-name>

SANDBOX_NAME="$1"
TAP_DEV="tap-${SANDBOX_NAME}"
IPSET_NAME="allow-${SANDBOX_NAME}"

# Drop all outgoing by default
sudo iptables -A FORWARD -i "$TAP_DEV" -j DROP

# Allow DNS (so guest can resolve)
sudo iptables -I FORWARD -i "$TAP_DEV" -p udp --dport 53 -j ACCEPT
sudo iptables -I FORWARD -i "$TAP_DEV" -p tcp --dport 53 -j ACCEPT

# Allow established connections
sudo iptables -I FORWARD -i "$TAP_DEV" -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow only IPs in the allowlist ipset
sudo iptables -I FORWARD -i "$TAP_DEV" -m set --match-set "$IPSET_NAME" dst -j ACCEPT

# Allow internal communication (host <-> guest)
sudo iptables -I FORWARD -i "$TAP_DEV" -d 172.16.0.0/16 -j ACCEPT
```

### TypeScript Firewall Manager

```typescript
interface FirewallConfig {
  sandboxName: string;
  allowedDomains: string[];
}

class FirewallManager {
  async updateRules(config: FirewallConfig): Promise<void> {
    const ipsetName = `allow-${config.sandboxName}`;

    // Resolve domains to IPs
    const ips = await this.resolveDomains(config.allowedDomains);

    // Update ipset
    await this.exec(`ipset flush ${ipsetName}`);
    for (const ip of ips) {
      await this.exec(`ipset add ${ipsetName} ${ip} -exist`);
    }
  }

  private async resolveDomains(domains: string[]): Promise<string[]> {
    const ips: string[] = [];
    for (const domain of domains) {
      const result = await dns.resolve4(domain);
      ips.push(...result);
    }
    return [...new Set(ips)]; // Dedupe
  }
}
```

### Refresh Strategy

Run domain resolution every 5 minutes via cron or systemd timer:

```bash
# /etc/cron.d/orchestrator-firewall
*/5 * * * * root /usr/local/bin/orchestrator-firewall-refresh
```

---

## SSH Key Management

### Key Injection Strategy

```
┌─────────────────────────────────────────────────────────────────────┐
│  Key Management Flow                                                │
│                                                                     │
│  1. User's ~/.ssh/id_rsa.pub (or generate dedicated key)           │
│                          │                                          │
│                          ▼                                          │
│  2. Copy to rootfs: /home/dev/.ssh/authorized_keys                 │
│                          │                                          │
│                          ▼                                          │
│  3. Boot VM with prepared rootfs                                   │
│                          │                                          │
│                          ▼                                          │
│  4. SSH: ssh -i ~/.ssh/id_rsa dev@172.16.X.2                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Injecting Keys into Rootfs

```bash
#!/bin/bash
# inject-ssh-key.sh <rootfs-path> <pubkey-path>

ROOTFS="$1"
PUBKEY="$2"

MOUNT_DIR=$(mktemp -d)
sudo mount -o loop "$ROOTFS" "$MOUNT_DIR"

# Inject public key
sudo mkdir -p "$MOUNT_DIR/home/dev/.ssh"
sudo cp "$PUBKEY" "$MOUNT_DIR/home/dev/.ssh/authorized_keys"
sudo chmod 700 "$MOUNT_DIR/home/dev/.ssh"
sudo chmod 600 "$MOUNT_DIR/home/dev/.ssh/authorized_keys"
sudo chown -R 1000:1000 "$MOUNT_DIR/home/dev/.ssh"  # UID 1000 = dev user

sudo umount "$MOUNT_DIR"
rm -rf "$MOUNT_DIR"
```

### Per-Sandbox Key Generation (Recommended)

Generate a unique keypair per sandbox for better isolation:

```typescript
import { generateKeyPairSync } from 'crypto';
import { writeFileSync } from 'fs';

function generateSandboxKeys(sandboxId: string): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 4096,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  // Convert to OpenSSH format for authorized_keys
  const sshPublicKey = convertToOpenSSH(publicKey);

  const keyDir = `~/.orchestrator/keys/${sandboxId}`;
  writeFileSync(`${keyDir}/id_rsa`, privateKey, { mode: 0o600 });
  writeFileSync(`${keyDir}/id_rsa.pub`, sshPublicKey, { mode: 0o644 });

  return { publicKey: sshPublicKey, privateKey };
}
```

### SSH Config Generation

```typescript
function generateSSHConfig(sandboxes: Sandbox[]): string {
  return sandboxes.map(s => `
Host ${s.name}
    HostName ${s.ip}
    User dev
    IdentityFile ~/.orchestrator/keys/${s.id}/id_rsa
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
`).join('\n');
}

// Write to ~/.ssh/config.d/orchestrator (or append to ~/.ssh/config)
```

---

## Snapshots

### Snapshot Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Snapshot Files                                                     │
│                                                                     │
│  ~/.orchestrator/data/snapshots/<snapshot-id>/                            │
│  ├── vmstate.snap      # CPU/device state (small, ~KB)             │
│  ├── memory.mem        # Full memory dump (size = VM RAM)          │
│  └── metadata.json     # orchestrator metadata                             │
│                                                                     │
│  Note: Disk state is NOT included - handle separately              │
└─────────────────────────────────────────────────────────────────────┘
```

### Snapshot Types

| Type | Use Case | Size | Speed |
|------|----------|------|-------|
| **Full** | First snapshot, baseline | VM RAM size | Fast |
| **Diff** | Incremental after full | Changed pages only | Very fast |

### Creating a Snapshot

```typescript
async function createSnapshot(
  socketPath: string,
  snapshotPath: string,
  memoryPath: string,
  type: 'Full' | 'Diff' = 'Full'
): Promise<void> {
  // 1. Pause the VM
  await apiCall(socketPath, 'PATCH', '/vm', { state: 'Paused' });

  // 2. Create snapshot
  await apiCall(socketPath, 'PUT', '/snapshot/create', {
    snapshot_type: type,
    snapshot_path: snapshotPath,
    mem_file_path: memoryPath,
  });

  // 3. Optionally resume
  await apiCall(socketPath, 'PATCH', '/vm', { state: 'Resumed' });
}
```

### Loading a Snapshot

```typescript
async function loadSnapshot(
  socketPath: string,
  snapshotPath: string,
  memoryPath: string,
  resumeImmediately: boolean = true
): Promise<void> {
  // Must be called on a fresh Firecracker process (before any config)
  await apiCall(socketPath, 'PUT', '/snapshot/load', {
    snapshot_path: snapshotPath,
    mem_backend: {
      backend_type: 'File',
      backend_path: memoryPath,
    },
    enable_diff_snapshots: false,
    resume_vm: resumeImmediately,
  });
}
```

### Disk State Strategy

Firecracker snapshots don't include disk. Options:

1. **Copy-on-Write with Overlays:**
   ```bash
   # Create overlay for each session
   cp base-rootfs.ext4 sandbox-a-rootfs.ext4
   # Snapshot this file alongside memory
   ```

2. **Snapshot at filesystem level:**
   ```bash
   # If using ZFS or Btrfs
   btrfs subvolume snapshot /vms/sandbox-a /snapshots/sandbox-a-v1
   ```

3. **Read-only base + writable overlay:**
   ```bash
   # Use dm-snapshot or overlayfs in the guest
   ```

### orchestrator Snapshot Workflow

```
┌─────────────────────────────────────────────────────────────────────┐
│  Snapshot Create                                                    │
│                                                                     │
│  1. User: orchestrator sandbox snapshot create my-sandbox --label v1       │
│  2. Daemon: Pause VM                                                │
│  3. Daemon: Copy rootfs.ext4 → snapshots/v1/rootfs.ext4            │
│  4. Daemon: Call /snapshot/create                                   │
│  5. Daemon: Save metadata to SQLite                                 │
│  6. Daemon: Resume VM                                               │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  Snapshot Restore                                                   │
│                                                                     │
│  1. User: orchestrator sandbox snapshot restore my-sandbox v1              │
│  2. Daemon: Stop current VM (if running)                            │
│  3. Daemon: Copy snapshots/v1/rootfs.ext4 → vms/my-sandbox/rootfs  │
│  4. Daemon: Start fresh Firecracker process                         │
│  5. Daemon: Call /snapshot/load                                     │
│  6. VM resumes from saved state                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Running Docker Inside MicroVMs

### Requirements

The guest kernel needs:
- `CONFIG_CGROUPS=y`
- `CONFIG_NAMESPACES=y`
- `CONFIG_OVERLAY_FS=y`
- `CONFIG_NETFILTER=y`
- `CONFIG_BRIDGE=y`

### Docker Daemon Configuration

Inside the sandbox rootfs, configure Docker:

```json
// /etc/docker/daemon.json
{
  "storage-driver": "overlay2",
  "iptables": true,
  "dns": ["8.8.8.8", "8.8.4.4"]
}
```

### Network Bridge Setup

Docker creates its own bridge (`docker0`). The guest network layout:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Inside Sandbox VM                                                  │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │  Container A    │    Container B    │    Container C            ││
│  │  (web app)      │    (database)     │    (redis)                ││
│  │  172.17.0.2     │    172.17.0.3     │    172.17.0.4             ││
│  └────────┬────────┴────────┬──────────┴────────┬──────────────────┘│
│           └─────────────────┼──────────────────┘                    │
│                             │                                        │
│  ┌──────────────────────────┴──────────────────────────────────────┐│
│  │                     docker0 bridge                               ││
│  │                     172.17.0.1                                   ││
│  └──────────────────────────┬──────────────────────────────────────┘│
│                             │ NAT                                    │
│  ┌──────────────────────────┴──────────────────────────────────────┐│
│  │                     eth0 (virtio-net)                            ││
│  │                     172.16.X.2                                   ││
│  └──────────────────────────┬──────────────────────────────────────┘│
└─────────────────────────────┼───────────────────────────────────────┘
                              │
                    TAP device on host
```

### Cgroups v2 Compatibility

Ubuntu 22.04+ uses cgroups v2 by default. Ensure the kernel supports it:

```bash
# Check cgroup version in guest
cat /sys/fs/cgroup/cgroup.controllers
```

### Docker Build Performance

For faster builds inside the sandbox:
- Use BuildKit (`DOCKER_BUILDKIT=1`)
- Mount build cache from host (via virtiofs, if supported)
- Pre-pull common base images in the rootfs

---

## TypeScript SDK Design

### Package Structure

```
services/sandbox/src/adapters/firecracker/
├── src/
│   ├── index.ts           # Public exports
│   ├── client.ts          # Main FirecrackerClient class
│   ├── api/
│   │   ├── boot-source.ts
│   │   ├── drives.ts
│   │   ├── machine-config.ts
│   │   ├── network.ts
│   │   ├── snapshots.ts
│   │   ├── vm.ts
│   │   └── actions.ts
│   ├── types/
│   │   └── index.ts       # All TypeScript interfaces
│   └── utils/
│       ├── socket.ts      # Unix socket HTTP client
│       └── process.ts     # Firecracker process management
├── package.json
└── tsconfig.json
```

### Core Client Implementation

```typescript
// services/sandbox/src/adapters/firecracker/src/client.ts

import { spawn, ChildProcess } from 'child_process';
import { UnixSocketClient } from './utils/socket';
import type {
  BootSource,
  MachineConfiguration,
  Drive,
  NetworkInterface,
  SnapshotCreateParams,
  SnapshotLoadParams,
  InstanceActionInfo,
  VmState,
} from './types';

export interface FirecrackerConfig {
  socketPath: string;
  firecrackerBin?: string;
  jailerBin?: string;
}

export class FirecrackerClient {
  private socketPath: string;
  private httpClient: UnixSocketClient;
  private process: ChildProcess | null = null;

  constructor(config: FirecrackerConfig) {
    this.socketPath = config.socketPath;
    this.httpClient = new UnixSocketClient(config.socketPath);
  }

  // ─────────────────────────────────────────────────────────────────
  // Process Management
  // ─────────────────────────────────────────────────────────────────

  async start(firecrackerBin: string = 'firecracker'): Promise<void> {
    // Remove existing socket
    await fs.rm(this.socketPath, { force: true });

    this.process = spawn(firecrackerBin, [
      '--api-sock', this.socketPath,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Wait for socket to be ready
    await this.waitForSocket();
  }

  private async waitForSocket(timeout: number = 5000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        await fs.access(this.socketPath);
        return;
      } catch {
        await new Promise(r => setTimeout(r, 50));
      }
    }
    throw new Error(`Socket ${this.socketPath} not ready after ${timeout}ms`);
  }

  async stop(): Promise<void> {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Pre-boot Configuration
  // ─────────────────────────────────────────────────────────────────

  async setBootSource(config: BootSource): Promise<void> {
    await this.httpClient.put('/boot-source', config);
  }

  async setMachineConfig(config: MachineConfiguration): Promise<void> {
    await this.httpClient.put('/machine-config', config);
  }

  async addDrive(config: Drive): Promise<void> {
    await this.httpClient.put(`/drives/${config.drive_id}`, config);
  }

  async addNetworkInterface(config: NetworkInterface): Promise<void> {
    await this.httpClient.put(`/network-interfaces/${config.iface_id}`, config);
  }

  // ─────────────────────────────────────────────────────────────────
  // VM Lifecycle
  // ─────────────────────────────────────────────────────────────────

  async startInstance(): Promise<void> {
    await this.httpClient.put('/actions', {
      action_type: 'InstanceStart',
    });
  }

  async pause(): Promise<void> {
    await this.httpClient.patch('/vm', { state: 'Paused' });
  }

  async resume(): Promise<void> {
    await this.httpClient.patch('/vm', { state: 'Resumed' });
  }

  async sendCtrlAltDel(): Promise<void> {
    await this.httpClient.put('/actions', {
      action_type: 'SendCtrlAltDel',
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Snapshots
  // ─────────────────────────────────────────────────────────────────

  async createSnapshot(config: SnapshotCreateParams): Promise<void> {
    await this.pause();
    await this.httpClient.put('/snapshot/create', config);
  }

  async loadSnapshot(config: SnapshotLoadParams): Promise<void> {
    await this.httpClient.put('/snapshot/load', config);
  }

  // ─────────────────────────────────────────────────────────────────
  // Info
  // ─────────────────────────────────────────────────────────────────

  async getInfo(): Promise<InstanceInfo> {
    return this.httpClient.get('/');
  }

  async getVmConfig(): Promise<FullVmConfiguration> {
    return this.httpClient.get('/vm/config');
  }
}
```

### Unix Socket HTTP Client

```typescript
// services/sandbox/src/adapters/firecracker/src/utils/socket.ts

import http from 'http';

export class UnixSocketClient {
  constructor(private socketPath: string) {}

  async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const options: http.RequestOptions = {
        socketPath: this.socketPath,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
        },
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 204) {
            resolve(undefined as T);
            return;
          }

          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`API Error ${res.statusCode}: ${data}`));
            return;
          }

          try {
            resolve(JSON.parse(data) as T);
          } catch {
            resolve(data as unknown as T);
          }
        });
      });

      req.on('error', reject);

      if (body) {
        req.write(JSON.stringify(body));
      }

      req.end();
    });
  }

  get<T>(path: string): Promise<T> {
    return this.request('GET', path);
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request('PUT', path, body);
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request('PATCH', path, body);
  }
}
```

### Usage Example

```typescript
import { FirecrackerClient } from 'services/sandbox/src/adapters/firecracker';

async function createSandbox() {
  const fc = new FirecrackerClient({
    socketPath: '/tmp/sandbox-a.sock',
  });

  // Start Firecracker process
  await fc.start();

  // Configure VM
  await fc.setBootSource({
    kernel_image_path: '/opt/orchestrator/kernel/vmlinux',
    boot_args: 'console=ttyS0 reboot=k panic=1 pci=off',
  });

  await fc.addDrive({
    drive_id: 'rootfs',
    path_on_host: '/home/user/.orchestrator/data/vms/sandbox-a/rootfs.ext4',
    is_root_device: true,
    is_read_only: false,
  });

  await fc.setMachineConfig({
    vcpu_count: 4,
    mem_size_mib: 8192,
    smt: false,
  });

  await fc.addNetworkInterface({
    iface_id: 'eth0',
    host_dev_name: 'tap-sandbox-a',
    guest_mac: '06:00:AC:10:00:02',
  });

  // Boot the VM
  await fc.startInstance();

  console.log('Sandbox started! SSH with: ssh dev@172.16.0.2');
}
```

---

## Jailer (Production Security)

### What the Jailer Does

The Jailer wraps Firecracker with multiple security layers:

| Layer | Description |
|-------|-------------|
| **chroot** | Isolates Firecracker to a minimal directory |
| **Namespaces** | New mount, PID, network, IPC, UTS namespaces |
| **Cgroups** | CPU, memory, I/O limits |
| **Seccomp** | System call filtering |
| **Privilege Drop** | Runs as non-root user after setup |
| **FD Limiting** | Closes inherited file descriptors |

### Jailer Directory Structure

```
/srv/jailer/firecracker/<vm-id>/root/
├── firecracker           # Binary (copied, not symlinked)
├── dev/
│   ├── kvm              # KVM device
│   └── net/
│       └── tun          # TUN/TAP device
├── kernel/
│   └── vmlinux          # Kernel image
├── drives/
│   └── rootfs.ext4      # Root filesystem
└── run/
    └── firecracker.socket  # API socket
```

### Jailer Command

```bash
jailer \
  --id sandbox-a \
  --exec-file /usr/bin/firecracker \
  --uid 1000 \
  --gid 1000 \
  --chroot-base-dir /srv/jailer \
  --netns /var/run/netns/sandbox-a \
  --cgroup cpuset.cpus=0-3 \
  --cgroup cpuset.mems=0 \
  --daemonize \
  -- \
  --api-sock /run/firecracker.socket
```

### Network Namespace Setup

For full isolation, create a network namespace per sandbox:

```bash
# Create namespace
sudo ip netns add sandbox-a

# Move TAP device into namespace
sudo ip link set tap-sandbox-a netns sandbox-a

# Configure inside namespace
sudo ip netns exec sandbox-a ip addr add 172.16.0.1/30 dev tap-sandbox-a
sudo ip netns exec sandbox-a ip link set tap-sandbox-a up
```

### orchestrator Jailer Integration

```typescript
// In production, use jailer instead of direct firecracker

async function startWithJailer(sandboxId: string, config: SandboxConfig): Promise<void> {
  const jailDir = `/srv/jailer/firecracker/${sandboxId}/root`;

  // Prepare jail directory
  await fs.mkdir(jailDir, { recursive: true });
  await fs.mkdir(`${jailDir}/dev/net`, { recursive: true });
  await fs.mkdir(`${jailDir}/kernel`, { recursive: true });
  await fs.mkdir(`${jailDir}/drives`, { recursive: true });

  // Copy files (jailer requires files inside jail)
  await fs.copyFile(config.kernelPath, `${jailDir}/kernel/vmlinux`);
  await fs.copyFile(config.rootfsPath, `${jailDir}/drives/rootfs.ext4`);

  // Create network namespace
  await exec(`ip netns add ${sandboxId}`);
  await setupTapInNamespace(sandboxId, config.subnetIndex);

  // Start jailer
  const args = [
    '--id', sandboxId,
    '--exec-file', '/usr/bin/firecracker',
    '--uid', '1000',
    '--gid', '1000',
    '--chroot-base-dir', '/srv/jailer',
    '--netns', `/var/run/netns/${sandboxId}`,
    '--daemonize',
    '--',
    '--api-sock', '/run/firecracker.socket',
  ];

  await exec(`jailer ${args.join(' ')}`);

  // API socket is now at:
  // /srv/jailer/firecracker/<sandbox-id>/root/run/firecracker.socket
}
```

---

## Troubleshooting

### Common Issues

#### "Cannot access /dev/kvm"

```bash
# Check KVM is available
ls -la /dev/kvm

# Add user to kvm group
sudo usermod -aG kvm $USER

# Or set ACL
sudo setfacl -m u:$USER:rw /dev/kvm
```

#### "Socket already exists"

```bash
# Remove stale socket
rm -f /tmp/firecracker.socket

# Or use a unique socket per sandbox
firecracker --api-sock "/tmp/${SANDBOX_ID}.sock"
```

#### "VM doesn't boot" (no serial output)

1. Check kernel has `CONFIG_SERIAL_8250=y`
2. Ensure `console=ttyS0` in boot args
3. Verify kernel path is correct and file exists

#### "Network not working"

```bash
# Check TAP device exists
ip link show tap-sandbox-a

# Check IP forwarding
cat /proc/sys/net/ipv4/ip_forward  # Should be 1

# Check iptables NAT
iptables -t nat -L POSTROUTING -n
```

#### "Cannot SSH into VM"

1. Wait for VM to fully boot (SSH daemon needs to start)
2. Check SSH keys are injected correctly
3. Verify guest IP configuration
4. Test connectivity: `ping 172.16.0.2`

### Debugging Tips

```bash
# Enable Firecracker debug logging
firecracker --api-sock /tmp/fc.sock --log-path /tmp/fc.log --level Debug

# Watch serial output (in another terminal)
# Serial output goes to firecracker's stdout

# Check VM state via API
curl --unix-socket /tmp/fc.sock http://localhost/

# Get full VM config
curl --unix-socket /tmp/fc.sock http://localhost/vm/config
```

---

## Open Questions & Future Work

### Answered Questions

| Question | Answer |
|----------|--------|
| How to build rootfs from Docker? | `docker export` + `mkfs.ext4 -d` |
| Network setup? | TAP devices per sandbox + NAT via iptables |
| Firewall implementation? | iptables + ipset with periodic DNS resolution |
| SSH key management? | Inject pubkey into rootfs at `/home/dev/.ssh/authorized_keys` |

### Remaining Questions

| Question | Status | Notes |
|----------|--------|-------|
| GPU passthrough | Future (Phase 4+) | Requires VFIO, not natively supported by Firecracker |
| Live migration | Not supported | Use snapshot/restore instead |
| Hot-add CPU/memory | Not supported | Configure resources at boot |

### Future Enhancements

1. **virtiofs** for shared directories (faster than 9p, requires kernel 5.4+)
2. **Userfaultfd** for faster snapshot restore
3. **Balloon device** for dynamic memory management
4. **vhost-user** for better network performance

---

## References

- [Firecracker GitHub](https://github.com/firecracker-microvm/firecracker)
- [Firecracker OpenAPI Spec](https://github.com/firecracker-microvm/firecracker/blob/main/src/firecracker/swagger/firecracker.yaml)
- [Firecracker Getting Started](https://github.com/firecracker-microvm/firecracker/blob/main/docs/getting-started.md)
- [Firecracker Network Setup](https://github.com/firecracker-microvm/firecracker/blob/main/docs/network-setup.md)
- [Firecracker Snapshot Support](https://github.com/firecracker-microvm/firecracker/blob/main/docs/snapshotting/snapshot-support.md)
- [Firecracker Jailer](https://github.com/firecracker-microvm/firecracker/blob/main/docs/jailer.md)
