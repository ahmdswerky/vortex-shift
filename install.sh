#!/usr/bin/env bash
set -euo pipefail
PROGRAM_NAME="vortex-shift"
INSTALL_PATH="/usr/local/bin/${PROGRAM_NAME}"
REPO="${VORTEX_SHIFT_REPO:-ahmdswerky/vortex-shift}"
log() {
  printf '[install] %s\n' "$1"
}
fail() {
  printf '[install] error: %s\n' "$1" >&2
  exit 1
}
require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "Missing required command: $1. Install it first (Rocky Linux: dnf install $1)."
  fi
}
detect_arch() {
  local machine
  machine="$(uname -m)"
  case "$machine" in
    x86_64|amd64) printf 'x64' ;;
    aarch64|arm64) printf 'arm64' ;;
    *) fail "Unsupported CPU architecture: ${machine}" ;;
  esac
}
resolve_tag() {
  local release_json="$1"
  local tag
  tag="$(printf '%s' "$release_json" | awk -F'"' '/"tag_name"[[:space:]]*:/ { print $4; exit }')"
  if [[ -z "${tag}" ]]; then
    fail "Unable to resolve release tag from GitHub API response."
  fi
  printf '%s' "$tag"
}
resolve_download_url() {
  local release_json="$1"
  local asset_name="$2"
  local url
  url="$(printf '%s' "$release_json" | grep -o "https://[^\"]*${asset_name}[^\"]*" | head -n 1 || true)"
  if [[ -z "${url}" ]]; then
    return 1
  fi
  printf '%s' "$url"
}
install_binary() {
  local source_file="$1"
  if [[ -w "$(dirname "$INSTALL_PATH")" ]]; then
    install -m 0755 "$source_file" "$INSTALL_PATH"
    return
  fi
  if ! command -v sudo >/dev/null 2>&1; then
    fail "No write permission for $(dirname "$INSTALL_PATH") and sudo is unavailable."
  fi
  sudo install -m 0755 "$source_file" "$INSTALL_PATH"
}
main() {
  if [[ "$(uname -s)" != "Linux" ]]; then
    fail "Unsupported OS: $(uname -s). This installer supports Linux only."
  fi
  require_command curl
  local arch
  arch="$(detect_arch)"
  local asset_name="${PROGRAM_NAME}-linux-${arch}"
  local fallback_asset_name="${PROGRAM_NAME}-${arch}"
  local release_url
  if [[ -n "${VORTEX_SHIFT_VERSION:-}" ]]; then
    local requested_tag="${VORTEX_SHIFT_VERSION#refs/tags/}"
    if [[ "${requested_tag#v}" == "${requested_tag}" ]]; then
      requested_tag="v${requested_tag}"
    fi
    release_url="https://api.github.com/repos/${REPO}/releases/tags/${requested_tag}"
  else
    release_url="https://api.github.com/repos/${REPO}/releases/latest"
  fi
  log "Resolving release metadata from ${release_url}"
  local release_json
  release_json="$(curl -fsSL "$release_url")" || fail "Unable to fetch release metadata."
  local tag
  tag="$(resolve_tag "$release_json")"
  local download_url
  if ! download_url="$(resolve_download_url "$release_json" "$asset_name")"; then
    if ! download_url="$(resolve_download_url "$release_json" "$fallback_asset_name")"; then
      fail "Release does not contain required asset: ${asset_name} or ${fallback_asset_name}"
    fi
    asset_name="$fallback_asset_name"
  fi
  log "Downloading ${asset_name} (${tag})"
  tmp_file="$(mktemp)"
  trap 'rm -f "$tmp_file"' EXIT
  curl -fsSL "$download_url" -o "$tmp_file" || fail "Failed to download binary asset."
  log "Installing to ${INSTALL_PATH}"
  install_binary "$tmp_file"
  local installed_version
  installed_version="$("${PROGRAM_NAME}" --version 2>/dev/null || true)"
  if [[ -z "$installed_version" ]]; then
    fail "Install finished but '${PROGRAM_NAME} --version' failed."
  fi
  log "Installed ${PROGRAM_NAME} ${installed_version}"
  printf '\n%s\n' "Quick start:"
  printf '  %s\n' "${PROGRAM_NAME} --help"
}
main "$@"
