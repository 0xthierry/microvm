#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$PROJECT_ROOT/e2e/lib/steps.sh"
export MICROVM_HOME="${MICROVM_HOME:-${PROJECT_ROOT}/.microvm}"

VM_A_NAME="ssafea$(date +%s | tail -c 7)"
VM_B_NAME="ssafeb$(date +%s | tail -c 7)"
KEEP_VM_ON_EXIT="${KEEP_VM_ON_EXIT:-0}"
DOCKERFILE_PATH="${DOCKERFILE_PATH:-scripts/Dockerfile.test-ubuntu}"

CREATED_VM_A="0"
CREATED_VM_B="0"
UNRELATED_PIDS=()

require_no_positional_args "e2e/security/safe-stop.sh" "$@"

require_cmd() {
  if command -v "$1" >/dev/null 2>&1; then
    return
  fi
  echo "[safe-stop-e2e] missing dependency: $1" >&2
  exit 2
}

require_cmd bun
require_cmd ssh
require_cmd sudo
require_cmd ps

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

is_pid_active() {
  local pid="$1"
  if [[ -z "$pid" || ! "$pid" =~ ^[0-9]+$ ]]; then
    return 1
  fi
  local stat
  stat="$(ps -o stat= -p "$pid" 2>/dev/null | tr -d '[:space:]' || true)"
  if [[ -z "$stat" ]]; then
    return 1
  fi
  if [[ "${stat:0:1}" == "Z" ]]; then
    return 1
  fi
  return 0
}

assert_pid_active() {
  local pid="$1"
  local label="$2"
  if is_pid_active "$pid"; then
    print_pass "$label: pid $pid is active"
    return
  fi
  print_fail "$label: pid $pid is not active"
  exit 1
}

wait_for_pid_inactive() {
  local pid="$1"
  local attempts="${2:-80}"
  for _ in $(seq 1 "$attempts"); do
    if ! is_pid_active "$pid"; then
      return 0
    fi
    sleep 0.1
  done
  return 1
}

assert_pid_inactive() {
  local pid="$1"
  local label="$2"
  if wait_for_pid_inactive "$pid"; then
    print_pass "$label: pid $pid is inactive"
    return
  fi
  print_fail "$label: pid $pid remained active"
  exit 1
}

spawn_unrelated_process() {
  sleep 900 >/dev/null 2>&1 &
  local pid="$!"
  UNRELATED_PIDS+=("$pid")
  printf '%s' "$pid"
}

cleanup() {
  for pid in "${UNRELATED_PIDS[@]}"; do
    kill "$pid" >/dev/null 2>&1 || true
  done

  if [[ "$KEEP_VM_ON_EXIT" == "1" ]]; then
    return
  fi

  if [[ "$CREATED_VM_A" == "1" ]]; then
    run_cli delete "$VM_A_NAME" >/dev/null 2>&1 || true
  fi
  if [[ "$CREATED_VM_B" == "1" ]]; then
    run_cli delete "$VM_B_NAME" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

bdd_feature "Security safe stop contract"
bdd_scenario "Stopping or deleting one VM never kills unrelated host workloads"

if [[ "$VM_A_NAME" == "$VM_B_NAME" ]]; then
  print_fail "VM names must be different: $VM_A_NAME"
  exit 1
fi

for vm_name in "$VM_A_NAME" "$VM_B_NAME"; do
  if run_cli status "$vm_name" >/dev/null 2>&1; then
    print_fail "VM $vm_name already exists. Use different names."
    exit 1
  fi
done

print_step "Given two VMs are created and booted"
run_cli create --name "$VM_A_NAME" --dockerfile "$DOCKERFILE_PATH"
CREATED_VM_A="1"
run_cli up "$VM_A_NAME" --no-attach
assert_status_field "$VM_A_NAME" "running" "true"

run_cli create --name "$VM_B_NAME" --dockerfile "$DOCKERFILE_PATH"
CREATED_VM_B="1"
run_cli up "$VM_B_NAME" --no-attach
assert_status_field "$VM_B_NAME" "running" "true"

VM_A_PID="$(status_field "$VM_A_NAME" "vm.runtime.firecrackerPid")"
VM_B_PID="$(status_field "$VM_B_NAME" "vm.runtime.firecrackerPid")"
assert_pid_active "$VM_A_PID" "$VM_A_NAME firecracker"
assert_pid_active "$VM_B_PID" "$VM_B_NAME firecracker"

print_step "When an unrelated host process runs and I stop VM A"
UNRELATED_PID_1="$(spawn_unrelated_process)"
assert_pid_active "$UNRELATED_PID_1" "unrelated workload #1"

run_cli down "$VM_A_NAME"
assert_status_field "$VM_A_NAME" "running" "false"
assert_status_field "$VM_A_NAME" "vm.status" "stopped"
assert_pid_inactive "$VM_A_PID" "$VM_A_NAME firecracker"
assert_status_field "$VM_B_NAME" "running" "true"
assert_pid_active "$VM_B_PID" "$VM_B_NAME firecracker"
assert_pid_active "$UNRELATED_PID_1" "unrelated workload #1 after down"

print_step "Then deleting VM B stops only VM B workloads"
UNRELATED_PID_2="$(spawn_unrelated_process)"
assert_pid_active "$UNRELATED_PID_2" "unrelated workload #2"

run_cli delete "$VM_B_NAME"
CREATED_VM_B="0"
if run_cli status "$VM_B_NAME" >/tmp/microvm-safe-stop-status-b.out 2>/tmp/microvm-safe-stop-status-b.err; then
  print_fail "status unexpectedly succeeded for deleted VM $VM_B_NAME"
  exit 1
fi
assert_pid_inactive "$VM_B_PID" "$VM_B_NAME firecracker after delete"
assert_pid_active "$UNRELATED_PID_1" "unrelated workload #1 after delete"
assert_pid_active "$UNRELATED_PID_2" "unrelated workload #2 after delete"

print_step "And deleting remaining VM A leaves unrelated host workloads alive"
run_cli delete "$VM_A_NAME"
CREATED_VM_A="0"
if run_cli status "$VM_A_NAME" >/tmp/microvm-safe-stop-status-a.out 2>/tmp/microvm-safe-stop-status-a.err; then
  print_fail "status unexpectedly succeeded for deleted VM $VM_A_NAME"
  exit 1
fi
print_pass "safe-stop contract preserved unrelated host processes"

echo
echo "[safe-stop-e2e] safe-stop contract checks passed"
