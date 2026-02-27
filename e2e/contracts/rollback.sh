#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$PROJECT_ROOT/e2e/lib/steps.sh"
export MICROVM_HOME="${MICROVM_HOME:-${PROJECT_ROOT}/.microvm}"

VM_CREATE_FAIL_NAME="rbcreate$(date +%s | tail -c 7)"
VM_UP_FAIL_NAME="rbup$(date +%s | tail -c 7)"
VM_DOWN_FAIL_NAME="rbdown$(date +%s | tail -c 7)"
VM_DELETE_GUARD_NAME="rbdel$(date +%s | tail -c 7)"

LOW_MEMORY_START_CAP_BYTES="${TEST_LOW_MEMORY_START_CAP_BYTES:-700000000}"
KEEP_VM_ON_EXIT="${KEEP_VM_ON_EXIT:-0}"
DOCKERFILE_PATH="${DOCKERFILE_PATH:-scripts/Dockerfile.test-ubuntu}"

CREATED_UP_FAIL_VM="0"
CREATED_DOWN_FAIL_VM="0"
CREATED_DELETE_GUARD_VM="0"

require_no_positional_args "e2e/contracts/rollback.sh" "$@"

require_cmd() {
  if command -v "$1" >/dev/null 2>&1; then
    return
  fi
  echo "[rollback-e2e] missing dependency: $1" >&2
  exit 2
}

require_cmd bun
require_cmd sudo

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

status_field() {
  local vm_ref="$1"
  local key_path="$2"
  run_cli status "$vm_ref" --json | bun -e '
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

assert_status_field() {
  local vm_ref="$1"
  local key_path="$2"
  local expected="$3"
  local actual
  actual="$(status_field "$vm_ref" "$key_path")"
  if [[ "$actual" == "$expected" ]]; then
    print_pass "$vm_ref: $key_path=$actual"
    return
  fi
  print_fail "$vm_ref: expected $key_path=$expected got=$actual"
  exit 1
}

count_vm_dirs() {
  if [[ ! -d "$MICROVM_HOME/vms" ]]; then
    echo 0
    return
  fi
  find "$MICROVM_HOME/vms" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' '
}

cleanup() {
  if [[ "$KEEP_VM_ON_EXIT" == "1" ]]; then
    return
  fi

  if [[ "$CREATED_UP_FAIL_VM" == "1" ]]; then
    run_cli delete "$VM_UP_FAIL_NAME" >/dev/null 2>&1 || true
  fi
  if [[ "$CREATED_DOWN_FAIL_VM" == "1" ]]; then
    run_cli delete "$VM_DOWN_FAIL_NAME" >/dev/null 2>&1 || true
  fi
  if [[ "$CREATED_DELETE_GUARD_VM" == "1" ]]; then
    run_cli delete "$VM_DELETE_GUARD_NAME" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

bdd_feature "Rollback contracts"
bdd_scenario "Create, up, down, and delete failures preserve safe rollback invariants"

for vm_name in "$VM_CREATE_FAIL_NAME" "$VM_UP_FAIL_NAME" "$VM_DOWN_FAIL_NAME" "$VM_DELETE_GUARD_NAME"; do
  if run_cli status "$vm_name" >/dev/null 2>&1; then
    print_fail "VM $vm_name already exists. Use different names."
    exit 1
  fi
done

print_step "Given create receives an invalid dockerfile path"
VM_DIRS_BEFORE="$(count_vm_dirs)"
INVALID_DOCKERFILE="scripts/DOES_NOT_EXIST_DOCKERFILE.test"
if run_cli create --name "$VM_CREATE_FAIL_NAME" --dockerfile "$INVALID_DOCKERFILE" \
  >/tmp/microvm-rollback-create.out 2>/tmp/microvm-rollback-create.err; then
  print_fail "create unexpectedly succeeded with invalid dockerfile"
  exit 1
fi
if run_cli status "$VM_CREATE_FAIL_NAME" >/dev/null 2>&1; then
  print_fail "create failure still left a VM record for $VM_CREATE_FAIL_NAME"
  exit 1
fi
VM_DIRS_AFTER="$(count_vm_dirs)"
if [[ "$VM_DIRS_BEFORE" != "$VM_DIRS_AFTER" ]]; then
  print_fail "create failure changed vm directory count (before=$VM_DIRS_BEFORE after=$VM_DIRS_AFTER)"
  exit 1
fi
print_pass "create rollback left no persisted VM and no leaked vm directories"

print_step "When up fails under an intentionally low-memory profile"
run_cli create --name "$VM_UP_FAIL_NAME" --dockerfile "$DOCKERFILE_PATH"
CREATED_UP_FAIL_VM="1"
if (
  cd "$PROJECT_ROOT"
  MICROVM_CGROUP_MEMORY_MAX="$LOW_MEMORY_START_CAP_BYTES" bun src/index.ts up "$VM_UP_FAIL_NAME" --no-attach
) >/tmp/microvm-rollback-up.out 2>/tmp/microvm-rollback-up.err; then
  print_fail "up unexpectedly succeeded with low memory profile"
  exit 1
fi
assert_status_field "$VM_UP_FAIL_NAME" "running" "false"
assert_status_field "$VM_UP_FAIL_NAME" "vm.status" "failed"
print_pass "up rollback persisted failed state"

print_step "Then down failure from an invalid transition persists status=failed"
run_cli create --name "$VM_DOWN_FAIL_NAME" --dockerfile "$DOCKERFILE_PATH"
CREATED_DOWN_FAIL_VM="1"
if run_cli down "$VM_DOWN_FAIL_NAME" >/tmp/microvm-rollback-down.out 2>/tmp/microvm-rollback-down.err; then
  print_fail "down unexpectedly succeeded for non-running VM"
  exit 1
fi
assert_status_field "$VM_DOWN_FAIL_NAME" "running" "false"
assert_status_field "$VM_DOWN_FAIL_NAME" "vm.status" "failed"
print_pass "down rollback persisted failed state after invalid transition"

print_step "And delete refuses unsafe out-of-root filesystem targets"
run_cli create --name "$VM_DELETE_GUARD_NAME" --dockerfile "$DOCKERFILE_PATH"
CREATED_DELETE_GUARD_VM="1"
VM_DELETE_ID="$(status_field "$VM_DELETE_GUARD_NAME" "vm.vmId")"
VM_DELETE_ROOTFS_ORIG="$(status_field "$VM_DELETE_GUARD_NAME" "vm.rootfsPath")"
VM_DB_FILE="$MICROVM_HOME/runtime/vms.json"
UNSAFE_DIR="$MICROVM_HOME/unsafe-delete-target"
SENTINEL_FILE="$UNSAFE_DIR/sentinel.txt"
mkdir -p "$UNSAFE_DIR"
printf 'do-not-delete\n' > "$SENTINEL_FILE"

bun -e '
  const fs = require("node:fs");
  const dbPath = process.argv[1];
  const vmId = process.argv[2];
  const unsafeRootfs = process.argv[3];
  const raw = fs.readFileSync(dbPath, "utf8");
  const db = JSON.parse(raw);
  const vm = db?.vms?.[vmId];
  if (!vm) {
    process.exit(7);
  }
  vm.rootfsPath = unsafeRootfs;
  fs.writeFileSync(dbPath, `${JSON.stringify(db, null, 2)}\n`);
' "$VM_DB_FILE" "$VM_DELETE_ID" "$UNSAFE_DIR/rootfs.ext4"

if run_cli delete "$VM_DELETE_GUARD_NAME" >/tmp/microvm-rollback-delete.out 2>/tmp/microvm-rollback-delete.err; then
  print_fail "delete unexpectedly succeeded with unsafe rootfs path"
  exit 1
fi
if [[ ! -f "$SENTINEL_FILE" ]]; then
  print_fail "delete guard failed; sentinel was removed: $SENTINEL_FILE"
  exit 1
fi
assert_status_field "$VM_DELETE_GUARD_NAME" "vm.status" "failed"
print_pass "delete guard blocked unsafe recursive delete"

print_step "And rootfs metadata is restored so cleanup can complete"
bun -e '
  const fs = require("node:fs");
  const dbPath = process.argv[1];
  const vmId = process.argv[2];
  const rootfsPath = process.argv[3];
  const raw = fs.readFileSync(dbPath, "utf8");
  const db = JSON.parse(raw);
  const vm = db?.vms?.[vmId];
  if (!vm) {
    process.exit(7);
  }
  vm.rootfsPath = rootfsPath;
  fs.writeFileSync(dbPath, `${JSON.stringify(db, null, 2)}\n`);
' "$VM_DB_FILE" "$VM_DELETE_ID" "$VM_DELETE_ROOTFS_ORIG"

echo
echo "[rollback-e2e] rollback contract checks passed"
