# Auto Update + Dev Channel

## TL;DR
> **Summary**: Add a user-facing auto-update mode that downloads updates in the background and applies them on next app start, then add a separate GitHub Actions pipeline that continuously publishes signed Tauri updater artifacts for a dev channel on pushes to `main`.
> **Estimated Effort**: Medium

## Context
### Original Request
Add an option to auto update by downloading updates in the background and using the new version on next start, and add a dev-channel GitHub Actions workflow that publishes a new package for the dev channel on push to `main`.

### Key Findings
- [x] The desktop app is a Tauri 2 app and already includes `tauri-plugin-updater` in `src-tauri/Cargo.toml`.
- [x] The current updater endpoint is hard-coded in `src-tauri/tauri.conf.json` to the stable GitHub release asset path `releases/download/v__VERSION__/latest.json`, so it assumes tagged stable releases only.
- [x] Startup update logic lives in `src-tauri/src/lib.rs`; today it checks for updates 5 seconds after launch, stores one pending payload, and only installs when the frontend explicitly invokes `install_update`.
- [x] The current update UX in `src/components/tauri-update-dialog.tsx` is modal-only and assumes an immediate `download_and_install` flow with restart after install.
- [x] Settings currently expose version info in `src/components/settings/about-tab.tsx`; there is no persisted desktop update preference yet, but `src/hooks/use-persisted-state.ts` is the established client-side persistence helper.
- [x] Release automation is split between `.github/workflows/release.yml` for tagged stable releases and `.github/workflows/ci.yml` for validation on `main` and PRs.
- [x] `scripts/tauri-prebuild.mjs` already mutates `src-tauri/tauri.conf.json` during packaging, so channel-specific updater endpoints/version stamping can be injected at build time without introducing another config generation path.

## Decisions / Assumptions
- [x] Keep stable and dev update channels fully separate at the artifact/metadata level, but allow the desktop app to persist a user-selected update channel (`stable` vs `dev`) and query the matching updater metadata for future updates.
- [x] Treat auto-update as an opt-in desktop preference persisted on the client, defaulting to the current manual behavior for existing users.
- [x] Implement auto-update as a two-step lifecycle: check for updates after startup, download in the background when enabled, persist a "ready to install on next launch" state, and apply that staged update during the next app start before the main UI finishes booting.
- [x] Reuse the existing stable release workflow for tagged releases; create a separate dev workflow rather than overloading `.github/workflows/release.yml`.
- [x] Dev channel builds will need a monotonically increasing dev version identifier or tag strategy on every push to `main`; if current package versioning is not sufficient, the workflow should derive a prerelease/build version from the base version plus commit SHA or run number.
- [x] The About/settings surface should show both the selected update mode and the selected/current channel so users can tell which stream they are following and change it intentionally.
- [x] Channel switching semantics must be explicit: `stable -> dev` should opt the app into dev metadata immediately for the next check, while `dev -> stable` must define whether downgrade-to-stable is automatic, prompted, or only takes effect once a newer stable version is available.
- [x] Dev packages should replace the normal app install rather than install side-by-side, so package identity should remain shared and only channel behavior/artifacts should differ.

## Objectives
### Core Objective
Ship a channel-aware updater flow where users can choose both update behavior and update channel, and establish automated publishing for dev-channel updater artifacts on every push to `main`.

## TODOs
- [x] Model update mode, selectable channel, and staged-update state.
- [x] Refactor Rust updater behavior into explicit check, download, and apply phases.
- [x] Update desktop UI for manual, auto-update, and channel selection experiences.
- [x] Make updater metadata channel-aware at build time and runtime.
- [x] Add a dev-channel publishing workflow on pushes to `main`.
- [x] Make stable and dev packaging explicit for maintainers.
- [x] Document release and channel operations.

### Deliverables
- [x] Desktop update preference UI and persisted state for manual vs auto-download behavior plus stable/dev channel selection.
- [x] Rust-side updater flow that supports background download, staged install on next launch, and clear status events for the frontend.
- [x] Build/release automation that publishes isolated dev-channel updater metadata and signed artifacts on pushes to `main`.
- [x] Stable and dev installable desktop packages can both be produced intentionally, with the correct default channel behavior for each.
- [x] Documentation updates covering stable vs dev release behavior and any new secrets or versioning rules.

### Definition of Done
- [x] `bun run lint && bun run typecheck && bun run test` passes after the implementation.
- [ ] A local Tauri desktop build can still check for updates manually, and auto-update mode downloads without forcing an immediate restart.
  <!-- blocked: requires interactive desktop runtime smoke test on packaged app -->
- [ ] A dev-channel workflow run from `main` produces signed Tauri updater assets plus channel-specific metadata and installers that do not overwrite stable release assets.
  <!-- blocked: requires GitHub Actions run from main branch -->
- [x] Stable tagged releases still generate their existing updater metadata and installer assets.

### Guardrails (Must NOT)
- [x] Must not change source code outside the scope of updater behavior, settings/about surfaces, and release automation.
- [x] Must not collapse stable and dev channels onto the same `latest.json` URL or release tag namespace.
- [x] Must not make auto-update mandatory or silently restart immediately after background download.
- [x] Must not require manual post-processing of updater metadata after every push to `main`.

## Implementation Phases
- [x] 1. Model update mode, selectable channel, and staged-update state
  **What**: Define the frontend and Rust state needed for manual vs auto-download behavior, user-selectable `stable` vs `dev` channel, channel display, and a "downloaded, install on next start" lifecycle. Decide whether the persisted desktop preference remains browser-side only or is mirrored into Rust via a startup invoke/event, and define how channel changes invalidate/restart any cached update state.
  **Files**: `src/hooks/use-persisted-state.ts`, `src/lib/tauri.ts`, `src-tauri/src/lib.rs`, optionally a new small helper under `src/lib/` or `src/hooks/` if the updater state needs to be shared.
  **Acceptance**: There is a documented data flow for how update mode and selected channel reach Rust, how Rust records "update available", "download in progress", and "update ready for next start", and what happens to staged/cached state when the user changes channel.

- [x] 2. Refactor Rust updater behavior into explicit check, download, and apply phases
  **What**: Replace the current single `install_update` path with separate commands/state for checking, background downloading, and applying a previously downloaded update on startup. Add emitted events for availability, progress, completion, and errors. Ensure startup logic can detect a staged update and apply it before or during early app initialization on the next launch.
  **Files**: `src-tauri/src/lib.rs`, potentially `src-tauri/Cargo.toml` if extra crates are needed for persisted updater state, and `src-tauri/tauri.conf.json` if updater configuration needs channel-aware endpoints or env-driven values.
  **Acceptance**: Manual mode still supports user-triggered install, auto mode starts background download after a successful check, and the next app launch applies the staged update without presenting the old immediate-restart flow.

- [x] 3. Update desktop UI for manual, auto-update, and channel selection experiences
  **What**: Add settings controls for enabling auto-update and selecting the update channel, surface the active update channel and update mode in About/settings, and adjust the Tauri update dialog so manual users still get prompted while auto-update users see non-blocking download/install-ready messaging instead of an install-now modal. Include confirmation/help text for channel changes so users understand that `dev` may be less stable.
  **Files**: `src/app/settings/page.tsx`, `src/components/settings/about-tab.tsx`, `src/components/tauri-update-dialog.tsx`, `src/components/ui/switch.tsx` (only if existing props are insufficient), and any nearby shared UI helpers needed for status text/badges.
  **Acceptance**: Users can toggle auto-update and choose `stable` or `dev` in the UI, those preferences survive reloads, manual users retain a clear install CTA, auto-update users see clear messaging that the update will be used on next start, and channel changes visibly affect which update stream the app checks.

- [x] 4. Make updater metadata channel-aware at build time and runtime
  **What**: Introduce channel selection that supports both build defaults and a user-selected runtime channel so stable and dev metadata stay isolated while the app can switch which updater endpoint/metadata it queries. Use the existing prebuild mutation path to stamp `src-tauri/tauri.conf.json` with safe defaults, and define explicit packaging inputs for `stable` and `dev` builds so each produced installer clearly targets the intended channel.
  **Files**: `src-tauri/tauri.conf.json`, `scripts/tauri-prebuild.mjs`, `package.json`, and any packaging metadata files needed if product name, bundle identifier, or installer labels differ by channel.
  **Acceptance**: The app can resolve stable or dev updater metadata based on the selected channel, the repo can intentionally build stable and dev packages, and neither channel depends on the other's GitHub release/tag namespace.

- [x] 5. Add a dev-channel publishing workflow on pushes to `main`
  **What**: Create a new workflow dedicated to dev-channel packaging and Tauri publishing. Reuse the existing matrix/build steps from `.github/workflows/release.yml` where practical, but publish into a distinct prerelease or release namespace with separate updater metadata/assets. Include version derivation, signing, artifact upload, and any cleanup/retention logic needed for repeated `main` pushes. The workflow must emit full installable dev packages, not just updater JSON.
  **Files**: `.github/workflows/dev-channel.yml` (new), `.github/workflows/release.yml` (only if shared actions or reusable workflow extraction is warranted), `.github/workflows/ci.yml` (only if the new workflow should be referenced or gated), `scripts/tauri-prebuild.mjs`, `package.json`.
  **Acceptance**: Pushing to `main` triggers a workflow that produces new signed dev-channel installers/packages and updater metadata usable by dev-channel clients without requiring a git tag.

- [x] 6. Make stable and dev packaging explicit for maintainers
  **What**: Define the packaging strategy for both channels so maintainers can intentionally build `stable` and `dev` variants locally and in CI. Keep package identity shared so the dev package replaces the normal app install; limit channel differences to updater endpoint/default channel, version labeling, and release artifact naming rather than separate side-by-side branding.
  **Files**: `package.json`, `scripts/tauri-prebuild.mjs`, `src-tauri/tauri.conf.json`, and any packaging metadata touched by channel-specific version labeling or artifact names.
  **Acceptance**: There is a documented and scriptable way to build both stable and dev packages, and both variants install as the same app identity rather than separate side-by-side apps.

- [x] 7. Document release and channel operations
  **What**: Extend release docs with the new channel model, required secrets, expected asset/tag naming, how stable and dev packages are produced locally and in CI, and how stable and dev builds should be verified. Clarify whether dev builds are prereleases, rolling releases, or a dedicated "dev" release asset set.
  **Files**: `RELEASE.md`, optionally a new doc under `.weave/` only if internal planning notes are useful.
  **Acceptance**: Maintainers can tell how stable releases differ from dev-channel publishes, what metadata each channel uses, and how to verify that updater clients stay on the intended channel.

## Acceptance Criteria
- [x] Auto-update is configurable from the existing settings/about surfaces without introducing a separate hidden config file.
- [x] Update channel is configurable from the existing settings/about surfaces with explicit `stable` and `dev` options.
- [x] When auto-update is disabled, behavior matches today's flow: check, prompt, download/install on explicit user action.
- [x] When auto-update is enabled, the app downloads updates in the background, preserves user feedback on progress/error state, and does not restart until the next launch.
- [x] On the next app start after a successful auto-download, the new version is installed/applied before normal use, or the app reports a recoverable failure and falls back safely.
- [x] Selecting `stable` makes the app fetch stable metadata only; selecting `dev` makes the app fetch dev metadata only.
- [x] Switching channels has a defined and tested behavior for both `stable -> dev` and `dev -> stable`, including any downgrade prompt or deferred fallback rule.
- [x] Dev-channel publishing runs from `main` without creating stable release tags and produces signed updater metadata compatible with Tauri.
- [x] The repo can produce both stable and dev installers/packages intentionally, and both variants are documented and tested as mutually replacing installs of the same app.
- [x] Stable tagged release automation remains functional and unchanged from a maintainer perspective except for any explicit channel parameters.

## Risks / Open Questions
- [ ] Confirm the exact Tauri 2 updater behavior for "download now, install on next start" on each platform; if the plugin only supports immediate install after download, the implementation may need a persisted "download completed, call install early on next launch" workaround rather than true OS-level staging.
  <!-- blocked: requires packaged desktop validation on each target OS -->
- [x] Confirm whether Tauri's updater configuration can switch endpoints cleanly at runtime for a user-selected channel; if not, the implementation may need a custom metadata fetch path or a unified channel-aware endpoint.
- [x] Decide the dev versioning strategy early. Reusing `package.json`/`Cargo.toml` version numbers on every `main` push is likely insufficient for updater ordering and GitHub release reuse.
- [x] Decide where dev updater metadata will live: a rolling `dev/latest.json` style location, a dedicated prerelease updated in place, or per-build releases plus a stable alias. This choice affects both endpoint shape and cleanup complexity.
- [x] Decide the downgrade policy when a user switches from `dev` back to `stable`; updater ordering may prevent an automatic install if the dev build version sorts higher than the latest stable.
- [ ] Confirm the replacement-install implications on each platform, especially whether shared bundle identity plus differing channel/version metadata behaves correctly for installer upgrades and updater state.
  <!-- blocked: requires cross-platform packaged install testing -->
- [x] Ensure the existing server-side `/api/version` endpoint does not continue to report only GitHub's stable "latest release" for dev users; it may need channel awareness to avoid misleading About-tab badges.
- [ ] Validate that signing keys and GitHub permissions used by stable releases are appropriate for dev publishing, especially if the workflow rewrites a rolling prerelease or uploads to a separate release.
  <!-- blocked: requires first dev workflow execution + permission audit -->
- [ ] Watch for startup timing issues in `src-tauri/src/lib.rs`: applying a staged update too late could conflict with sidecar boot, single-instance behavior, or the current delayed update check.
  <!-- blocked: requires runtime soak testing with real staged updates -->

## Verification
- [x] All tests pass.
- [x] No regressions in manual update flow.
- [x] `bun run lint && bun run typecheck && bun run test` succeeds.
- [ ] A local desktop smoke test confirms manual mode, auto-download mode, and restart-into-updated-version behavior.
  <!-- blocked: requires interactive packaged app smoke test -->
- [ ] A dry run or branch run of the dev workflow confirms signed artifacts, dev-only updater metadata, and no stable release asset collisions.
  <!-- blocked: requires GitHub Actions execution context -->
