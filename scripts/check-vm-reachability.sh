#!/usr/bin/env bash

set -euo pipefail

VM_A="${1:-vm1}"
VM_B="${2:-vm2}"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

require_cmd() {
  if command -v "$1" >/dev/null 2>&1; then
    return
  fi
  echo "[check] missing dependency: $1" >&2
  exit 2
}

require_cmd bun
require_cmd ssh
require_cmd timeout

read_vm_meta() {
  local vm_id="$1"
  (
    cd "$PROJECT_ROOT"
    bun src/index.ts status "$vm_id" \
      | bun -e '
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
  )
}

print_pass() {
  echo "[PASS] $1"
}

print_fail() {
  echo "[FAIL] $1" >&2
}

if ! A_META="$(read_vm_meta "$VM_A")"; then
  print_fail "could not read status for $VM_A"
  exit 1
fi

if ! B_META="$(read_vm_meta "$VM_B")"; then
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

echo "[check] isolation test passed for $A_ID and $B_ID"
