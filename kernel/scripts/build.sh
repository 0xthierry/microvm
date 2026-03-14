#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
KERNEL_DIR=$(cd "${SCRIPT_DIR}/.." && pwd)
REPO_ROOT=$(cd "${KERNEL_DIR}/.." && pwd)

# shellcheck source=/dev/null
source "${KERNEL_DIR}/manifest/versions.env"

TARGET_ARCH=$(uname -m)
KERNEL_TAG="${AMAZON_LINUX_KERNEL_TAG}"

usage() {
  cat <<'EOF'
Usage: ./kernel/scripts/build.sh [--arch x86_64|aarch64] [--tag <amazon-linux-tag>]

Build the repo-local guest kernel artifact into kernel/dist/<arch>/.

Examples:
  ./kernel/scripts/build.sh
  ./kernel/scripts/build.sh --arch aarch64
  CROSS_COMPILE=aarch64-linux-gnu- ./kernel/scripts/build.sh --arch aarch64
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --arch)
      TARGET_ARCH="$2"
      shift 2
      ;;
    --tag)
      KERNEL_TAG="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

for cmd in git make gcc bc flex bison sed cp uname nproc; do
  require_command "$cmd"
done

for cmd in curl tar patch; do
  require_command "$cmd"
done

case "${TARGET_ARCH}" in
  x86_64)
    LINUX_ARCH="x86_64"
    MAKE_TARGET="vmlinux"
    BUILT_KERNEL_RELATIVE_PATH="vmlinux"
    BASE_CONFIG="${KERNEL_DIR}/config/firecracker/microvm-kernel-ci-x86_64-6.1.config"
    ;;
  aarch64)
    LINUX_ARCH="arm64"
    MAKE_TARGET="Image"
    BUILT_KERNEL_RELATIVE_PATH="arch/arm64/boot/Image"
    BASE_CONFIG="${KERNEL_DIR}/config/firecracker/microvm-kernel-ci-aarch64-6.1.config"
    ;;
  *)
    echo "Unsupported target architecture: ${TARGET_ARCH}" >&2
    exit 1
    ;;
esac

HOST_ARCH=$(uname -m)
if [[ "${HOST_ARCH}" != "${TARGET_ARCH}" && -z "${CROSS_COMPILE:-}" ]]; then
  echo "Cross-compilation is not configured. Set CROSS_COMPILE to build ${TARGET_ARCH} on ${HOST_ARCH}." >&2
  exit 1
fi

SRC_DIR="${KERNEL_DIR}/src/amazonlinux-linux"
SRC_ARCHIVE="${KERNEL_DIR}/src/${KERNEL_TAG}.tar.gz"
OUT_DIR="${KERNEL_DIR}/out/${TARGET_ARCH}"
DIST_DIR="${KERNEL_DIR}/dist/${TARGET_ARCH}"
PATCH_DIR="${KERNEL_DIR}/patches/vmclock/6.1"
META_PATH="${DIST_DIR}/vmlinux.meta.json"

mkdir -p "${KERNEL_DIR}/src" "${OUT_DIR}" "${DIST_DIR}"

extract_source_tree() {
  local temp_extract_dir="${KERNEL_DIR}/src/.extract-${KERNEL_TAG}-$$"
  rm -rf "${temp_extract_dir}"
  mkdir -p "${temp_extract_dir}"
  tar -xzf "${SRC_ARCHIVE}" -C "${temp_extract_dir}"

  local extracted_root
  extracted_root=$(find "${temp_extract_dir}" -mindepth 1 -maxdepth 1 -type d | head -n 1)
  if [[ -z "${extracted_root}" ]]; then
    echo "Failed to determine extracted source directory from ${SRC_ARCHIVE}" >&2
    exit 1
  fi

  mv "${extracted_root}" "${SRC_DIR}"
  rmdir "${temp_extract_dir}"
}

prepare_source_tree() {
  if [[ ! -f "${SRC_ARCHIVE}" ]]; then
    curl -L "${AMAZON_LINUX_KERNEL_REPO_URL}/archive/refs/tags/${KERNEL_TAG}.tar.gz" -o "${SRC_ARCHIVE}"
  fi

  rm -rf "${SRC_DIR}"
  extract_source_tree
}

prepare_source_tree

for patch in "${PATCH_DIR}"/*.patch; do
  patch -d "${SRC_DIR}" -p1 < "${patch}"
done

cat \
  "${BASE_CONFIG}" \
  "${KERNEL_DIR}/config/firecracker/ci.config" \
  "${KERNEL_DIR}/config/firecracker/pcie.config" \
  "${KERNEL_DIR}/config/firecracker/virtio-pmem.config" \
  "${KERNEL_DIR}/config/firecracker/virtio-mem.config" \
  "${KERNEL_DIR}/config/firecracker/vmclock.config" \
  "${KERNEL_DIR}/config/overlays/docker-netfilter.config" \
  > "${OUT_DIR}/.config"

MAKE_ARGS=(
  "-C" "${SRC_DIR}"
  "O=${OUT_DIR}"
  "ARCH=${LINUX_ARCH}"
)

if [[ -n "${CROSS_COMPILE:-}" ]]; then
  MAKE_ARGS+=("CROSS_COMPILE=${CROSS_COMPILE}")
fi

make "${MAKE_ARGS[@]}" olddefconfig
make "${MAKE_ARGS[@]}" -j"$(nproc)" "${MAKE_TARGET}"

FULL_KERNEL_RELEASE=$(tr -d '\n' < "${OUT_DIR}/include/config/kernel.release")
NORMALIZED_VERSION=$(printf '%s' "${FULL_KERNEL_RELEASE}" | sed -E 's/(.*[[:digit:]]).*/\1/g')

cp "${OUT_DIR}/${BUILT_KERNEL_RELATIVE_PATH}" "${DIST_DIR}/vmlinux"
cp "${OUT_DIR}/.config" "${DIST_DIR}/vmlinux.config"

printf '%s\n' '{' > "${META_PATH}"
printf '  "releaseTag": "%s",\n' "${KERNEL_TAG}" >> "${META_PATH}"
printf '  "ciVersion": "custom-%s",\n' "${AMAZON_LINUX_KERNEL_LINE}" >> "${META_PATH}"
printf '  "version": "%s",\n' "${NORMALIZED_VERSION}" >> "${META_PATH}"
printf '  "sourceUrl": "%s/tree/%s",\n' "${AMAZON_LINUX_KERNEL_REPO_URL}" "${KERNEL_TAG}" >> "${META_PATH}"
printf '  "downloadedAt": "%s",\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" >> "${META_PATH}"
printf '  "firecrackerConfigRepoUrl": "%s",\n' "${FIRECRACKER_CONFIG_REPO_URL}" >> "${META_PATH}"
printf '  "firecrackerConfigCommit": "%s",\n' "${FIRECRACKER_CONFIG_COMMIT}" >> "${META_PATH}"
printf '  "targetArch": "%s"\n' "${TARGET_ARCH}" >> "${META_PATH}"
printf '%s\n' '}' >> "${META_PATH}"

echo "Built kernel artifact:"
echo "  ${DIST_DIR}/vmlinux"
echo "Resolved kernel release:"
echo "  ${FULL_KERNEL_RELEASE}"
