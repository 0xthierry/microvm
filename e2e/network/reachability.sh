#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$PROJECT_ROOT/e2e/lib/steps.sh"
RAW_VM_A="vma_${RANDOM}_$(date +%s | tail -c 4)"
RAW_VM_B="vmb_${RANDOM}_$(date +%s | tail -c 4)"
KEEP_VM_ON_EXIT="${KEEP_VM_ON_EXIT:-0}"
CREATED_A="0"
CREATED_B="0"
DOCKERFILE_PATH="${DOCKERFILE_PATH:-scripts/Dockerfile.test-ubuntu}"

require_no_positional_args "e2e/network/reachability.sh" "$@"

normalize_vm_id() {
  local raw="$1"
  local normalized
  normalized="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9_' '_')"
  normalized="${normalized#_}"
  normalized="${normalized%_}"
  if [[ -z "$normalized" ]]; then
    normalized="vm"
  fi
  if [[ ! "$normalized" =~ ^[a-z0-9] ]]; then
    normalized="vm_${normalized}"
  fi
  if (( ${#normalized} > 15 )); then
    normalized="${normalized:0:15}"
  fi
  if [[ -z "$normalized" ]]; then
    print_fail "invalid vm id: $raw"
    exit 1
  fi
  printf '%s' "$normalized"
}

require_cmd() {
  if command -v "$1" >/dev/null 2>&1; then
    return
  fi
  echo "[check] missing dependency: $1" >&2
  exit 2
}

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
  if [[ "$KEEP_VM_ON_EXIT" == "1" ]]; then
    return
  fi
  if [[ "$CREATED_A" == "1" ]]; then
    run_cli delete "$VM_A" >/dev/null 2>&1 || true
  fi
  if [[ "$CREATED_B" == "1" ]]; then
    run_cli delete "$VM_B" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

bdd_feature "Network reachability isolation"
bdd_scenario "Host can reach each VM while VM-to-VM SSH is blocked"

read_vm_meta() {
  local vm_id="$1"
  local status
  status="$(run_cli status "$vm_id" --json)"
  printf '%s' "$status" | bun -e '
    const fs = require("node:fs");
    const state = JSON.parse(fs.readFileSync(0, "utf8"));
    if (!state.vm) {
      process.exit(3);
    }
    const vm = state.vm;
    const pid = vm.runtime?.firecrackerPid ?? "";
    const running = state.running ? "1" : "0";
    console.log([vm.vmId, vm.guestIp, vm.sshKeyPath, vm.sshUser, running, String(pid)].join("\t"));
  '
}

require_cmd bun
require_cmd ssh
require_cmd timeout

VM_A="$(normalize_vm_id "$RAW_VM_A")"
VM_B="$(normalize_vm_id "$RAW_VM_B")"

if [[ "$RAW_VM_A" != "$VM_A" ]]; then
  print_step "Given VM A id is normalized from $RAW_VM_A to $VM_A"
fi
if [[ "$RAW_VM_B" != "$VM_B" ]]; then
  print_step "And VM B id is normalized from $RAW_VM_B to $VM_B"
fi

if [[ "$VM_A" == "$VM_B" ]]; then
  print_fail "VM A and VM B must be different: $VM_A"
  exit 1
fi

if run_cli status "$VM_A" >/dev/null 2>&1; then
  print_fail "VM already exists: $VM_A. Use a different ID."
  exit 1
fi

if run_cli status "$VM_B" >/dev/null 2>&1; then
  print_fail "VM already exists: $VM_B. Use a different ID."
  exit 1
fi

print_step "Given VM A is created and booted: $VM_A"
run_cli create --name "$VM_A" --dockerfile "$DOCKERFILE_PATH"
CREATED_A="1"
run_cli up "$VM_A" --no-attach
A_META="$(read_vm_meta "$VM_A")"

print_step "And VM B is created and booted: $VM_B"
run_cli create --name "$VM_B" --dockerfile "$DOCKERFILE_PATH"
CREATED_B="1"
run_cli up "$VM_B" --no-attach
B_META="$(read_vm_meta "$VM_B")"

if [[ -z "$A_META" ]]; then
  print_fail "could not read status for $VM_A"
  exit 1
fi

if [[ -z "$B_META" ]]; then
  print_fail "could not read status for $VM_B"
  exit 1
fi

IFS=$'\t' read -r A_ID A_IP A_KEY A_USER A_RUNNING A_PID <<<"$A_META"
IFS=$'\t' read -r B_ID B_IP B_KEY B_USER B_RUNNING B_PID <<<"$B_META"

echo "[check] VM A: id=$A_ID ip=$A_IP user=$A_USER running=$A_RUNNING pid=${A_PID:-none}"
echo "[check] VM B: id=$B_ID ip=$B_IP user=$B_USER running=$B_RUNNING pid=${B_PID:-none}"

if [[ "$A_RUNNING" != "1" ]]; then
  print_fail "$A_ID is not running"
  exit 1
fi
if [[ "$B_RUNNING" != "1" ]]; then
  print_fail "$B_ID is not running"
  exit 1
fi

SSH_BASE_A=(-i "$A_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=4)
SSH_BASE_B=(-i "$B_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=4)

if ssh "${SSH_BASE_A[@]}" "$A_USER@$A_IP" "echo ok" >/dev/null 2>&1; then
  print_pass "host -> $A_ID SSH reachable"
else
  print_fail "host -> $A_ID SSH not reachable"
  exit 1
fi

if ssh "${SSH_BASE_B[@]}" "$B_USER@$B_IP" "echo ok" >/dev/null 2>&1; then
  print_pass "host -> $B_ID SSH reachable"
else
  print_fail "host -> $B_ID SSH not reachable"
  exit 1
fi

if timeout 7 ssh "${SSH_BASE_A[@]}" "$A_USER@$A_IP" "bash -lc 'echo > /dev/tcp/$B_IP/22'" >/dev/null 2>&1; then
  print_fail "$A_ID -> $B_ID:22 is reachable (expected blocked)"
  exit 1
else
  print_pass "$A_ID -> $B_ID:22 blocked"
fi

if timeout 7 ssh "${SSH_BASE_B[@]}" "$B_USER@$B_IP" "bash -lc 'echo > /dev/tcp/$A_IP/22'" >/dev/null 2>&1; then
  print_fail "$B_ID -> $A_ID:22 is reachable (expected blocked)"
  exit 1
else
  print_pass "$B_ID -> $A_ID:22 blocked"
fi

print_pass "isolation test passed for $A_ID and $B_ID"
