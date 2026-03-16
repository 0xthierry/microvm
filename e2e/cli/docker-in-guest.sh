#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$PROJECT_ROOT/e2e/lib/steps.sh"
export MICROVM_HOME="${MICROVM_HOME:-${PROJECT_ROOT}/.microvm}"
VM_ID="e2edocker$(date +%s | tail -c 7)"
KEEP_VM_ON_EXIT="${KEEP_VM_ON_EXIT:-0}"
WAS_DELETED="0"
DOCKERFILE_PATH="${DOCKERFILE_PATH:-scripts/Dockerfile.test-ubuntu-docker}"

require_no_positional_args "e2e/cli/docker-in-guest.sh" "$@"

require_cmd() {
  if command -v "$1" >/dev/null 2>&1; then
    return
  fi
  echo "[e2e] missing dependency: $1" >&2
  exit 2
}

require_cmd bun
require_cmd ssh
require_cmd sudo
require_cmd timeout

if ! sudo -n true >/dev/null 2>&1; then
  echo "[e2e] an active sudo session is required; run 'sudo -v' before starting this test." >&2
  exit 2
fi

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

bdd_feature "Docker inside Firecracker microVM"
bdd_scenario "Start Docker in the guest and run a container"

STATUS_JSON=""
VM_RUNNING=""
VM_IP=""
VM_USER=""
VM_KEY=""

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

wait_for_guest_command() {
  local timeout_seconds="$1"
  local command="$2"
  local start="$SECONDS"

  while true; do
    if ssh_vm "$command" >/dev/null 2>&1; then
      return 0
    fi
    if (( SECONDS - start >= timeout_seconds )); then
      return 1
    fi
    sleep 1
  done
}

print_diagnostics() {
  echo "[diag] docker service status" >&2
  ssh_vm "systemctl status docker --no-pager || true" >&2 || true
  echo "[diag] containerd service status" >&2
  ssh_vm "systemctl status containerd --no-pager || true" >&2 || true
  echo "[diag] docker journal" >&2
  ssh_vm "journalctl -u docker --no-pager -n 100 || true" >&2 || true
  echo "[diag] guest raw iptables" >&2
  ssh_vm "iptables -t raw -S || true" >&2 || true
}

print_step "Given a unique VM id $VM_ID"
run_cli create --name "$VM_ID" --dockerfile "$DOCKERFILE_PATH"
print_pass "VM created from $DOCKERFILE_PATH"

print_step "When I start the VM without attaching"
run_cli up "$VM_ID" --no-attach
assert_running "1"

print_step "Then SSH reaches the guest"
if ssh_vm "echo ssh-ok" >/dev/null 2>&1; then
  print_pass "SSH reachable after start"
else
  print_fail "SSH not reachable after start"
  exit 1
fi

print_step "And Docker becomes ready inside the guest"
if wait_for_guest_command 60 "docker info >/dev/null 2>&1"; then
  print_pass "Docker daemon is ready"
else
  print_fail "Docker daemon did not become ready within 60 seconds"
  print_diagnostics
  exit 1
fi

print_step "When I run a container inside the guest"
DOCKER_RUN_OUTPUT="$(ssh_vm "docker run --rm hello-world" 2>&1)" || {
  print_fail "docker run failed inside the guest"
  printf '%s\n' "$DOCKER_RUN_OUTPUT" >&2
  print_diagnostics
  exit 1
}

print_step "Then Docker can run workloads inside the Firecracker microVM"
if [[ "$DOCKER_RUN_OUTPUT" == *"Hello from Docker!"* ]]; then
  print_pass "docker run hello-world succeeded"
else
  print_fail "docker run completed without the expected hello-world output"
  printf '%s\n' "$DOCKER_RUN_OUTPUT" >&2
  exit 1
fi

print_step "And the guest exposes the raw iptables table Docker needs"
if ssh_vm "iptables -t raw -S >/dev/null"; then
  print_pass "raw iptables table is available inside the guest"
else
  print_fail "raw iptables table is unavailable inside the guest"
  print_diagnostics
  exit 1
fi

print_step "Then deleting the VM removes its runtime state"
run_cli delete "$VM_ID"
WAS_DELETED="1"
print_pass "VM deleted cleanly after docker validation"

echo
echo "[e2e] Docker-in-guest test passed for VM $VM_ID"
