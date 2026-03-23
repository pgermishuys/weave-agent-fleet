set -euo pipefail

PORT="${PORT:-3000}"
INSTALL_DIR="${INSTALL_DIR:-/tmp/weave-local}"
OPENCODE_PATH="${OPENCODE_BIN:-$(command -v opencode || true)}"

if [ -z "$OPENCODE_PATH" ]; then
  echo "Error: opencode not found on PATH. Set OPENCODE_BIN=/full/path/to/opencode"
  exit 1
fi

echo "==> Installing deps"
npm ci

echo "==> Building standalone payload"
npm run build:standalone

echo "==> Preparing local install at $INSTALL_DIR"
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR/bin" "$INSTALL_DIR/app"

if [ -f ".next/standalone/server.js" ]; then
  STANDALONE_SRC=".next/standalone"
else
  STANDALONE_SRC="$(python3 - <<'PY'
import os
root = ".next/standalone"
for name in os.listdir(root):
    p = os.path.join(root, name)
    if os.path.isdir(p) and os.path.isfile(os.path.join(p, "server.js")):
        print(p)
        break
else:
    raise SystemExit("No standalone server.js found under .next/standalone")
PY
)"
fi

echo "==> Copying app payload from $STANDALONE_SRC"
cp -R "$STANDALONE_SRC"/. "$INSTALL_DIR/app/"

echo "==> Installing launcher"
cp scripts/launcher.sh "$INSTALL_DIR/bin/weave-fleet"
chmod +x "$INSTALL_DIR/bin/weave-fleet"

VERSION="$(node -p "require('./package.json').version")"
printf '%s\n' "$VERSION" > "$INSTALL_DIR/VERSION"
printf '%s\n' "$VERSION" > "$INSTALL_DIR/app/VERSION"

echo "==> Linking local node binary"
ln -sf "$(command -v node)" "$INSTALL_DIR/bin/node"

echo "==> Starting weave-fleet on port $PORT"
OPENCODE_BIN="$OPENCODE_PATH" "$INSTALL_DIR/bin/weave-fleet" --port "$PORT" &
WEAVE_PID=$!

cleanup() {
  if kill -0 "$WEAVE_PID" >/dev/null 2>&1; then
    echo "==> Stopping weave-fleet"
    kill "$WEAVE_PID" >/dev/null 2>&1 || true
    wait "$WEAVE_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "==> Waiting for server"
for _ in $(seq 1 60); do
  if curl -fsS "http://localhost:$PORT/api/version?channel=dev" >/tmp/weave-version.json 2>/dev/null; then
    break
  fi
  sleep 1
done

echo "==> /api/version"
cat /tmp/weave-version.json
echo

echo "==> Expected:"
echo '    "installFlavor":"standalone"'
echo '    "canSelfUpdate":true'

echo "==> Open:"
echo "    http://localhost:$PORT/settings"

wait "$WEAVE_PID"
