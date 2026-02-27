#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$PROJECT_ROOT/e2e/lib/steps.sh"
export MICROVM_HOME="${MICROVM_HOME:-${PROJECT_ROOT}/.microvm}"
VM_ID="e2e$(date +%s | tail -c 7)"
PERSIST_MARKER="persist-$RANDOM-$(date +%s)"
KEEP_VM_ON_EXIT="${KEEP_VM_ON_EXIT:-0}"
WAS_DELETED="0"
DOCKERFILE_PATH="${DOCKERFILE_PATH:-scripts/Dockerfile.test-ubuntu}"

require_no_positional_args "e2e/cli/lifecycle.sh" "$@"

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
  local step="$1"
  case "$step" in
    Given\ *)
      bdd_given "${step#Given }"
      ;;
    When\ *)
      bdd_when "${step#When }"
      ;;
    Then\ *)
      bdd_then "${step#Then }"
      ;;
    And\ *)
      bdd_and "${step#And }"
      ;;
    *)
      bdd_when "$step"
      ;;
  esac
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

bdd_feature "CLI VM lifecycle"
bdd_scenario "Create, boot, stop, restart, and delete a VM"

STATUS_JSON=""
VM_RUNNING=""
VM_IP=""
VM_USER=""
VM_KEY=""
VM_HOME=""

load_status() {
  STATUS_JSON="$(run_cli status "$VM_ID" --json)"
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

print_step "Given a unique VM id $VM_ID"
run_cli create --name "$VM_ID" --dockerfile "$DOCKERFILE_PATH"
ROOTFS_PATH="$(run_cli status "$VM_ID" --json | bun -e 'const fs = require("node:fs"); const j = JSON.parse(fs.readFileSync(0, "utf8")); process.stdout.write(j.vm.rootfsPath);')"
VM_DIR="$(dirname "$ROOTFS_PATH")"
if [[ -f "$ROOTFS_PATH" ]]; then
  print_pass "VM created with rootfs: $ROOTFS_PATH"
else
  print_fail "rootfs file not found after create: $ROOTFS_PATH"
  exit 1
fi

print_step "When I start the VM without attaching"
run_cli up "$VM_ID" --no-attach
assert_running "1"
if ssh_vm "echo ssh-ok" >/dev/null 2>&1; then
  print_pass "SSH reachable after start"
else
  print_fail "SSH not reachable after start"
  exit 1
fi

print_step "And I write a persistence marker inside the guest"
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

print_step "When I stop the VM"
run_cli down "$VM_ID"
assert_running "0"
print_pass "VM stopped"

print_step "Then restarting the VM preserves the marker"
run_cli up "$VM_ID" --no-attach
assert_running "1"
READ_MARKER="$(ssh_vm "cat '$PERSIST_PATH'")"
if [[ "$READ_MARKER" == "$PERSIST_MARKER" ]]; then
  print_pass "persistent filesystem preserved marker across stop/start"
else
  print_fail "marker mismatch after restart (expected=$PERSIST_MARKER got=$READ_MARKER)"
  exit 1
fi

print_step "And the VM has outbound network and DNS connectivity"
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

print_step "When I execute an additional stop/start lifecycle cycle"
run_cli down "$VM_ID"
assert_running "0"
print_pass "stop command works"
run_cli up "$VM_ID" --no-attach
assert_running "1"
print_pass "start command works"

print_step "Then deleting a running VM auto-stops it and removes artifacts"
run_cli delete "$VM_ID"
WAS_DELETED="1"
if run_cli status "$VM_ID" >/tmp/microvm-e2e-status.out 2>/tmp/microvm-e2e-status.err; then
  print_fail "status succeeded after delete; VM should not exist"
  exit 1
fi
if [[ -d "$VM_DIR" ]]; then
  print_fail "VM directory still exists after delete: $VM_DIR"
  exit 1
fi
print_pass "delete command removed VM state and files"

echo
echo "[e2e] all CLI tests passed for VM $VM_ID"
