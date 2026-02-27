#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$PROJECT_ROOT/e2e/lib/steps.sh"
export MICROVM_HOME="${MICROVM_HOME:-${PROJECT_ROOT}/.microvm}"
VM_ID="cgt$(date +%s)"
KEEP_VM_ON_EXIT="${KEEP_VM_ON_EXIT:-0}"
CREATED_VM="0"
WAS_DELETED="0"

require_no_positional_args "e2e/security/cgroup-defaults.sh" "$@"

EXPECT_MEMORY_MAX="${MICROVM_CGROUP_MEMORY_MAX:-1610612736}"
EXPECT_MEMORY_SWAP_MAX="${MICROVM_CGROUP_MEMORY_SWAP_MAX:-0}"
EXPECT_CPU_MAX="${MICROVM_CGROUP_CPU_MAX:-200000 100000}"
EXPECT_PIDS_MAX="${MICROVM_CGROUP_PIDS_MAX:-512}"
LOW_MEMORY_START_CAP_BYTES="${TEST_LOW_MEMORY_START_CAP_BYTES:-700000000}"
DOCKERFILE_PATH="${DOCKERFILE_PATH:-scripts/Dockerfile.test-ubuntu}"

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
    if [[ "$CREATED_VM" == "1" ]]; then
      bun src/index.ts delete "$VM_ID" >/dev/null 2>&1 || true
    else
      bun src/index.ts down "$VM_ID" >/dev/null 2>&1 || true
    fi
  )
}

trap cleanup EXIT

bdd_feature "Security cgroup baseline"
bdd_scenario "Default cgroup controls are enforced across lifecycle operations"

if run_cli status "$VM_ID" >/dev/null 2>&1; then
  print_fail "VM $VM_ID already exists. Use a different id to avoid side effects."
  exit 1
fi

print_step "Given VM $VM_ID is created and started"
run_cli create --name "$VM_ID" --dockerfile "$DOCKERFILE_PATH"
CREATED_VM="1"
run_cli up "$VM_ID" --no-attach

STATUS_JSON="$(run_cli status "$VM_ID" --json)"
VM_RUNNING="$(printf '%s' "$STATUS_JSON" | bun -e 'const fs=require("node:fs"); const j=JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(j.running ? "1" : "0");')"
VM_IP="$(printf '%s' "$STATUS_JSON" | bun -e 'const fs=require("node:fs"); const j=JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(j.vm.guestIp);')"
VM_USER="$(printf '%s' "$STATUS_JSON" | bun -e 'const fs=require("node:fs"); const j=JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(j.vm.sshUser);')"
VM_KEY="$(printf '%s' "$STATUS_JSON" | bun -e 'const fs=require("node:fs"); const j=JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(j.vm.sshKeyPath);')"
VM_PID="$(printf '%s' "$STATUS_JSON" | bun -e 'const fs=require("node:fs"); const j=JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(String(j.vm.runtime?.firecrackerPid ?? ""));')"
VM_ROOTFS="$(printf '%s' "$STATUS_JSON" | bun -e 'const fs=require("node:fs"); const j=JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(j.vm.rootfsPath);')"
VM_DIR="$(dirname "$VM_ROOTFS")"

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

print_step "When I inspect the firecracker cgroup path"
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

print_step "Then the configured cgroup limits match expected defaults"
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

print_step "And CPU throttling is observable under pressure"
NR_THROTTLED_BEFORE="$(sudo awk '/nr_throttled/ {print $2}' "$CGROUP_DIR/cpu.stat")"
THROTTLED_USEC_BEFORE="$(sudo awk '/throttled_usec/ {print $2}' "$CGROUP_DIR/cpu.stat")"
timeout 40 ssh_vm "bash -lc 'set +e; p=\"\"; for i in \$(seq 1 16); do yes >/dev/null & p=\"\$p \$!\"; done; sleep 15; kill \$p >/dev/null 2>&1 || true; wait >/dev/null 2>&1 || true'" >/dev/null 2>&1 || true
NR_THROTTLED_AFTER="$(sudo awk '/nr_throttled/ {print $2}' "$CGROUP_DIR/cpu.stat")"
THROTTLED_USEC_AFTER="$(sudo awk '/throttled_usec/ {print $2}' "$CGROUP_DIR/cpu.stat")"
if [[ "$NR_THROTTLED_AFTER" =~ ^[0-9]+$ ]] && [[ "$NR_THROTTLED_BEFORE" =~ ^[0-9]+$ ]] && (( NR_THROTTLED_AFTER > NR_THROTTLED_BEFORE )); then
  print_pass "cpu throttling observed (nr_throttled $NR_THROTTLED_BEFORE -> $NR_THROTTLED_AFTER)"
elif [[ "$THROTTLED_USEC_AFTER" =~ ^[0-9]+$ ]] && [[ "$THROTTLED_USEC_BEFORE" =~ ^[0-9]+$ ]] && (( THROTTLED_USEC_AFTER > THROTTLED_USEC_BEFORE )); then
  print_pass "cpu throttling observed (throttled_usec $THROTTLED_USEC_BEFORE -> $THROTTLED_USEC_AFTER)"
else
  print_step "guest-side load did not trigger visible throttling; validating with host-side cgroup load"
  HOST_PIDS_FILE="$(mktemp)"
  for _i in $(seq 1 24); do
    yes >/dev/null 2>&1 &
    echo "$!" >>"$HOST_PIDS_FILE"
  done
  while read -r _pid; do
    sudo sh -c "echo $_pid > '$CGROUP_DIR/cgroup.procs'" >/dev/null 2>&1 || true
  done <"$HOST_PIDS_FILE"
  sleep 8
  while read -r _pid; do
    kill "$_pid" >/dev/null 2>&1 || true
  done <"$HOST_PIDS_FILE"
  rm -f "$HOST_PIDS_FILE"

  NR_THROTTLED_FINAL="$(sudo awk '/nr_throttled/ {print $2}' "$CGROUP_DIR/cpu.stat")"
  THROTTLED_USEC_FINAL="$(sudo awk '/throttled_usec/ {print $2}' "$CGROUP_DIR/cpu.stat")"
  if [[ "$NR_THROTTLED_FINAL" =~ ^[0-9]+$ ]] && (( NR_THROTTLED_FINAL > NR_THROTTLED_AFTER )); then
    print_pass "cpu throttling observed with host-side cgroup load (nr_throttled $NR_THROTTLED_AFTER -> $NR_THROTTLED_FINAL)"
  elif [[ "$THROTTLED_USEC_FINAL" =~ ^[0-9]+$ ]] && (( THROTTLED_USEC_FINAL > THROTTLED_USEC_AFTER )); then
    print_pass "cpu throttling observed with host-side cgroup load (throttled_usec $THROTTLED_USEC_AFTER -> $THROTTLED_USEC_FINAL)"
  else
    print_fail "cpu throttling was not observed (nr_throttled $NR_THROTTLED_BEFORE -> $NR_THROTTLED_AFTER -> $NR_THROTTLED_FINAL, throttled_usec $THROTTLED_USEC_BEFORE -> $THROTTLED_USEC_AFTER -> $THROTTLED_USEC_FINAL)"
    exit 1
  fi
fi

print_step "And pids.max is enforced"
PIDS_MAX_EVENTS_BEFORE="$(sudo awk '/max/ {print $2}' "$CGROUP_DIR/pids.events")"
START_GATE="$(mktemp)"
FORK_FAIL_MARKER="$(mktemp)"
rm -f "$FORK_FAIL_MARKER"
bash -lc '
  set +e
  gate="$1"
  fail_marker="$2"
  while [[ ! -f "$gate" ]]; do
    sleep 0.02
  done
  p=""
  for _i in $(seq 1 2048); do
    sleep 120 >/dev/null 2>&1 &
    rc=$?
    if (( rc != 0 )); then
      echo "fork-failed" > "$fail_marker"
      break
    fi
    p="$p $!"
  done
  sleep 1
  kill $p >/dev/null 2>&1 || true
  wait >/dev/null 2>&1 || true
' _ "$START_GATE" "$FORK_FAIL_MARKER" &
FORKER_PID="$!"
sudo sh -c "echo $FORKER_PID > '$CGROUP_DIR/cgroup.procs'"
touch "$START_GATE"
wait "$FORKER_PID" || true
rm -f "$START_GATE"
PIDS_MAX_EVENTS_AFTER="$(sudo awk '/max/ {print $2}' "$CGROUP_DIR/pids.events")"
if [[ "$PIDS_MAX_EVENTS_AFTER" =~ ^[0-9]+$ ]] && [[ "$PIDS_MAX_EVENTS_BEFORE" =~ ^[0-9]+$ ]] && (( PIDS_MAX_EVENTS_AFTER > PIDS_MAX_EVENTS_BEFORE )); then
  print_pass "pids limit hit (pids.events max $PIDS_MAX_EVENTS_BEFORE -> $PIDS_MAX_EVENTS_AFTER)"
elif [[ -f "$FORK_FAIL_MARKER" ]]; then
  print_pass "pids limit enforced (fork failed in cgroup workload)"
else
  print_fail "pids limit did not trigger (pids.events max $PIDS_MAX_EVENTS_BEFORE -> $PIDS_MAX_EVENTS_AFTER)"
  rm -f "$FORK_FAIL_MARKER"
  exit 1
fi
rm -f "$FORK_FAIL_MARKER"

print_step "When I force an up with a low-memory cgroup profile"
run_cli down "$VM_ID"
set +e
(
  cd "$PROJECT_ROOT"
  MICROVM_CGROUP_MEMORY_MAX="$LOW_MEMORY_START_CAP_BYTES" bun src/index.ts up "$VM_ID" --no-attach
) >/tmp/microvm-cgroup-lowmem.out 2>/tmp/microvm-cgroup-lowmem.err
LOWMEM_RC=$?
set -e
if [[ "$LOWMEM_RC" -eq 0 ]]; then
  print_fail "low-memory start unexpectedly succeeded (memory.max=$LOW_MEMORY_START_CAP_BYTES)"
  run_cli down "$VM_ID" >/dev/null 2>&1 || true
  exit 1
fi
print_pass "low-memory start failed as expected (memory.max=$LOW_MEMORY_START_CAP_BYTES)"

print_step "Then the VM can still boot with the normal profile"
run_cli up "$VM_ID" --no-attach
if ssh_vm "echo post-lowmem-ok" >/dev/null 2>&1; then
  print_pass "normal start works after low-memory failure"
else
  print_fail "normal start failed after low-memory test"
  exit 1
fi

print_step "And deleting the VM cleans up filesystem state"
run_cli delete "$VM_ID"
WAS_DELETED="1"
if run_cli status "$VM_ID" >/dev/null 2>&1; then
  print_fail "VM still exists after delete"
  exit 1
fi
if [[ -d "$VM_DIR" ]]; then
  print_fail "VM directory still exists after delete: $VM_DIR"
  exit 1
fi
print_pass "VM deleted and cleaned up"

echo
echo "[cgroup] all cgroup security checks passed for VM $VM_ID"
