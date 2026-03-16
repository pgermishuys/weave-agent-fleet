#!/usr/bin/env sh
# install.sh — Weave Agent Fleet installer
# Usage: curl -fsSL https://get.tryweave.io/agent-fleet.sh | sh
#
# Environment variables:
#   WEAVE_VERSION      — Install a specific version (e.g., "0.1.0"). Default: latest.
#   WEAVE_INSTALL_DIR  — Installation directory. Default: ~/.weave/fleet
set -e

REPO="pgermishuys/weave-agent-fleet"
INSTALL_DIR="${WEAVE_INSTALL_DIR:-$HOME/.weave/fleet}"

# --- Helpers ---

info() {
  printf '\033[1;34m%s\033[0m\n' "$1"
}

success() {
  printf '\033[1;32m%s\033[0m\n' "$1"
}

error() {
  printf '\033[1;31mError: %s\033[0m\n' "$1" >&2
  exit 1
}

warn() {
  printf '\033[1;33m%s\033[0m\n' "$1"
}

# --- Detect platform ---

detect_platform() {
  OS="$(uname -s)"
  ARCH="$(uname -m)"

  case "$OS" in
    Darwin) PLATFORM="darwin" ;;
    Linux)  PLATFORM="linux" ;;
    MINGW*|MSYS*|CYGWIN*)
      echo ""
      warn "It looks like you're on Windows. Use the PowerShell installer instead:"
      echo ""
      echo "  irm https://github.com/${REPO}/releases/latest/download/install.ps1 | iex"
      echo ""
      exit 1
      ;;
    *)      error "Unsupported operating system: $OS. Only macOS and Linux are supported." ;;
  esac

  case "$ARCH" in
    x86_64|amd64)  ARCH="x64" ;;
    arm64|aarch64) ARCH="arm64" ;;
    *)             error "Unsupported architecture: $ARCH. Only x64 and arm64 are supported." ;;
  esac

  TARGET="${PLATFORM}-${ARCH}"
}

# --- Detect download tool ---

detect_downloader() {
  if command -v curl >/dev/null 2>&1; then
    DOWNLOADER="curl"
  elif command -v wget >/dev/null 2>&1; then
    DOWNLOADER="wget"
  else
    error "Either 'curl' or 'wget' is required to download files."
  fi
}

download() {
  url="$1"
  output="$2"

  if [ "$DOWNLOADER" = "curl" ]; then
    curl -fsSL "$url" -o "$output"
  else
    wget -qO "$output" "$url"
  fi
}

download_to_stdout() {
  url="$1"

  if [ "$DOWNLOADER" = "curl" ]; then
    curl -fsSL "$url"
  else
    wget -qO- "$url"
  fi
}

# --- Detect version ---

detect_version() {
  if [ -n "${WEAVE_VERSION:-}" ]; then
    VERSION="$WEAVE_VERSION"
    info "Using specified version: v${VERSION}"
    return
  fi

  info "Fetching latest version..."
  # Use GitHub API to get latest release tag
  RELEASE_JSON="$(download_to_stdout "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null)" || \
    error "Failed to fetch latest release from GitHub. Check your internet connection."

  # Extract tag_name (e.g., "v0.1.0") — portable JSON parsing without jq
  VERSION="$(printf '%s' "$RELEASE_JSON" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"v\{0,1\}\([^"]*\)".*/\1/p' | head -1)"

  if [ -z "$VERSION" ]; then
    error "Could not determine latest version from GitHub API."
  fi

  info "Latest version: v${VERSION}"
}

# --- Verify checksum ---

verify_checksum() {
  tarball_path="$1"
  expected_checksum="$2"

  if command -v shasum >/dev/null 2>&1; then
    actual_checksum="$(shasum -a 256 "$tarball_path" | cut -d' ' -f1)"
  elif command -v sha256sum >/dev/null 2>&1; then
    actual_checksum="$(sha256sum "$tarball_path" | cut -d' ' -f1)"
  else
    warn "Warning: Neither shasum nor sha256sum found. Skipping checksum verification."
    return 0
  fi

  if [ "$actual_checksum" != "$expected_checksum" ]; then
    error "Checksum verification failed!\n  Expected: ${expected_checksum}\n  Actual:   ${actual_checksum}\nThe download may be corrupted. Please try again."
  fi
}

# --- Add to PATH ---

add_to_path() {
  BIN_DIR="$INSTALL_DIR/bin"
  PATH_LINE="export PATH=\"\$HOME/.weave/fleet/bin:\$PATH\""

  # Check if already in PATH
  case ":$PATH:" in
    *":$BIN_DIR:"*) return 0 ;;
  esac

  SHELL_NAME="$(basename "${SHELL:-sh}")"
  RC_FILE=""

  case "$SHELL_NAME" in
    zsh)
      RC_FILE="$HOME/.zshrc"
      ;;
    bash)
      if [ -f "$HOME/.bashrc" ]; then
        RC_FILE="$HOME/.bashrc"
      elif [ -f "$HOME/.bash_profile" ]; then
        RC_FILE="$HOME/.bash_profile"
      else
        RC_FILE="$HOME/.bashrc"
      fi
      ;;
    fish)
      # Fish uses a different syntax
      FISH_CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/fish"
      mkdir -p "$FISH_CONFIG_DIR/conf.d"
      RC_FILE="$FISH_CONFIG_DIR/conf.d/weave-fleet.fish"
      PATH_LINE="fish_add_path $BIN_DIR"
      ;;
    *)
      RC_FILE="$HOME/.profile"
      ;;
  esac

  # Only add if not already present
  if [ -f "$RC_FILE" ] && grep -qF "weave/fleet/bin" "$RC_FILE" 2>/dev/null; then
    return 0
  fi

  echo "" >> "$RC_FILE"
  echo "# Weave Agent Fleet" >> "$RC_FILE"
  echo "$PATH_LINE" >> "$RC_FILE"

  info "Added to PATH in ${RC_FILE}"
}

# --- Main ---

main() {
  echo ""
  info "Weave Agent Fleet Installer"
  echo ""

  detect_platform
  detect_downloader
  detect_version

  TARBALL_NAME="weave-fleet-v${VERSION}-${TARGET}.tar.gz"
  DOWNLOAD_URL="https://github.com/${REPO}/releases/download/v${VERSION}/${TARBALL_NAME}"
  CHECKSUMS_URL="https://github.com/${REPO}/releases/download/v${VERSION}/checksums.txt"

  # Create temp directory
  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TMP_DIR"' EXIT

  # Download tarball
  info "Downloading ${TARBALL_NAME}..."
  download "$DOWNLOAD_URL" "$TMP_DIR/$TARBALL_NAME" || \
    error "Failed to download ${TARBALL_NAME}. Check that a release exists for your platform (${TARGET})."

  # Download and verify checksum
  info "Verifying checksum..."
  if download "$CHECKSUMS_URL" "$TMP_DIR/checksums.txt" 2>/dev/null; then
    EXPECTED_CHECKSUM="$(grep "$TARBALL_NAME" "$TMP_DIR/checksums.txt" | cut -d' ' -f1)"
    if [ -n "$EXPECTED_CHECKSUM" ]; then
      verify_checksum "$TMP_DIR/$TARBALL_NAME" "$EXPECTED_CHECKSUM"
      success "Checksum verified."
    else
      warn "Warning: Checksum for ${TARBALL_NAME} not found in checksums.txt. Skipping verification."
    fi
  else
    warn "Warning: Could not download checksums.txt. Skipping verification."
  fi

  # Remove existing installation
  if [ -d "$INSTALL_DIR" ]; then
    info "Removing existing installation at ${INSTALL_DIR}..."
    rm -rf "$INSTALL_DIR"
  fi

  # Extract tarball
  info "Installing to ${INSTALL_DIR}..."
  mkdir -p "$INSTALL_DIR"
  tar xzf "$TMP_DIR/$TARBALL_NAME" -C "$TMP_DIR"

  # The tarball extracts to a named directory — move contents to install dir
  EXTRACTED_DIR="$TMP_DIR/weave-fleet-v${VERSION}-${TARGET}"
  if [ -d "$EXTRACTED_DIR" ]; then
    cp -r "$EXTRACTED_DIR/." "$INSTALL_DIR/"
  else
    # Fallback: extract directly
    tar xzf "$TMP_DIR/$TARBALL_NAME" -C "$INSTALL_DIR" --strip-components=1
  fi

  # Ensure executables have correct permissions
  chmod +x "$INSTALL_DIR/bin/weave-fleet"
  chmod +x "$INSTALL_DIR/bin/node"

  # Add to PATH
  add_to_path

  echo ""
  success "Weave Fleet v${VERSION} installed successfully!"
  echo ""
  echo "  Install location: ${INSTALL_DIR}"
  echo "  Binary:           ${INSTALL_DIR}/bin/weave-fleet"
  echo ""

  # Check if opencode is available
  if ! command -v opencode >/dev/null 2>&1; then
    warn "Note: OpenCode CLI is required but not found on PATH."
    echo "  Install it with: curl -fsSL https://opencode.ai/install | bash"
    echo ""
  fi

  echo "To get started:"
  echo ""
  echo "  1. Open a new terminal (or run: source ~/.zshrc)"
  echo "  2. Run: weave-fleet"
  echo "  3. Open http://localhost:3000 in your browser"
  echo ""
}

main "$@"
