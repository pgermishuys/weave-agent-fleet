#!/usr/bin/env sh
set -eu

STATE_PATH="${WEAVE_UPDATE_STATE_PATH:?WEAVE_UPDATE_STATE_PATH is required}"
CHANNEL="${WEAVE_UPDATE_CHANNEL:-stable}"
LAUNCHER_PATH="${WEAVE_UPDATE_LAUNCHER_PATH:?WEAVE_UPDATE_LAUNCHER_PATH is required}"
PORT="${WEAVE_UPDATE_PORT:-3000}"
HOSTNAME="${WEAVE_UPDATE_HOSTNAME:-0.0.0.0}"
STARTED_AT="${WEAVE_UPDATE_STARTED_AT:-}"

now() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

write_state() {
  state="$1"
  error_msg="${2:-}"
  updated_at="$(now)"
  mkdir -p "$(dirname "$STATE_PATH")"

  python3 - "$STATE_PATH" "$state" "$CHANNEL" "$error_msg" "$STARTED_AT" "$updated_at" <<'PY'
import json
import sys

state_path, state, channel, error_msg, started_at, updated_at = sys.argv[1:7]
payload = {
    "state": state,
    "channel": channel,
    "targetVersion": None,
    "error": error_msg or None,
    "startedAt": started_at or None,
    "updatedAt": updated_at,
    "reconnectHint": "Server may disconnect while update installs.",
}
with open(state_path, "w", encoding="utf-8") as f:
    json.dump(payload, f, indent=2)
PY
}

write_state "installing"

if ! WEAVE_UPDATE_CHANNEL="$CHANNEL" WEAVE_HOSTNAME="$HOSTNAME" "$LAUNCHER_PATH" update; then
  write_state "failed" "Standalone update command failed."
  exit 1
fi

write_state "restarting"
WEAVE_HOSTNAME="$HOSTNAME" "$LAUNCHER_PATH" --port "$PORT" >/dev/null 2>&1 &

write_state "completed"
