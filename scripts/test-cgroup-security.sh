#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VM_ID="${1:-cgt$(date +%s)}"
KEEP_VM_ON_EXIT="${KEEP_VM_ON_EXIT:-0}"
CREATED_VM="0"
WAS_DELETED="0"

EXPECT_MEMORY_MAX="${MICROVM_CGROUP_MEMORY_MAX:-1610612736}"
EXPECT_MEMORY_SWAP_MAX="${MICROVM_CGROUP_MEMORY_SWAP_MAX:-0}"
EXPECT_CPU_MAX="${MICROVM_CGROUP_CPU_MAX:-200000 100000}"
EXPECT_PIDS_MAX="${MICROVM_CGROUP_PIDS_MAX:-512}"

require_cmd() {
  if command -v "$1" >/dev/null 2>&1; then
    return
  fi
  echo "[cgroup] missing dependency: $1" >&2
  exit 2
}

require_cmd bun
require_cmd ssh
require_cmd timeout
require_cmd sudo

run_cli() {
  (
    cd "$PROJECT_ROOT"
    bun src/index.ts "$@"
  )
}

print_step() {
  echo
  echo "[cgroup] $1"
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
    if [[ "$CREATED_VM" == "1" ]]; then
      bun src/index.ts delete "$VM_ID" >/dev/null 2>&1 || true
    else
      bun src/index.ts stop "$VM_ID" >/dev/null 2>&1 || true
    fi
  )
}

trap cleanup EXIT

if run_cli status "$VM_ID" >/dev/null 2>&1; then
  print_fail "VM $VM_ID already exists. Use a different id to avoid side effects."
  exit 1
fi

print_step "create and start VM: $VM_ID"
run_cli create "$VM_ID"
CREATED_VM="1"
run_cli start "$VM_ID" --no-attach

STATUS_JSON="$(run_cli status "$VM_ID")"
VM_RUNNING="$(printf '%s' "$STATUS_JSON" | bun -e 'const fs=require("node:fs"); const j=JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(j.running ? "1" : "0");')"
VM_IP="$(printf '%s' "$STATUS_JSON" | bun -e 'const fs=require("node:fs"); const j=JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(j.vm.guestIp);')"
VM_USER="$(printf '%s' "$STATUS_JSON" | bun -e 'const fs=require("node:fs"); const j=JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(j.vm.sshUser);')"
VM_KEY="$(printf '%s' "$STATUS_JSON" | bun -e 'const fs=require("node:fs"); const j=JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(j.vm.sshKeyPath);')"
VM_PID="$(printf '%s' "$STATUS_JSON" | bun -e 'const fs=require("node:fs"); const j=JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(String(j.vm.runtime?.firecrackerPid ?? ""));')"

if [[ "$VM_RUNNING" != "1" || -z "$VM_PID" ]]; then
  print_fail "VM did not start correctly (running=$VM_RUNNING pid=${VM_PID:-none})"
  exit 1
fi
print_pass "VM is running (pid=$VM_PID ip=$VM_IP)"

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

if ssh_vm "echo ready" >/dev/null 2>&1; then
  print_pass "SSH reachable"
else
  print_fail "SSH not reachable"
  exit 1
fi

print_step "find firecracker cgroup path"
CGROUP_REL="$(awk -F: '/0::/ {print $3}' "/proc/$VM_PID/cgroup")"
if [[ -z "$CGROUP_REL" ]]; then
  print_fail "could not parse cgroup path from /proc/$VM_PID/cgroup"
  exit 1
fi
CGROUP_DIR="/sys/fs/cgroup$CGROUP_REL"
if [[ ! -d "$CGROUP_DIR" ]]; then
  print_fail "cgroup directory does not exist: $CGROUP_DIR"
  exit 1
fi
print_pass "cgroup path: $CGROUP_REL"

print_step "validate configured cgroup limits"
MEMORY_MAX="$(sudo cat "$CGROUP_DIR/memory.max")"
MEMORY_SWAP_MAX="$(sudo cat "$CGROUP_DIR/memory.swap.max")"
CPU_MAX="$(sudo cat "$CGROUP_DIR/cpu.max")"
PIDS_MAX="$(sudo cat "$CGROUP_DIR/pids.max")"

if [[ "$MEMORY_MAX" == "$EXPECT_MEMORY_MAX" ]]; then
  print_pass "memory.max = $MEMORY_MAX"
else
  print_fail "memory.max mismatch (expected=$EXPECT_MEMORY_MAX got=$MEMORY_MAX)"
  exit 1
fi
if [[ "$MEMORY_SWAP_MAX" == "$EXPECT_MEMORY_SWAP_MAX" ]]; then
  print_pass "memory.swap.max = $MEMORY_SWAP_MAX"
else
  print_fail "memory.swap.max mismatch (expected=$EXPECT_MEMORY_SWAP_MAX got=$MEMORY_SWAP_MAX)"
  exit 1
fi
if [[ "$CPU_MAX" == "$EXPECT_CPU_MAX" ]]; then
  print_pass "cpu.max = $CPU_MAX"
else
  print_fail "cpu.max mismatch (expected=$EXPECT_CPU_MAX got=$CPU_MAX)"
  exit 1
fi
if [[ "$PIDS_MAX" == "$EXPECT_PIDS_MAX" ]]; then
  print_pass "pids.max = $PIDS_MAX"
else
  print_fail "pids.max mismatch (expected=$EXPECT_PIDS_MAX got=$PIDS_MAX)"
  exit 1
fi

print_step "verify CPU throttling enforcement"
NR_THROTTLED_BEFORE="$(sudo awk '/nr_throttled/ {print $2}' "$CGROUP_DIR/cpu.stat")"
timeout 25 ssh_vm "bash -lc 'set +e; p=\"\"; for i in \$(seq 1 8); do yes >/dev/null & p=\"\$p \$!\"; done; sleep 8; kill \$p >/dev/null 2>&1 || true; wait >/dev/null 2>&1 || true'" >/dev/null 2>&1 || true
NR_THROTTLED_AFTER="$(sudo awk '/nr_throttled/ {print $2}' "$CGROUP_DIR/cpu.stat")"
if [[ "$NR_THROTTLED_AFTER" =~ ^[0-9]+$ ]] && [[ "$NR_THROTTLED_BEFORE" =~ ^[0-9]+$ ]] && (( NR_THROTTLED_AFTER > NR_THROTTLED_BEFORE )); then
  print_pass "cpu throttling observed (nr_throttled $NR_THROTTLED_BEFORE -> $NR_THROTTLED_AFTER)"
else
  print_fail "cpu throttling was not observed (nr_throttled $NR_THROTTLED_BEFORE -> $NR_THROTTLED_AFTER)"
  exit 1
fi

print_step "verify pids.max enforcement"
PIDS_MAX_EVENTS_BEFORE="$(sudo awk '/max/ {print $2}' "$CGROUP_DIR/pids.events")"
timeout 25 ssh_vm "bash -lc 'set +e; for i in \$(seq 1 2000); do sleep 120 >/dev/null 2>&1 & done; pkill -f \"^sleep 120\" >/dev/null 2>&1 || true; wait 2>/dev/null || true'" >/dev/null 2>&1 || true
PIDS_MAX_EVENTS_AFTER="$(sudo awk '/max/ {print $2}' "$CGROUP_DIR/pids.events")"
if [[ "$PIDS_MAX_EVENTS_AFTER" =~ ^[0-9]+$ ]] && [[ "$PIDS_MAX_EVENTS_BEFORE" =~ ^[0-9]+$ ]] && (( PIDS_MAX_EVENTS_AFTER > PIDS_MAX_EVENTS_BEFORE )); then
  print_pass "pids limit hit (pids.events max $PIDS_MAX_EVENTS_BEFORE -> $PIDS_MAX_EVENTS_AFTER)"
else
  print_fail "pids limit did not trigger (pids.events max $PIDS_MAX_EVENTS_BEFORE -> $PIDS_MAX_EVENTS_AFTER)"
  exit 1
fi

print_step "verify low memory cgroup profile blocks VM startup"
run_cli stop "$VM_ID"
set +e
(
  cd "$PROJECT_ROOT"
  MICROVM_CGROUP_MEMORY_MAX=700000000 bun src/index.ts start "$VM_ID" --no-attach
) >/tmp/microvm-cgroup-lowmem.out 2>/tmp/microvm-cgroup-lowmem.err
LOWMEM_RC=$?
set -e
if [[ "$LOWMEM_RC" -eq 0 ]]; then
  print_fail "low-memory start unexpectedly succeeded"
  run_cli stop "$VM_ID" >/dev/null 2>&1 || true
  exit 1
fi
print_pass "low-memory start failed as expected"

print_step "verify VM still starts with normal cgroup profile"
run_cli start "$VM_ID" --no-attach
if ssh_vm "echo post-lowmem-ok" >/dev/null 2>&1; then
  print_pass "normal start works after low-memory failure"
else
  print_fail "normal start failed after low-memory test"
  exit 1
fi

print_step "delete VM and verify cleanup"
run_cli delete "$VM_ID"
WAS_DELETED="1"
if run_cli status "$VM_ID" >/dev/null 2>&1; then
  print_fail "VM still exists after delete"
  exit 1
fi
if [[ -d "$PROJECT_ROOT/.microvm/vms/$VM_ID" ]]; then
  print_fail "VM directory still exists after delete: $PROJECT_ROOT/.microvm/vms/$VM_ID"
  exit 1
fi
print_pass "VM deleted and cleaned up"

echo
echo "[cgroup] all cgroup security checks passed for VM $VM_ID"
