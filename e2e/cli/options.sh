#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$PROJECT_ROOT/e2e/lib/steps.sh"
export MICROVM_HOME="${MICROVM_HOME:-${PROJECT_ROOT}/.microvm}"
VM_ID="e2eopt$(date +%s | tail -c 7)"
VM_UP_ID="upopt$(date +%s | tail -c 7)"
PERSIST_MARKER="persist-opt-$RANDOM-$(date +%s)"
KEEP_VM_ON_EXIT="${KEEP_VM_ON_EXIT:-0}"

require_no_positional_args "e2e/cli/options.sh" "$@"

CREATE_CPUS="${CREATE_CPUS:-3}"
CREATE_MEMORY_MIB="${CREATE_MEMORY_MIB:-1536}"
CREATE_DISK_GIB="${CREATE_DISK_GIB:-12}"
CREATE_SSH_USER="${CREATE_SSH_USER:-thierry}"
DOCKERFILE_PATH="${DOCKERFILE_PATH:-scripts/Dockerfile.test-ubuntu}"

SET_CPUS="${SET_CPUS:-4}"
SET_MEMORY_MIB="${SET_MEMORY_MIB:-2048}"
SET_DISK_GIB="${SET_DISK_GIB:-13}"
SET_SSH_USER="${SET_SSH_USER:-root}"

UP_CPUS="${UP_CPUS:-1}"
UP_MEMORY_MIB="${UP_MEMORY_MIB:-768}"
UP_DISK_MIB="${UP_DISK_MIB:-6144}"
UP_SSH_USER="${UP_SSH_USER:-root}"

CREATED_VM="0"
CREATED_UP_VM="0"
WAS_DELETED="0"

STATUS_JSON=""
VM_RUNNING=""
VM_IP=""
VM_USER=""
VM_KEY=""
VM_PID=""
VM_CPUS=""
VM_MEMORY_MIB=""
VM_DISK_MIB=""
VM_DOCKERFILE=""
VM_ROOTFS=""

require_cmd() {
  if command -v "$1" >/dev/null 2>&1; then
    return
  fi
  echo "[e2e-options] missing dependency: $1" >&2
  exit 2
}

require_cmd bun
require_cmd ssh
require_cmd timeout
require_cmd stat

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

assert_eq() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    print_pass "$label = $actual"
    return
  fi
  print_fail "$label mismatch (expected=$expected got=$actual)"
  exit 1
}

assert_int_ge() {
  local label="$1"
  local actual="$2"
  local minimum="$3"
  if [[ "$actual" =~ ^[0-9]+$ ]] && [[ "$minimum" =~ ^[0-9]+$ ]] && (( actual >= minimum )); then
    print_pass "$label >= $minimum ($actual)"
    return
  fi
  print_fail "$label expected >= $minimum, got $actual"
  exit 1
}

cleanup() {
  if [[ "$KEEP_VM_ON_EXIT" == "1" || "$WAS_DELETED" == "1" ]]; then
    return
  fi
  (
    cd "$PROJECT_ROOT"
    if [[ "$CREATED_VM" == "1" ]]; then
      bun src/index.ts delete "$VM_ID" >/dev/null 2>&1 || true
    fi
    if [[ "$CREATED_UP_VM" == "1" ]]; then
      bun src/index.ts delete "$VM_UP_ID" >/dev/null 2>&1 || true
    fi
  )
}

trap cleanup EXIT

bdd_feature "CLI options contracts"
bdd_scenario "Create, set, and up preserve option boundaries and runtime behavior"

json_field() {
  local key_path="$1"
  printf '%s' "$STATUS_JSON" | bun -e '
    const fs = require("node:fs");
    const obj = JSON.parse(fs.readFileSync(0, "utf8"));
    const path = (process.argv[1] || "").split(".").filter(Boolean);
    let cur = obj;
    for (const key of path) {
      cur = cur?.[key];
    }
    process.stdout.write(cur === undefined || cur === null ? "" : String(cur));
  ' "$key_path"
}

load_status() {
  local vm_id="$1"
  STATUS_JSON="$(run_cli status "$vm_id" --json)"
  VM_RUNNING="$(json_field running)"
  VM_IP="$(json_field vm.guestIp)"
  VM_USER="$(json_field vm.sshUser)"
  VM_KEY="$(json_field vm.sshKeyPath)"
  VM_PID="$(json_field vm.runtime.firecrackerPid)"
  VM_CPUS="$(json_field vm.vcpuCount)"
  VM_MEMORY_MIB="$(json_field vm.memSizeMib)"
  VM_DISK_MIB="$(json_field vm.diskSizeMib)"
  VM_DOCKERFILE="$(json_field vm.dockerfilePath)"
  VM_ROOTFS="$(json_field vm.rootfsPath)"
}

ssh_vm() {
  ssh \
    -i "$VM_KEY" \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o IdentitiesOnly=yes \
    -o BatchMode=yes \
    -o ConnectTimeout=5 \
    "$VM_USER@$VM_IP" \
    "$1"
}

EXPECTED_DOCKERFILE_PATH="$(cd "$PROJECT_ROOT" && bun -e 'const path = require("node:path"); process.stdout.write(path.resolve(process.argv[1]));' "$DOCKERFILE_PATH")"
CREATE_DISK_MIB="$((CREATE_DISK_GIB * 1024))"
SET_DISK_MIB="$((SET_DISK_GIB * 1024))"

if run_cli status "$VM_ID" >/dev/null 2>&1; then
  print_fail "VM $VM_ID already exists. Pass a different id."
  exit 1
fi
if run_cli status "$VM_UP_ID" >/dev/null 2>&1; then
  print_fail "VM $VM_UP_ID already exists. Pass a different id."
  exit 1
fi

print_step "Given create receives conflicting disk flags"
CONFLICT_ID="${VM_ID}x"
if run_cli create --name "$CONFLICT_ID" --dockerfile "$DOCKERFILE_PATH" --disk-gib 8 --disk-mib 8192 >/tmp/microvm-opt-conflict.out 2>/tmp/microvm-opt-conflict.err; then
  run_cli delete "$CONFLICT_ID" >/dev/null 2>&1 || true
  print_fail "create succeeded with conflicting disk flags"
  exit 1
fi
print_pass "create rejects --disk-gib with --disk-mib"

print_step "When I create a VM with explicit create options"
run_cli create --name "$VM_ID" \
  --cpus "$CREATE_CPUS" \
  --memory-mib "$CREATE_MEMORY_MIB" \
  --disk-gib "$CREATE_DISK_GIB" \
  --dockerfile "$DOCKERFILE_PATH" \
  --ssh-user "$CREATE_SSH_USER"
CREATED_VM="1"

load_status "$VM_ID"
assert_eq "running after create" "false" "$VM_RUNNING"
assert_eq "vcpu_count" "$CREATE_CPUS" "$VM_CPUS"
assert_eq "mem_size_mib" "$CREATE_MEMORY_MIB" "$VM_MEMORY_MIB"
assert_eq "disk_size_mib" "$CREATE_DISK_MIB" "$VM_DISK_MIB"
assert_eq "ssh_user" "$CREATE_SSH_USER" "$VM_USER"
assert_eq "dockerfile_path" "$EXPECTED_DOCKERFILE_PATH" "$VM_DOCKERFILE"

if [[ ! -f "$VM_ROOTFS" ]]; then
  print_fail "rootfs file not found after create: $VM_ROOTFS"
  exit 1
fi
ROOTFS_BYTES="$(stat -c %s "$VM_ROOTFS")"
EXPECTED_CREATE_ROOTFS_BYTES="$((CREATE_DISK_MIB * 1024 * 1024))"
assert_eq "rootfs_size_bytes_after_create" "$EXPECTED_CREATE_ROOTFS_BYTES" "$ROOTFS_BYTES"

print_step "Then the VM starts and SSH works with the configured user"
run_cli up "$VM_ID" --no-attach
load_status "$VM_ID"
assert_eq "running after start" "true" "$VM_RUNNING"
if ssh_vm "echo ssh-ok" >/dev/null 2>&1; then
  print_pass "SSH reachable as $VM_USER"
else
  print_fail "SSH not reachable as $VM_USER"
  exit 1
fi

print_step "And I persist a marker inside the guest"
VM_HOME="$(ssh_vm "getent passwd '$VM_USER' | cut -d: -f6")"
if [[ -z "$VM_HOME" ]]; then
  print_fail "failed resolving home directory for user $VM_USER"
  exit 1
fi
PERSIST_PATH="$VM_HOME/.microvm-e2e-options-persist.txt"
if ssh_vm "printf '%s\n' '$PERSIST_MARKER' > '$PERSIST_PATH' && sync"; then
  print_pass "marker written to $PERSIST_PATH"
else
  print_fail "failed writing marker"
  exit 1
fi

print_step "When I update mutable runtime settings while running"
run_cli set "$VM_ID" --cpus "$SET_CPUS" --memory-mib "$SET_MEMORY_MIB" --ssh-user "$SET_SSH_USER"
load_status "$VM_ID"
assert_eq "updated_vcpu_count" "$SET_CPUS" "$VM_CPUS"
assert_eq "updated_mem_size_mib" "$SET_MEMORY_MIB" "$VM_MEMORY_MIB"
assert_eq "updated_ssh_user" "$SET_SSH_USER" "$VM_USER"
if ssh_vm "echo set-running-ok" >/dev/null 2>&1; then
  print_pass "SSH reachable after set (running VM)"
else
  print_fail "SSH not reachable after set"
  exit 1
fi

print_step "Then disk resize is rejected while the VM is running"
if run_cli set "$VM_ID" --disk-gib "$SET_DISK_GIB" >/tmp/microvm-opt-grow-running.out 2>/tmp/microvm-opt-grow-running.err; then
  print_fail "disk grow unexpectedly succeeded while VM running"
  exit 1
fi
print_pass "disk grow correctly rejected while running"

print_step "When I stop the VM and grow the disk"
run_cli down "$VM_ID"
load_status "$VM_ID"
assert_eq "running after stop" "false" "$VM_RUNNING"
run_cli set "$VM_ID" --disk-gib "$SET_DISK_GIB"
load_status "$VM_ID"
assert_eq "disk_size_mib_after_grow" "$SET_DISK_MIB" "$VM_DISK_MIB"
ROOTFS_BYTES_AFTER_GROW="$(stat -c %s "$VM_ROOTFS")"
EXPECTED_GROWN_ROOTFS_BYTES="$((SET_DISK_MIB * 1024 * 1024))"
assert_eq "rootfs_size_bytes_after_grow" "$EXPECTED_GROWN_ROOTFS_BYTES" "$ROOTFS_BYTES_AFTER_GROW"

print_step "Then shrinking the disk is rejected"
if run_cli set "$VM_ID" --disk-gib "$CREATE_DISK_GIB" >/tmp/microvm-opt-shrink.out 2>/tmp/microvm-opt-shrink.err; then
  print_fail "disk shrink unexpectedly succeeded"
  exit 1
fi
print_pass "disk shrink correctly rejected"

print_step "When I restart and validate persisted settings and data"
run_cli up "$VM_ID" --no-attach
load_status "$VM_ID"
assert_eq "running after restart" "true" "$VM_RUNNING"
assert_eq "ssh_user_after_restart" "$SET_SSH_USER" "$VM_USER"
assert_eq "vcpu_count_after_restart" "$SET_CPUS" "$VM_CPUS"
assert_eq "mem_size_mib_after_restart" "$SET_MEMORY_MIB" "$VM_MEMORY_MIB"
assert_eq "disk_size_mib_after_restart" "$SET_DISK_MIB" "$VM_DISK_MIB"
READ_MARKER="$(ssh_vm "cat '$PERSIST_PATH'")"
assert_eq "persisted_marker" "$PERSIST_MARKER" "$READ_MARKER"

print_step "Then set without options is rejected"
if run_cli set "$VM_ID" >/tmp/microvm-opt-set-empty.out 2>/tmp/microvm-opt-set-empty.err; then
  print_fail "set unexpectedly succeeded without options"
  exit 1
fi
print_pass "set correctly rejects empty option set"

print_step "And up rejects create-only flags"
run_cli down "$VM_ID"
if run_cli up "$VM_ID" --no-attach --cpus 7 --memory-mib 4096 --disk-gib 20 --ssh-user thierry --dockerfile "$DOCKERFILE_PATH" \
  >/tmp/microvm-opt-up-create-flags.out 2>/tmp/microvm-opt-up-create-flags.err; then
  print_fail "up unexpectedly accepted create-only flags"
  exit 1
fi
print_pass "up correctly rejects create-only flags"

print_step "When I run up without create-only flags"
run_cli up "$VM_ID" --no-attach
load_status "$VM_ID"
assert_eq "vcpu_count_unchanged_on_up" "$SET_CPUS" "$VM_CPUS"
assert_eq "mem_size_mib_unchanged_on_up" "$SET_MEMORY_MIB" "$VM_MEMORY_MIB"
assert_eq "disk_size_mib_unchanged_on_up" "$SET_DISK_MIB" "$VM_DISK_MIB"
assert_eq "ssh_user_unchanged_on_up" "$SET_SSH_USER" "$VM_USER"

print_step "Then a second VM created with disk-mib boots with expected settings"
run_cli create --name "$VM_UP_ID" \
  --cpus "$UP_CPUS" \
  --memory-mib "$UP_MEMORY_MIB" \
  --disk-mib "$UP_DISK_MIB" \
  --dockerfile "$DOCKERFILE_PATH" \
  --ssh-user "$UP_SSH_USER"
CREATED_UP_VM="1"
run_cli up "$VM_UP_ID" --no-attach

load_status "$VM_UP_ID"
assert_eq "up_running" "true" "$VM_RUNNING"
assert_eq "up_vcpu_count" "$UP_CPUS" "$VM_CPUS"
assert_eq "up_mem_size_mib" "$UP_MEMORY_MIB" "$VM_MEMORY_MIB"
assert_eq "up_disk_size_mib" "$UP_DISK_MIB" "$VM_DISK_MIB"
assert_eq "up_ssh_user" "$UP_SSH_USER" "$VM_USER"
if ssh_vm "echo up-ok" >/dev/null 2>&1; then
  print_pass "SSH reachable for second VM"
else
  print_fail "SSH not reachable for second VM"
  exit 1
fi

print_step "And deleting both VMs removes their records and files"
load_status "$VM_ID"
VM_DIR="$(dirname "$VM_ROOTFS")"
load_status "$VM_UP_ID"
VM_UP_DIR="$(dirname "$VM_ROOTFS")"
run_cli delete "$VM_ID"
CREATED_VM="0"
run_cli delete "$VM_UP_ID"
CREATED_UP_VM="0"
WAS_DELETED="1"

if run_cli status "$VM_ID" >/dev/null 2>&1; then
  print_fail "status unexpectedly succeeded after delete for $VM_ID"
  exit 1
fi
if run_cli status "$VM_UP_ID" >/dev/null 2>&1; then
  print_fail "status unexpectedly succeeded after delete for $VM_UP_ID"
  exit 1
fi
if [[ -d "$VM_DIR" ]]; then
  print_fail "VM directory still exists: $VM_DIR"
  exit 1
fi
if [[ -d "$VM_UP_DIR" ]]; then
  print_fail "VM directory still exists: $VM_UP_DIR"
  exit 1
fi
print_pass "delete cleaned up both VMs"

echo
echo "[e2e-options] all CLI option-focused tests passed ($VM_ID, $VM_UP_ID)"
