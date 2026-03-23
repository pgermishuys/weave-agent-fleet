#!/usr/bin/env sh
# weave-fleet — launcher script for Weave Agent Fleet
# Installed to ~/.weave/fleet/bin/weave-fleet
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
NODE_BIN="$INSTALL_DIR/bin/node"
SERVER_JS="$INSTALL_DIR/app/server.js"
VERSION_FILE="$INSTALL_DIR/VERSION"

# Ensure bundled Node.js binary exists
if [ ! -x "$NODE_BIN" ]; then
  echo "Error: bundled Node.js binary not found at $NODE_BIN" >&2
  echo "Your installation may be corrupt. Re-install with:" >&2
  echo "  curl -fsSL https://get.tryweave.io/agent-fleet.sh | sh" >&2
  exit 1
fi

CLI_JS="$INSTALL_DIR/app/cli.js"

# Pre-parse --port flag before subcommand dispatch.
# Strips --port <number> from the argument list and exports PORT.
# This only affects the server-start path; subcommand args are preserved.
# Remaining args are saved to numbered _WEAVE_ARGn variables (POSIX-safe)
# and rebuilt into positional parameters after the loop.
_weave_collect_args() {
  # Called with the full arg list; sets _WEAVE_ARGC and _WEAVE_ARGn globals.
  _WEAVE_ARGC=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --port)
        if [ -z "${2:-}" ] || [ "${2#-}" != "$2" ]; then
          echo "Error: --port requires a port number." >&2
          echo "Usage: weave-fleet [--port <number>]" >&2
          exit 1
        fi
        case "$2" in
          *[!0-9]*)
            echo "Error: --port value must be a number, got '$2'." >&2
            exit 1
            ;;
        esac
        export PORT="$2"
        shift 2
        ;;
      *)
        _WEAVE_ARGC=$((_WEAVE_ARGC + 1))
        # Safe: \$1 is escaped so eval sees "_WEAVE_ARGn=$1" — a plain
        # assignment where $1 is expanded as a value, not parsed as code.
        eval "_WEAVE_ARG${_WEAVE_ARGC}=\$1"
        shift
        ;;
    esac
  done
}
_weave_collect_args "$@"
# Rebuild positional parameters from saved args
set --
_i=1
while [ "$_i" -le "$_WEAVE_ARGC" ]; do
  eval "set -- \"\$@\" \"\$_WEAVE_ARG${_i}\""
  _i=$((_i + 1))
done
_j=1
while [ "$_j" -le "$_WEAVE_ARGC" ]; do
  eval "unset _WEAVE_ARG${_j}"
  _j=$((_j + 1))
done
unset _i _j _WEAVE_ARGC

# Parse subcommands
case "${1:-}" in
  version|--version|-v)
    if [ -f "$VERSION_FILE" ]; then
      cat "$VERSION_FILE"
    else
      echo "unknown"
    fi
    exit 0
    ;;
  update)
    echo "Updating Weave Fleet..."
    export WEAVE_UPDATE_CHANNEL="${WEAVE_UPDATE_CHANNEL:-stable}"
    if command -v curl >/dev/null 2>&1; then
      exec sh -c "curl -fsSL https://get.tryweave.io/agent-fleet.sh | sh"
    elif command -v wget >/dev/null 2>&1; then
      exec sh -c "wget -qO- https://get.tryweave.io/agent-fleet.sh | sh"
    else
      echo "Error: curl or wget is required to update." >&2
      exit 1
    fi
    ;;
  uninstall)
    echo "Removing Weave Fleet from $INSTALL_DIR..."
    rm -rf "$INSTALL_DIR"
    echo "Done. You may need to remove the PATH entry from your shell config manually:"
    echo "  Remove: export PATH=\"\$HOME/.weave/fleet/bin:\$PATH\""
    exit 0
    ;;
  init|skill)
    # Delegate CLI commands to the standalone cli.js script (no server required)
    if [ ! -f "$CLI_JS" ]; then
      echo "Error: cli.js not found at $CLI_JS" >&2
      echo "Your installation may be corrupt. Re-install with:" >&2
      echo "  curl -fsSL https://get.tryweave.io/agent-fleet.sh | sh" >&2
      exit 1
    fi
    exec "$NODE_BIN" "$CLI_JS" "$@"
    ;;
  help|--help|-h)
    VERSION="unknown"
    [ -f "$VERSION_FILE" ] && VERSION="$(cat "$VERSION_FILE")"
    echo "Weave Fleet v${VERSION}"
    echo ""
    echo "Usage: weave-fleet [command] [--port <number>]"
    echo ""
    echo "Commands:"
    echo "  (none)       Start the Weave Fleet server"
    echo "  init <dir>   Initialize a project with skill configuration"
    echo "  skill        Manage skills (list, install, remove)"
    echo "  version      Print the installed version"
    echo "  update       Update to the latest version"
    echo "  uninstall    Remove Weave Fleet"
    echo "  help         Show this help message"
    echo ""
    echo "Options:"
    echo "  --port <number>  Server port (overrides PORT env var, default: 3000)"
    echo ""
    echo "Environment variables:"
    echo "  PORT             Server port (default: 3000)"
    echo "  WEAVE_HOSTNAME   Server bind address (default: 0.0.0.0)"
    echo "  WEAVE_UPDATE_CHANNEL Update channel for 'update' (stable|dev)"
    echo "  WEAVE_DB_PATH    Database file path (default: ~/.weave/fleet.db)"
    echo "  OPENCODE_BIN     Full path to opencode binary (if not on PATH)"
    exit 0
    ;;
esac

# Ensure server.js exists (only needed for the start_server path)
if [ ! -f "$SERVER_JS" ]; then
  echo "Error: server.js not found at $SERVER_JS" >&2
  echo "Your installation may be corrupt. Re-install with:" >&2
  echo "  curl -fsSL https://get.tryweave.io/agent-fleet.sh | sh" >&2
  exit 1
fi

# Check that opencode CLI is available
# OPENCODE_BIN allows specifying the full path to the opencode binary.
if [ -n "$OPENCODE_BIN" ]; then
  if [ -x "$OPENCODE_BIN" ]; then
    # Prepend the binary's directory to PATH so spawn('opencode') finds it
    OPENCODE_DIR="$(dirname "$OPENCODE_BIN")"
    export PATH="$OPENCODE_DIR:$PATH"
  else
    echo "Warning: OPENCODE_BIN set to \"$OPENCODE_BIN\" but file does not exist or is not executable." >&2
    echo "Falling back to PATH lookup..." >&2
  fi
fi
if ! command -v opencode >/dev/null 2>&1; then
  echo "Error: 'opencode' CLI not found on PATH." >&2
  echo "" >&2
  echo "Weave Fleet requires OpenCode to manage AI agent sessions." >&2
  echo "Install it with:" >&2
  echo "  curl -fsSL https://opencode.ai/install | bash" >&2
  echo "" >&2
  echo "If opencode is installed but not found, set OPENCODE_BIN to the full path:" >&2
  echo "  export OPENCODE_BIN=/path/to/opencode" >&2
  exit 1
fi

# Set environment for production
export NODE_ENV=production
export PORT="${PORT:-3000}"
export HOSTNAME="${WEAVE_HOSTNAME:-0.0.0.0}"

# Standalone self-update runtime contract (launcher -> server).
export WEAVE_INSTALL_FLAVOR="standalone"
export WEAVE_STANDALONE_CAN_SELF_UPDATE="1"
export WEAVE_STANDALONE_INSTALL_DIR="$INSTALL_DIR"
export WEAVE_STANDALONE_LAUNCHER_PATH="$SCRIPT_DIR/weave-fleet"
export WEAVE_STANDALONE_PORT="$PORT"
export WEAVE_STANDALONE_HOSTNAME="$HOSTNAME"
export WEAVE_STANDALONE_PLATFORM="posix"

# Ensure data directory exists
mkdir -p "${HOME}/.weave"

VERSION="unknown"
[ -f "$VERSION_FILE" ] && VERSION="$(cat "$VERSION_FILE")"

echo "Weave Fleet v${VERSION} starting on http://localhost:${PORT}"

# Forward signals to the Node.js process
trap 'kill $NODE_PID 2>/dev/null; wait $NODE_PID 2>/dev/null; exit' INT TERM HUP

# Start the server
"$NODE_BIN" "$SERVER_JS" &
NODE_PID=$!
wait $NODE_PID
