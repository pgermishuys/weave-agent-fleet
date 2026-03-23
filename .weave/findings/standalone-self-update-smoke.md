# Standalone Self-Update Smoke Findings

Date: 2026-03-22

## Scope

- Browser-triggered standalone self-update scheduling (`POST /api/update`)
- Durable state retrieval (`GET /api/update`)
- Version metadata gating (`GET /api/version` with `installFlavor` and `canSelfUpdate`)
- SSE handoff event wiring (`standalone_update` on `/api/activity-stream`)
- Detached helper templates staged outside install directory

## POSIX Verification (macOS/Linux)

- Completed: API and updater unit tests pass for scheduling, duplicate rejection, and durable state file behavior.
- Completed: shell scripts parse cleanly (`install.sh`, `launcher.sh`, `update-helper.sh`).
- Completed: TypeScript build checks pass after integration changes.
- Not executed in this session: full end-to-end destructive reinstall/restart against a packaged standalone artifact.

## Windows Verification

- Completed: helper template and installer/launcher code paths are implemented and wired for channel-aware execution.
- Not executed in this session: end-to-end PowerShell helper run and relaunch on a Windows standalone package.

## Operator Recovery Steps

If update gets stuck:

1. Check update state endpoint: `GET /api/update`.
2. If state is stale (`scheduled`/`stopping`/`installing`/`restarting` for too long), remove state file:
   - macOS/Linux: `~/.weave/standalone-update.json`
   - Windows: `%LOCALAPPDATA%\weave\standalone-update.json`
3. Restart `weave-fleet` manually.
4. Re-run update from CLI to recover installer path:
   - `WEAVE_UPDATE_CHANNEL=stable weave-fleet update`
   - `WEAVE_UPDATE_CHANNEL=dev weave-fleet update`

If helper template is missing:

1. Reinstall the standalone build (`weave-fleet update` or fresh installer run).
2. Confirm helper templates exist under `app/scripts/` in the install tree:
   - `update-helper.sh`
   - `update-helper.ps1`
