#!/usr/bin/env sh
# assemble-standalone.sh
# Assembles the Next.js standalone output into a complete, runnable distribution.
# Must be run after `next build` with `output: 'standalone'` in next.config.ts.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Determine standalone directory — Turbopack may nest under the project name
if [ -f "$PROJECT_ROOT/.next/standalone/server.js" ]; then
  STANDALONE_DIR="$PROJECT_ROOT/.next/standalone"
else
  # Find the nested directory (e.g., .next/standalone/weave-agent-fleet/)
  STANDALONE_DIR=""
  for dir in "$PROJECT_ROOT"/.next/standalone/*/; do
    if [ -f "${dir}server.js" ]; then
      STANDALONE_DIR="${dir%/}"
      break
    fi
  done
fi

if [ -z "$STANDALONE_DIR" ] || [ ! -f "$STANDALONE_DIR/server.js" ]; then
  echo "Error: standalone server.js not found. Did you run 'next build' with output: 'standalone'?" >&2
  exit 1
fi

echo "Standalone directory: $STANDALONE_DIR"

# 1. Copy static assets (required by Next.js standalone mode)
echo "Copying .next/static/ ..."
mkdir -p "$STANDALONE_DIR/.next/static"
cp -r "$PROJECT_ROOT/.next/static/." "$STANDALONE_DIR/.next/static/"

# 2. Copy public assets
if [ -d "$PROJECT_ROOT/public" ]; then
  echo "Copying public/ ..."
  mkdir -p "$STANDALONE_DIR/public"
  cp -r "$PROJECT_ROOT/public/." "$STANDALONE_DIR/public/"
fi

# 3. Verify native addon for better-sqlite3
SQLITE_ADDON="$STANDALONE_DIR/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
if [ ! -f "$SQLITE_ADDON" ]; then
  echo "Warning: better-sqlite3 native addon missing from standalone output. Copying from node_modules..."
  SRC_ADDON="$PROJECT_ROOT/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
  if [ -f "$SRC_ADDON" ]; then
    mkdir -p "$(dirname "$SQLITE_ADDON")"
    cp "$SRC_ADDON" "$SQLITE_ADDON"
    echo "Copied better-sqlite3 native addon."
  else
    echo "Error: better-sqlite3 native addon not found in source node_modules either." >&2
    exit 1
  fi
fi

# 4. Copy CLI script
CLI_JS="$PROJECT_ROOT/cli.js"
if [ -f "$CLI_JS" ]; then
  echo "Copying cli.js ..."
  cp "$CLI_JS" "$STANDALONE_DIR/cli.js"
else
  echo "Warning: cli.js not found. Run 'npm run build:cli' first if you want CLI commands." >&2
fi

# 5. Write VERSION file from package.json
VERSION=$(node -e "console.log(require('./package.json').version)" 2>/dev/null || echo "0.0.0")
echo "$VERSION" > "$STANDALONE_DIR/VERSION"

# 6. Copy standalone update helper templates
mkdir -p "$STANDALONE_DIR/scripts"
cp "$PROJECT_ROOT/scripts/update-helper.sh" "$STANDALONE_DIR/scripts/update-helper.sh"
cp "$PROJECT_ROOT/scripts/update-helper.ps1" "$STANDALONE_DIR/scripts/update-helper.ps1"
chmod +x "$STANDALONE_DIR/scripts/update-helper.sh"

echo "Assembly complete. Standalone directory is ready at: $STANDALONE_DIR"
echo "  Version: $VERSION"
echo "  Test with: node $STANDALONE_DIR/server.js"
