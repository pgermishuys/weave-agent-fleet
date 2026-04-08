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

# Pre-parse --port and --profile flags before subcommand dispatch.
# Strips them from the argument list and exports PORT / WEAVE_PROFILE.
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
      --profile)
        if [ -z "${2:-}" ] || [ "${2#-}" != "$2" ]; then
          echo "Error: --profile requires a profile name." >&2
          echo "Usage: weave-fleet [--profile <name>]" >&2
          exit 1
        fi
        # Validate: lowercase alphanumeric + hyphens, 1-32 chars, must start/end with alphanumeric
        case "$2" in
          *[!a-z0-9-]*)
            echo "Error: --profile name must contain only lowercase alphanumeric characters and hyphens, got '$2'." >&2
            exit 1
            ;;
          -*)
            echo "Error: --profile name must start with an alphanumeric character, got '$2'." >&2
            exit 1
            ;;
          *-)
            echo "Error: --profile name must end with an alphanumeric character, got '$2'." >&2
            exit 1
            ;;
        esac
        if [ "${#2}" -gt 32 ]; then
          echo "Error: --profile name must be 32 characters or fewer." >&2
          exit 1
        fi
        export WEAVE_PROFILE="$2"
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
    echo "Usage: weave-fleet [command] [--port <number>] [--profile <name>]"
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
    echo "  --port <number>    Server port (overrides PORT env var, default: 3000)"
    echo "  --profile <name>   Named profile for data isolation (default: 'default')"
    echo "                     Profile name: lowercase alphanumeric + hyphens, max 32 chars"
    echo "                     e.g. --profile dev, --profile staging"
    echo ""
    echo "Environment variables:"
    echo "  PORT                  Server port (default: 3000)"
    echo "  WEAVE_PROFILE         Profile name (default: unset = 'default')"
    echo "  WEAVE_HOSTNAME        Server bind address (default: 0.0.0.0)"
    echo "  WEAVE_AUTH_TOKEN      Auth token for remote access (default: auto-generated)"
    echo "                        Set this to keep the same token across server restarts."
    echo "                        Required when WEAVE_HOSTNAME is not localhost/127.0.0.1."
    echo "  WEAVE_DB_PATH         Database file path (default: ~/.weave/fleet.db)"
    echo "  WEAVE_WORKSPACE_ROOT  Workspace root dir (default: ~/.weave/workspaces)"
    echo "  WEAVE_PORT_RANGE_START Override OpenCode port range base (escape hatch)"
    echo "  OPENCODE_BIN          Full path to opencode binary (if not on PATH)"
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

# Ensure base data directory exists
mkdir -p "${HOME}/.weave"

# If a named profile is active, create its directory and wire derived env vars
if [ -n "${WEAVE_PROFILE:-}" ] && [ "$WEAVE_PROFILE" != "default" ]; then
  WEAVE_PROFILE_DIR="${HOME}/.weave/profiles/${WEAVE_PROFILE}"
  mkdir -p "$WEAVE_PROFILE_DIR"
  # Set derived vars only if not already explicitly set
  if [ -z "${WEAVE_DB_PATH:-}" ]; then
    export WEAVE_DB_PATH="${WEAVE_PROFILE_DIR}/fleet.db"
  fi
  if [ -z "${WEAVE_WORKSPACE_ROOT:-}" ]; then
    export WEAVE_WORKSPACE_ROOT="${WEAVE_PROFILE_DIR}/workspaces"
  fi
fi

VERSION="unknown"
[ -f "$VERSION_FILE" ] && VERSION="$(cat "$VERSION_FILE")"

# ── Authentication setup ────────────────────────────────────────────────────
# When the server is bound to a non-localhost address, auth is required.
# Generate a token (or use the user-supplied one) and print the login URL.
# The token is exported as WEAVE_AUTH_TOKEN so the Node.js process picks it up.
_is_localhost_binding() {
  case "$HOSTNAME" in
    "127.0.0.1"|"localhost"|"::1") return 0 ;;
    *) return 1 ;;
  esac
}

if ! _is_localhost_binding; then
  if [ -z "${WEAVE_AUTH_TOKEN:-}" ]; then
    # Generate a 128-bit random token (32 hex chars) using openssl or od as fallback
    if command -v openssl >/dev/null 2>&1; then
      WEAVE_AUTH_TOKEN="$(openssl rand -hex 16)"
    else
      WEAVE_AUTH_TOKEN="$(od -vAn -N16 -tx1 /dev/urandom | tr -d ' \n')"
    fi
    export WEAVE_AUTH_TOKEN
  fi
  # Determine display hostname for the URL (0.0.0.0 → localhost for clickability)
  _LOGIN_HOST="$HOSTNAME"
  [ "$HOSTNAME" = "0.0.0.0" ] && _LOGIN_HOST="localhost"
  _LOGIN_URL="http://${_LOGIN_HOST}:${PORT}/login?token=${WEAVE_AUTH_TOKEN}"
fi

# Build startup message — include profile name if non-default
if [ -n "${WEAVE_PROFILE:-}" ] && [ "$WEAVE_PROFILE" != "default" ]; then
  echo "Weave Fleet v${VERSION} [profile: ${WEAVE_PROFILE}] starting on http://localhost:${PORT}"
else
  echo "Weave Fleet v${VERSION} starting on http://localhost:${PORT}"
fi

# Print login URL when auth is required
if ! _is_localhost_binding; then
  echo ""
  echo "  Access Weave Fleet at ${_LOGIN_URL}"
  echo ""
fi

# Forward signals to the Node.js process
trap 'kill $NODE_PID 2>/dev/null; wait $NODE_PID 2>/dev/null; exit' INT TERM HUP

# Start the server
"$NODE_BIN" "$SERVER_JS" &
NODE_PID=$!
wait $NODE_PID
