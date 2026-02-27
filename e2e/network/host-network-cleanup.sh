#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$PROJECT_ROOT/e2e/lib/steps.sh"
export MICROVM_HOME="${MICROVM_HOME:-${PROJECT_ROOT}/.microvm}"

VM_NAME="nclean$(date +%s | tail -c 7)"
KEEP_VM_ON_EXIT="${KEEP_VM_ON_EXIT:-0}"
TEST_IP_FORWARD_BASELINE="${TEST_IP_FORWARD_BASELINE:-keep}"
DOCKERFILE_PATH="${DOCKERFILE_PATH:-scripts/Dockerfile.test-ubuntu}"

require_no_positional_args "e2e/network/host-network-cleanup.sh" "$@"

CREATED_VM="0"
FORCED_IP_FORWARD_BASELINE="0"
ORIGINAL_IP_FORWARD=""

require_cmd() {
  if command -v "$1" >/dev/null 2>&1; then
    return
  fi
  echo "[network-cleanup-e2e] missing dependency: $1" >&2
  exit 2
}

require_cmd bun
require_cmd ssh
require_cmd sudo
require_cmd ip
require_cmd iptables

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

read_ip_forward() {
  sudo sysctl -n net.ipv4.ip_forward | tr -d '[:space:]'
}

set_ip_forward() {
  local value="$1"
  sudo sysctl -w "net.ipv4.ip_forward=$value" >/dev/null
}

assert_ip_forward() {
  local expected="$1"
  local actual
  actual="$(read_ip_forward)"
  if [[ "$actual" == "$expected" ]]; then
    print_pass "net.ipv4.ip_forward=$actual"
    return
  fi
  print_fail "expected net.ipv4.ip_forward=$expected got=$actual"
  exit 1
}

iptables_dump_chain() {
  local table="$1"
  local chain="$2"
  if [[ "$table" == "nat" ]]; then
    sudo iptables -t nat -S "$chain"
    return
  fi
  sudo iptables -S "$chain"
}

line_has_all_tokens() {
  local line="$1"
  shift
  local token
  for token in "$@"; do
    if [[ "$line" != *"$token"* ]]; then
      return 1
    fi
  done
  return 0
}

assert_iptables_rule_present_tokens() {
  local table="$1"
  local chain="$2"
  local label="$3"
  shift 3
  local dump
  dump="$(iptables_dump_chain "$table" "$chain")"
  while IFS= read -r line; do
    if line_has_all_tokens "$line" "$@"; then
      print_pass "iptables $table/$chain contains: $label"
      return
    fi
  done <<< "$dump"
  print_fail "iptables $table/$chain missing: $label"
  printf '%s\n' "$dump" >&2
  exit 1
}

assert_iptables_rule_absent_tokens() {
  local table="$1"
  local chain="$2"
  local label="$3"
  shift 3
  local dump
  dump="$(iptables_dump_chain "$table" "$chain")"
  while IFS= read -r line; do
    if line_has_all_tokens "$line" "$@"; then
      print_fail "iptables $table/$chain still contains: $label"
      printf '%s\n' "$dump" >&2
      exit 1
    fi
  done <<< "$dump"
  print_pass "iptables $table/$chain removed: $label"
}

assert_no_running_vms() {
  local running
  running="$(run_cli list --json | bun -e '
    const fs = require("node:fs");
    const obj = JSON.parse(fs.readFileSync(0, "utf8"));
    const names = (obj?.vms ?? [])
      .filter((vm) => vm?.status === "running")
      .map((vm) => `${vm.name}(${vm.id})`);
    process.stdout.write(names.join(","));
  ')"
  if [[ -z "$running" ]]; then
    print_pass "precheck: no running VMs"
    return
  fi
  print_fail "precheck failed: running VMs detected ($running). Stop/delete them before this test."
  exit 1
}

cleanup() {
  if [[ "$FORCED_IP_FORWARD_BASELINE" == "1" && -n "$ORIGINAL_IP_FORWARD" ]]; then
    set_ip_forward "$ORIGINAL_IP_FORWARD" || true
  fi

  if [[ "$KEEP_VM_ON_EXIT" == "1" ]]; then
    return
  fi

  if [[ "$CREATED_VM" == "1" ]]; then
    run_cli delete "$VM_NAME" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

bdd_feature "Host network cleanup"
bdd_scenario "Network rules and forwarding are restored after VM teardown"

if run_cli status "$VM_NAME" >/dev/null 2>&1; then
  print_fail "VM $VM_NAME already exists. Use a different name."
  exit 1
fi

assert_no_running_vms

ORIGINAL_IP_FORWARD="$(read_ip_forward)"
BASELINE_IP_FORWARD="$ORIGINAL_IP_FORWARD"
case "$TEST_IP_FORWARD_BASELINE" in
  keep)
    ;;
  0|1)
    if [[ "$ORIGINAL_IP_FORWARD" != "$TEST_IP_FORWARD_BASELINE" ]]; then
      set_ip_forward "$TEST_IP_FORWARD_BASELINE"
      FORCED_IP_FORWARD_BASELINE="1"
    fi
    BASELINE_IP_FORWARD="$TEST_IP_FORWARD_BASELINE"
    ;;
  *)
    print_fail "invalid TEST_IP_FORWARD_BASELINE=$TEST_IP_FORWARD_BASELINE (expected keep|0|1)"
    exit 1
    ;;
esac

if [[ "$BASELINE_IP_FORWARD" == "1" ]]; then
  print_step "Given baseline ip_forward is 1 (restoration must still hold)"
else
  print_step "Given baseline ip_forward is $BASELINE_IP_FORWARD"
fi
assert_ip_forward "$BASELINE_IP_FORWARD"

print_step "When I create and boot the VM"
run_cli create --name "$VM_NAME" --dockerfile "$DOCKERFILE_PATH"
CREATED_VM="1"
run_cli up "$VM_NAME" --no-attach
assert_status_field "$VM_NAME" "running" "true"

VM_GUEST_IP="$(status_field "$VM_NAME" "vm.guestIp")"
VM_TAP_DEV="$(status_field "$VM_NAME" "vm.tapDev")"
VM_HOST_IFACE="$(status_field "$VM_NAME" "vm.runtime.hostIface")"

if [[ -z "$VM_GUEST_IP" || -z "$VM_TAP_DEV" || -z "$VM_HOST_IFACE" ]]; then
  print_fail "missing VM network fields (guestIp=$VM_GUEST_IP tapDev=$VM_TAP_DEV hostIface=$VM_HOST_IFACE)"
  exit 1
fi

print_step "Then host networking rules are present while the VM runs"
assert_ip_forward "1"
assert_iptables_rule_present_tokens "nat" "POSTROUTING" "POSTROUTING nat for guest/ip uplink" \
  "-A POSTROUTING" "-s $VM_GUEST_IP" "-o $VM_HOST_IFACE" "-j MASQUERADE"
assert_iptables_rule_present_tokens "filter" "FORWARD" "FORWARD allow tap->host iface" \
  "-A FORWARD" "-i $VM_TAP_DEV" "-o $VM_HOST_IFACE" "-j ACCEPT"
assert_iptables_rule_present_tokens "filter" "FORWARD" "FORWARD drop tap->tap-vm+" \
  "-A FORWARD" "-i $VM_TAP_DEV" "-o tap-vm+" "-j DROP"
assert_iptables_rule_present_tokens "filter" "INPUT" "INPUT drop guest->host default" \
  "-A INPUT" "-s $VM_GUEST_IP" "-i $VM_TAP_DEV" "-j DROP"

print_step "When I stop the VM"
run_cli down "$VM_NAME"
assert_status_field "$VM_NAME" "running" "false"
assert_status_field "$VM_NAME" "vm.status" "stopped"

print_step "Then host networking artifacts are cleaned up"
if ip link show dev "$VM_TAP_DEV" >/dev/null 2>&1; then
  print_fail "tap device still exists after down: $VM_TAP_DEV"
  exit 1
fi
print_pass "tap device removed: $VM_TAP_DEV"

assert_iptables_rule_absent_tokens "nat" "POSTROUTING" "POSTROUTING nat for guest/ip uplink" \
  "-A POSTROUTING" "-s $VM_GUEST_IP" "-o $VM_HOST_IFACE" "-j MASQUERADE"
assert_iptables_rule_absent_tokens "filter" "FORWARD" "FORWARD allow tap->host iface" \
  "-A FORWARD" "-i $VM_TAP_DEV" "-o $VM_HOST_IFACE" "-j ACCEPT"
assert_iptables_rule_absent_tokens "filter" "FORWARD" "FORWARD drop tap->tap-vm+" \
  "-A FORWARD" "-i $VM_TAP_DEV" "-o tap-vm+" "-j DROP"
assert_iptables_rule_absent_tokens "filter" "INPUT" "INPUT drop guest->host default" \
  "-A INPUT" "-s $VM_GUEST_IP" "-i $VM_TAP_DEV" "-j DROP"
assert_ip_forward "$BASELINE_IP_FORWARD"

print_step "And deleting the stopped VM removes repository state"
run_cli delete "$VM_NAME"
CREATED_VM="0"
if run_cli status "$VM_NAME" >/tmp/microvm-network-cleanup-status.out 2>/tmp/microvm-network-cleanup-status.err; then
  print_fail "status unexpectedly succeeded after delete for $VM_NAME"
  exit 1
fi
print_pass "delete removed VM record"

echo
echo "[network-cleanup-e2e] host network cleanup checks passed"
