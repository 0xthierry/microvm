#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$PROJECT_ROOT/e2e/lib/steps.sh"
export MICROVM_HOME="${MICROVM_HOME:-${PROJECT_ROOT}/.microvm}"
VM_ID="cgopt$(date +%s | tail -c 7)"
KEEP_VM_ON_EXIT="${KEEP_VM_ON_EXIT:-0}"
CREATED_VM="0"
WAS_DELETED="0"

require_no_positional_args "e2e/security/cgroup-overrides.sh" "$@"

CREATE_CPUS="${CREATE_CPUS:-3}"
CREATE_MEMORY_MIB="${CREATE_MEMORY_MIB:-768}"
CREATE_DISK_GIB="${CREATE_DISK_GIB:-12}"
CREATE_SSH_USER="${CREATE_SSH_USER:-root}"
DOCKERFILE_PATH="${DOCKERFILE_PATH:-scripts/Dockerfile.test-ubuntu}"

EXPECT_CGROUP_PARENT="${TEST_CGROUP_PARENT:-microvm-options-security}"
EXPECT_MEMORY_MAX="${TEST_CGROUP_MEMORY_MAX:-2147483648}"
EXPECT_MEMORY_SWAP_MAX="${TEST_CGROUP_MEMORY_SWAP_MAX:-0}"
EXPECT_CPU_MAX="${TEST_CGROUP_CPU_MAX:-150000 100000}"
EXPECT_PIDS_MAX="${TEST_CGROUP_PIDS_MAX:-256}"
EXPECT_RLIMIT_NOFILE="${TEST_RLIMIT_NOFILE:-1536}"
EXPECT_RLIMIT_FSIZE="${TEST_RLIMIT_FSIZE:-2147483648}"

STATUS_JSON=""
VM_RUNNING=""
VM_RESOLVED_ID=""
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
  echo "[cgroup-options] missing dependency: $1" >&2
  exit 2
}

require_cmd bun
require_cmd ssh
require_cmd timeout
require_cmd sudo
require_cmd awk

run_cli() {
  (
    cd "$PROJECT_ROOT"
    bun src/index.ts "$@"
  )
}

run_cli_profile() {
  (
    cd "$PROJECT_ROOT"
    MICROVM_CGROUP_PARENT="$EXPECT_CGROUP_PARENT" \
    MICROVM_CGROUP_MEMORY_MAX="$EXPECT_MEMORY_MAX" \
    MICROVM_CGROUP_MEMORY_SWAP_MAX="$EXPECT_MEMORY_SWAP_MAX" \
    MICROVM_CGROUP_CPU_MAX="$EXPECT_CPU_MAX" \
    MICROVM_CGROUP_PIDS_MAX="$EXPECT_PIDS_MAX" \
    MICROVM_RLIMIT_NOFILE="$EXPECT_RLIMIT_NOFILE" \
    MICROVM_RLIMIT_FSIZE="$EXPECT_RLIMIT_FSIZE" \
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

bdd_feature "Security cgroup overrides"
bdd_scenario "Environment-driven cgroup and rlimit overrides are honored and persist"

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
  STATUS_JSON="$(run_cli status "$VM_ID" --json)"
  VM_RUNNING="$(json_field running)"
  VM_RESOLVED_ID="$(json_field vm.vmId)"
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
EXPECTED_DISK_MIB="$((CREATE_DISK_GIB * 1024))"
EXPECTED_DISK_BYTES="$((EXPECTED_DISK_MIB * 1024 * 1024))"

if run_cli status "$VM_ID" >/dev/null 2>&1; then
  print_fail "VM $VM_ID already exists. Use a different id to avoid side effects."
  exit 1
fi

print_step "Given a VM is created with explicit compute and image options"
run_cli create --name "$VM_ID" \
  --cpus "$CREATE_CPUS" \
  --memory-mib "$CREATE_MEMORY_MIB" \
  --disk-gib "$CREATE_DISK_GIB" \
  --dockerfile "$DOCKERFILE_PATH" \
  --ssh-user "$CREATE_SSH_USER"
CREATED_VM="1"

load_status
assert_eq "running_after_create" "false" "$VM_RUNNING"
assert_eq "vcpu_count" "$CREATE_CPUS" "$VM_CPUS"
assert_eq "mem_size_mib" "$CREATE_MEMORY_MIB" "$VM_MEMORY_MIB"
assert_eq "disk_size_mib" "$EXPECTED_DISK_MIB" "$VM_DISK_MIB"
assert_eq "ssh_user" "$CREATE_SSH_USER" "$VM_USER"
assert_eq "dockerfile_path" "$EXPECTED_DOCKERFILE_PATH" "$VM_DOCKERFILE"

print_step "When I start the VM with cgroup and rlimit overrides"
run_cli_profile up "$VM_ID" --no-attach
load_status
assert_eq "running_after_start" "true" "$VM_RUNNING"
if [[ -z "$VM_PID" ]]; then
  print_fail "VM PID is missing after start"
  exit 1
fi
print_pass "VM is running (pid=$VM_PID ip=$VM_IP)"

if ssh_vm "echo ready" >/dev/null 2>&1; then
  print_pass "SSH reachable"
else
  print_fail "SSH not reachable"
  exit 1
fi

print_step "Then firecracker joins the expected cgroup path"
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
if [[ -z "$VM_RESOLVED_ID" ]]; then
  print_fail "status did not include vm.vmId"
  exit 1
fi
EXPECTED_CGROUP_REL="/$EXPECT_CGROUP_PARENT/$VM_RESOLVED_ID"
assert_eq "cgroup_path" "$EXPECTED_CGROUP_REL" "$CGROUP_REL"

print_step "And override cgroup limits are applied"
MEMORY_MAX="$(sudo cat "$CGROUP_DIR/memory.max")"
MEMORY_SWAP_MAX="$(sudo cat "$CGROUP_DIR/memory.swap.max")"
CPU_MAX="$(sudo cat "$CGROUP_DIR/cpu.max")"
PIDS_MAX="$(sudo cat "$CGROUP_DIR/pids.max")"

assert_eq "memory.max" "$EXPECT_MEMORY_MAX" "$MEMORY_MAX"
assert_eq "memory.swap.max" "$EXPECT_MEMORY_SWAP_MAX" "$MEMORY_SWAP_MAX"
assert_eq "cpu.max" "$EXPECT_CPU_MAX" "$CPU_MAX"
assert_eq "pids.max" "$EXPECT_PIDS_MAX" "$PIDS_MAX"

print_step "And process rlimits satisfy configured bounds"
NOFILE_SOFT="$(awk '/Max open files/ {print $(NF-2)}' "/proc/$VM_PID/limits")"
FSIZE_SOFT="$(awk '/Max file size/ {print $(NF-2)}' "/proc/$VM_PID/limits")"
assert_eq "rlimit_nofile" "$EXPECT_RLIMIT_NOFILE" "$NOFILE_SOFT"
if [[ "$FSIZE_SOFT" =~ ^[0-9]+$ ]] && (( FSIZE_SOFT >= EXPECTED_DISK_BYTES )); then
  print_pass "rlimit_fsize is >= disk bytes ($FSIZE_SOFT >= $EXPECTED_DISK_BYTES)"
else
  print_fail "rlimit_fsize is too low for disk bytes (fsize=$FSIZE_SOFT expected_at_least=$EXPECTED_DISK_BYTES)"
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

print_step "When I restart with the same profile"
run_cli down "$VM_ID"
run_cli_profile up "$VM_ID" --no-attach
load_status
assert_eq "running_after_restart" "true" "$VM_RUNNING"
NEW_CGROUP_REL="$(awk -F: '/0::/ {print $3}' "/proc/$VM_PID/cgroup")"
assert_eq "cgroup_path_after_restart" "$EXPECTED_CGROUP_REL" "$NEW_CGROUP_REL"
NEW_CGROUP_DIR="/sys/fs/cgroup$NEW_CGROUP_REL"
assert_eq "memory.max_after_restart" "$EXPECT_MEMORY_MAX" "$(sudo cat "$NEW_CGROUP_DIR/memory.max")"
assert_eq "cpu.max_after_restart" "$EXPECT_CPU_MAX" "$(sudo cat "$NEW_CGROUP_DIR/cpu.max")"

print_step "Then deleting the VM removes persisted runtime artifacts"
run_cli delete "$VM_ID"
WAS_DELETED="1"
CREATED_VM="0"
if run_cli status "$VM_ID" >/dev/null 2>&1; then
  print_fail "VM still exists after delete"
  exit 1
fi
VM_DIR="$(dirname "$VM_ROOTFS")"
if [[ -d "$VM_DIR" ]]; then
  print_fail "VM directory still exists after delete: $VM_DIR"
  exit 1
fi
print_pass "VM deleted and cleaned up"

echo
echo "[cgroup-options] all cgroup security checks with options passed for VM $VM_ID"
