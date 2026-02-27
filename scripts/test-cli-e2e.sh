#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VM_ID="${1:-e2e$(date +%s | tail -c 7)}"
PERSIST_MARKER="${2:-persist-$RANDOM-$(date +%s)}"
KEEP_VM_ON_EXIT="${KEEP_VM_ON_EXIT:-0}"
WAS_DELETED="0"

require_cmd() {
  if command -v "$1" >/dev/null 2>&1; then
    return
  fi
  echo "[e2e] missing dependency: $1" >&2
  exit 2
}

require_cmd bun
require_cmd ssh
require_cmd timeout

run_cli() {
  (
    cd "$PROJECT_ROOT"
    bun src/index.ts "$@"
  )
}

print_step() {
  echo
  echo "[e2e] $1"
}

print_pass() {
  echo "[PASS] $1"
}

print_fail() {
  echo "[FAIL] $1" >&2
}

cleanup() {
  if [[ "$KEEP_VM_ON_EXIT" == "1" || "$WAS_DELETED" == "1" ]]; then
    return
  fi
  (
    cd "$PROJECT_ROOT"
    bun src/index.ts delete "$VM_ID" >/dev/null 2>&1 || true
  )
}

trap cleanup EXIT

STATUS_JSON=""
VM_RUNNING=""
VM_IP=""
VM_USER=""
VM_KEY=""
VM_HOME=""

load_status() {
  STATUS_JSON="$(run_cli status "$VM_ID")"
  VM_RUNNING="$(printf '%s' "$STATUS_JSON" | bun -e 'const fs = require("node:fs"); const j = JSON.parse(fs.readFileSync(0, "utf8")); process.stdout.write(j.running ? "1" : "0");')"
  VM_IP="$(printf '%s' "$STATUS_JSON" | bun -e 'const fs = require("node:fs"); const j = JSON.parse(fs.readFileSync(0, "utf8")); process.stdout.write(j.vm.guestIp);')"
  VM_USER="$(printf '%s' "$STATUS_JSON" | bun -e 'const fs = require("node:fs"); const j = JSON.parse(fs.readFileSync(0, "utf8")); process.stdout.write(j.vm.sshUser);')"
  VM_KEY="$(printf '%s' "$STATUS_JSON" | bun -e 'const fs = require("node:fs"); const j = JSON.parse(fs.readFileSync(0, "utf8")); process.stdout.write(j.vm.sshKeyPath);')"
}

assert_running() {
  local expected="$1"
  load_status
  if [[ "$VM_RUNNING" == "$expected" ]]; then
    return
  fi
  print_fail "expected running=$expected, got running=$VM_RUNNING for $VM_ID"
  exit 1
}

ssh_vm() {
  ssh \
    -i "$VM_KEY" \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o IdentitiesOnly=yes \
    -o BatchMode=yes \
    -o ConnectTimeout=4 \
    "$VM_USER@$VM_IP" \
    "$1"
}

print_step "create VM: $VM_ID"
run_cli create "$VM_ID"
ROOTFS_PATH="$(run_cli status "$VM_ID" | bun -e 'const fs = require("node:fs"); const j = JSON.parse(fs.readFileSync(0, "utf8")); process.stdout.write(j.vm.rootfsPath);')"
if [[ -f "$ROOTFS_PATH" ]]; then
  print_pass "VM created with rootfs: $ROOTFS_PATH"
else
  print_fail "rootfs file not found after create: $ROOTFS_PATH"
  exit 1
fi

print_step "start VM and verify SSH"
run_cli start "$VM_ID" --no-attach
assert_running "1"
if ssh_vm "echo ssh-ok" >/dev/null 2>&1; then
  print_pass "SSH reachable after start"
else
  print_fail "SSH not reachable after start"
  exit 1
fi

print_step "write persistent marker inside VM"
VM_HOME="$(ssh_vm "getent passwd '$VM_USER' | cut -d: -f6")"
if [[ -z "$VM_HOME" ]]; then
  print_fail "failed resolving home directory for user $VM_USER"
  exit 1
fi
PERSIST_PATH="$VM_HOME/.microvm-e2e-persist.txt"
if ssh_vm "printf '%s\n' '$PERSIST_MARKER' > '$PERSIST_PATH' && sync"; then
  print_pass "marker written to $PERSIST_PATH"
else
  print_fail "failed writing marker to VM"
  exit 1
fi

print_step "stop VM"
run_cli stop "$VM_ID"
assert_running "0"
print_pass "VM stopped"

print_step "start VM again and verify marker persistence"
run_cli start "$VM_ID" --no-attach
assert_running "1"
READ_MARKER="$(ssh_vm "cat '$PERSIST_PATH'")"
if [[ "$READ_MARKER" == "$PERSIST_MARKER" ]]; then
  print_pass "persistent filesystem preserved marker across stop/start"
else
  print_fail "marker mismatch after restart (expected=$PERSIST_MARKER got=$READ_MARKER)"
  exit 1
fi

print_step "verify internet from VM"
if ssh_vm "ping -c 1 -W 3 1.1.1.1 >/dev/null"; then
  print_pass "outbound IP connectivity works (1.1.1.1)"
else
  print_fail "outbound IP connectivity failed"
  exit 1
fi
if ssh_vm "getent hosts example.com >/dev/null"; then
  print_pass "DNS resolution works (example.com)"
else
  print_fail "DNS resolution failed"
  exit 1
fi

print_step "stop and start again (explicit lifecycle checks)"
run_cli stop "$VM_ID"
assert_running "0"
print_pass "stop command works"
run_cli start "$VM_ID" --no-attach
assert_running "1"
print_pass "start command works"

print_step "delete VM while running (must auto-stop + cleanup)"
run_cli delete "$VM_ID"
WAS_DELETED="1"
if run_cli status "$VM_ID" >/tmp/microvm-e2e-status.out 2>/tmp/microvm-e2e-status.err; then
  print_fail "status succeeded after delete; VM should not exist"
  exit 1
fi
if [[ -d "$PROJECT_ROOT/.microvm/vms/$VM_ID" ]]; then
  print_fail "VM directory still exists after delete: $PROJECT_ROOT/.microvm/vms/$VM_ID"
  exit 1
fi
print_pass "delete command removed VM state and files"

echo
echo "[e2e] all CLI tests passed for VM $VM_ID"
