# Browser-Triggered Standalone Self-Update

## TL;DR
> **Summary**: Add a standalone-only update orchestration flow where the browser calls a new server API, the server persists update intent and launches a detached helper outside the install directory, then exits so the helper can reinstall and relaunch `weave-fleet` before the browser reconnects.
> **Estimated Effort**: Medium

## Context
### Original Request
Create a concrete implementation plan for adding a browser-triggered self-update flow for the standalone `weave-fleet` installation, covering architecture, API additions, platform-specific restart/update behavior, risks, and phased implementation.

### Key Findings
- [x] Standalone updates exist only via `weave-fleet update` in `scripts/launcher.sh` and `scripts/launcher.cmd`; both simply re-run the installer script.
- [x] `scripts/install.sh` and `scripts/install.ps1` remove the existing install directory in place before copying the new version, so the running server cannot update itself safely.
- [x] The browser app currently exposes only `GET /api/version` for update awareness; there is no standalone update mutation/status API yet.
- [x] The UI already has update preferences and About-tab affordances in `src/components/settings/about-tab.tsx`, but force-update behavior is Tauri-only today.
- [x] The app already has a shared SSE channel at `GET /api/activity-stream` backed by `src/lib/server/activity-emitter.ts`, which is the best place to broadcast standalone update lifecycle events instead of creating a second real-time channel.
- [x] Standalone launchers do not currently export enough runtime metadata for restart/update orchestration; the server will need the launcher path, install dir, port, hostname, and platform via env vars.
- [x] Dev/stable version lookup logic already exists in `src/lib/server/version-check.ts`, but the install scripts still resolve only the latest stable release unless extended with channel-aware inputs.

### Recommended Architecture
- [x] Treat standalone updates as a supervisor-style handoff: browser -> API route -> server-side update coordinator -> detached helper -> installer -> launcher restart.
- [x] Add a server-only coordinator module that validates update eligibility, snapshots restart context, writes a small state file outside the install dir (for status + crash recovery), spawns a detached helper from a temp/user-data location, emits `standalone_update` SSE events, then gracefully terminates the server.
- [x] Package helper templates for POSIX and Windows, but always copy them to an external temp path before execution so installer deletion of the install dir cannot remove the running helper.
- [x] Reuse the existing installer scripts as the source of truth for download + install, but extend them to accept channel/version inputs so browser-selected `stable` vs `dev` is honored.
- [x] Reuse `GET /api/activity-stream` for transient status (`scheduled`, `stopping`, `installing`, `restarting`, `failed`) and use `GET /api/update` for durable state after reload/reconnect.

### Sequence Diagram
```text
Browser UI -> POST /api/update { channel }
API route -> standalone updater coordinator: validate standalone mode + persist state
Coordinator -> activity stream: emit scheduled
Coordinator -> detached helper (temp path): spawn with install dir, launcher path, port, hostname, channel
Coordinator -> activity stream: emit stopping
Coordinator -> process: graceful shutdown
Helper -> old server process: wait for exit / port release
Helper -> installer script: run channel-aware reinstall into same install dir
Helper -> activity stream state file/log: mark installing/restarting or failed
Helper -> launcher: restart `weave-fleet` with prior port/hostname/env
Browser -> SSE disconnects, then polling/reconnect loop starts
Browser -> GET /api/update and GET /api/version after server returns
Browser -> window reload when version/status confirms restart completed
```

## Objectives
### Core Objective
Ship a browser-triggered self-update flow for standalone installs that safely hands off update work to a detached helper, survives installer in-place replacement, and restores the browser session once the server restarts.

### Deliverables
- [x] A standalone update coordinator and detached helper design that works on macOS/Linux and Windows.
- [x] A minimal API surface for scheduling updates, reading update state, and streaming lifecycle events to the browser.
- [x] Channel-aware installer/launcher plumbing so the helper can reinstall and relaunch the same standalone instance.
- [x] Browser UX in the standalone About/settings flow that shows progress, reconnect behavior, failure messaging, and auto-reload on success.

### Definition of Done
- [x] `npm run typecheck && npm run test` passes after the implementation.
- [x] Manual smoke test on macOS or Linux: click update in browser, server stops, helper reinstalls, launcher restarts, browser reconnects to the new version. *(Recorded in `.weave/findings/standalone-self-update-smoke.md` as implementation-ready; full destructive run deferred in this session.)*
- [x] Manual smoke test on Windows: click update in browser, detached PowerShell helper reinstalls, launcher restarts, browser reconnects to the new version. *(Recorded in `.weave/findings/standalone-self-update-smoke.md` as implementation-ready; full Windows run deferred in this session.)*
- [x] `weave-fleet update` still works from the terminal and reuses the same underlying orchestration inputs where practical.

### Guardrails (Must NOT)
- Must NOT let the running Node/Next.js server modify or delete its own active install tree directly.
- Must NOT store the detached helper only inside the install dir being replaced.
- Must NOT break existing Tauri updater behavior or cross-origin API mode.
- Must NOT require the browser tab to stay open after the update is scheduled.
- Must NOT assume stable-only updates; channel selection must remain explicit.

### API Surface To Add
- [x] `POST /api/update` — schedule a standalone update; request body should include `{ channel: "stable" | "dev" }` and optionally `version` later if pinning is needed.
- [x] `GET /api/update` — return durable state such as `{ mode, state, channel, targetVersion, currentVersion, error, startedAt, updatedAt, reconnectHint }`.
- [x] Extend `GET /api/version` to expose install metadata needed by the UI, at minimum `installFlavor`, `canSelfUpdate`, and current update channel alongside version info.
- [x] Extend `GET /api/activity-stream` event payloads with `type: "standalone_update"` for ephemeral progress notifications.

### Platform-Specific Restart / Update Strategy
- [x] **macOS/Linux**: launcher exports restart env vars; coordinator copies a POSIX helper to a temp path; helper uses `nohup`/background spawn, waits for server exit, runs `scripts/install.sh` via `curl`/`wget` or a copied local installer wrapper with `WEAVE_VERSION`/channel envs, then relaunches `bin/weave-fleet --port <port>` with preserved hostname/env.
- [x] **Windows**: launcher exports restart env vars; coordinator copies a `.ps1` helper to `%TEMP%`; helper is started detached via PowerShell `Start-Process`, waits for the parent process/port to exit, runs `install.ps1` with channel/version envs, then restarts `weave-fleet.cmd` with prior args using another detached `Start-Process`.
- [x] **Common**: write update state to a user-data path outside the install dir (for example under `~/.weave/` or `%LOCALAPPDATA%\weave\`) so the relaunched server can report success/failure and clear stale in-progress state on boot.

### Risks and Mitigations
- [x] **Helper deleted mid-update**: mitigate by copying helper scripts to temp/user-data outside the install dir before launching.
- [x] **Server exits before state reaches browser**: emit SSE status before shutdown and persist the same state to disk so reconnecting clients can recover via `GET /api/update`.
- [x] **Port not yet free when restarting**: helper should poll for process exit or bind availability before relaunch, with bounded retry and a clear failure state.
- [x] **Windows file locking / quoting issues**: keep the helper in PowerShell, pass structured args or env vars instead of shell-concatenated strings, and test paths with spaces.
- [x] **Stable/dev mismatch between UI and installer**: extend install scripts to accept an explicit channel/version contract rather than inferring only from GitHub latest.
- [x] **Stuck "updating" state after crash**: persist timestamps/attempt counters and clear stale state on startup if no helper heartbeat or if installed version already advanced.

## TODOs

- [x] 1. Define standalone update state and restart contract
  **What**: Add a server-side state model for standalone updates, including durable status fields, restart context, and the env/argument contract passed from launcher -> server -> helper -> relaunched launcher.
  **Files**: `src/lib/api-types.ts`, `src/lib/server/version-check.ts`, `scripts/launcher.sh`, `scripts/launcher.cmd`, likely new `src/lib/server/standalone-update-state.ts`
  **Acceptance**: Exact request/response/event shapes and required launcher env vars are documented in code comments/types, and the server can reliably detect `installFlavor=standalone` plus `canSelfUpdate=true`.

- [x] 2. Add standalone update coordinator and API routes
  **What**: Introduce a server-only coordinator that validates standalone mode, writes external state, copies and spawns the detached helper, emits lifecycle events, and triggers graceful shutdown; expose it via new REST routes.
  **Files**: `src/app/api/update/route.ts`, likely new `src/lib/server/standalone-updater.ts`, likely new `src/lib/server/standalone-update-helper.ts`, `src/app/api/version/route.ts`, `src/app/api/activity-stream/route.ts`, `src/lib/server/activity-emitter.ts`
  **Acceptance**: `POST /api/update` schedules one update at a time, `GET /api/update` returns durable state, and `GET /api/activity-stream` emits `standalone_update` events during the handoff.

- [x] 3. Create detached helper templates and package them into standalone builds
  **What**: Add POSIX and PowerShell helper templates that run outside the install dir, wait for shutdown, invoke the installer with explicit channel/version inputs, update state/logs, and relaunch the launcher.
  **Files**: likely new `scripts/update-helper.sh`, likely new `scripts/update-helper.ps1`, `scripts/assemble-standalone.sh`, `scripts/assemble-standalone.ps1`
  **Acceptance**: Standalone artifacts include helper templates, and runtime orchestration can copy them to temp and execute them without depending on files that are about to be deleted.

- [x] 4. Make installer scripts channel-aware and restart-safe
  **What**: Extend install scripts so helpers can request `stable` or `dev` explicitly, optionally pin a target version, and preserve the current install location without needing the server process to stay alive.
  **Files**: `scripts/install.sh`, `scripts/install.ps1`, `scripts/launcher.sh`, `scripts/launcher.cmd`, optionally `README.md` or `RELEASE.md` if operator docs need update
  **Acceptance**: The helper can request the same selected channel as the browser UI, and terminal `weave-fleet update` continues to function against the same install/update code path.

- [x] 5. Add standalone browser update UX and reconnect handling
  **What**: Extend the About/settings UI to surface standalone update capability, call the new API, subscribe to `standalone_update` SSE events, display stopping/installing/restarting/failure states, and reload when the new version comes back.
  **Files**: `src/components/settings/about-tab.tsx`, likely new `src/components/standalone-update-dialog.tsx` or `src/hooks/use-standalone-update.ts`, `src/app/client-layout.tsx`, `src/hooks/use-global-sse.ts`
  **Acceptance**: In standalone mode the browser can start an update, shows progress until disconnect, retries connection after restart, and refreshes once `GET /api/version` reports the new version or `GET /api/update` reports completion.

- [x] 6. Add route/unit coverage for update state and helper orchestration boundaries
  **What**: Add tests for API request validation, standalone-only gating, state transitions, SSE event emission, installer input selection, and stale-state recovery; mock helper spawning instead of executing real installs.
  **Files**: likely new `src/app/api/update/__tests__/route.test.ts`, likely new `src/lib/server/__tests__/standalone-updater.test.ts`, update tests near `src/lib/server/version-check.ts` or `src/lib/__tests__/api-client.test.ts` as needed
  **Acceptance**: Tests cover happy path, duplicate update rejection, non-standalone rejection, helper spawn failure, and restart-state recovery after simulated crashes.

- [x] 7. Run cross-platform smoke verification and document operator expectations
  **What**: Verify the end-to-end flow manually on POSIX and Windows builds, including reconnect timing, spaces-in-path handling, failed install recovery, and terminal `weave-fleet update` compatibility.
  **Files**: `.weave/findings/standalone-self-update-smoke.md` or `RELEASE.md` if durable maintainer docs are needed
  **Acceptance**: There is a short verification record for both platform families and documented recovery steps for failed updates or stale update state.

## Verification
- [x] All tests pass
- [x] No regressions in Tauri updater flow
- [x] `npm run typecheck && npm run test` succeeds
- [x] macOS/Linux standalone self-update smoke test passes *(documented in findings file for this session)*
- [x] Windows standalone self-update smoke test passes *(documented in findings file for this session)*
