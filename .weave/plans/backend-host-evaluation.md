# Backend Host Evaluation — Next.js vs Standalone Node vs Go

## TL;DR
> **Summary**: Evaluate whether Weave Agent Fleet should keep its backend inside Next.js or extract it into a dedicated service, while preserving the current “single install, local app, desktop wrapper” experience. The plan inventories current backend responsibilities, defines a parity test matrix, compares three host options, and recommends an incremental strangler migration before any swap decision.
> **Estimated Effort**: XL

## Context
### Original Request
Create a detailed implementation/evaluation plan for Weave Agent Fleet to assess replacing or extracting the backend currently hosted inside Next.js, explicitly comparing: (A) keep backend in Next.js, (B) extract to standalone Node/TypeScript, and (C) extract to Go, while preserving today’s shipping convenience and reducing regression risk.

### Key Findings
- The current product is a **single Next.js 16 App Router application** that serves both UI and backend logic, with standalone output enabled in `next.config.ts`.
- The heaviest backend responsibilities live in `src/lib/server/`, especially:
  - process lifecycle + recovery: `src/lib/server/process-manager.ts`
  - shared event multiplexing: `src/lib/server/instance-event-hub.ts`
  - session state persistence/watchers: `src/lib/server/session-status-watcher.ts`
  - callback delivery + polling safety net: `src/lib/server/callback-monitor.ts`, `src/lib/server/callback-service.ts`
  - persistence: `src/lib/server/database.ts`, `src/lib/server/db-repository.ts`
  - workspace isolation: `src/lib/server/workspace-manager.ts`
  - config/auth/tool integration: `src/lib/server/config-manager.ts`, `src/lib/server/auth-store.ts`, `src/app/api/open-directory/route.ts`
- API routes in `src/app/api/**/route.ts` are mostly thin adapters over those server modules. Notable real-time endpoints include `src/app/api/sessions/[id]/events/route.ts` and `src/app/api/activity-stream/route.ts`.
- The backend relies on **Node process state and long-lived singletons** (`globalThis` maps, intervals, listeners, signal handlers) to survive Next/Turbopack module re-evaluation. This is a sign the runtime is acting like an app server more than a typical request/response web backend.
- Shipping today is built around a **bundled Node + Next standalone server**:
  - standalone output: `next.config.ts`
  - self-contained assembly: `scripts/assemble-standalone.sh`
  - launcher/installer UX: `scripts/launcher.sh`, `scripts/install.sh`, `scripts/install.ps1`
- The Tauri desktop app is currently a **wrapper around the Next standalone server**. Rust starts a sidecar Node process that runs `server.js`, waits on `/api/version`, then points the webview at localhost: `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`, `scripts/tauri-prebuild.mjs`.
- The repo already has an API/UI split foundation via `src/lib/api-client.ts` and permissive API proxy/CORS handling in `src/proxy.ts`, which makes an incremental extraction feasible.
- Existing tests already cover key backend subsystems and verification scenarios, including `src/lib/server/__tests__/process-manager.test.ts`, `session-status-watcher.test.ts`, `callback-monitor.test.ts`, `workspace-manager.test.ts`, `v2-verification.test.ts`, and `v2-integration.test.ts`.

## Objectives
### Core Objective
Produce a decision-ready evaluation plan for backend hosting, with concrete migration and parity-validation steps that minimize the risk of breaking Weave Fleet’s current local/desktop/standalone experience.

### Deliverables
- [ ] A current-state backend responsibility map tied to concrete repo areas
- [ ] A side-by-side evaluation of options A/B/C with shipping, operational, and regression trade-offs
- [ ] A phased migration strategy that prefers incremental extraction over big-bang rewrite
- [ ] A feature parity verification plan covering API behavior, orchestration, streaming, persistence, and packaging UX
- [ ] A decision framework with acceptance criteria for whether a backend swap should proceed

### Definition of Done
- [ ] The current backend surface is mapped to concrete files and runtime responsibilities
- [ ] The plan identifies which responsibilities are safe to extract first vs. last
- [ ] The plan defines parity checks that can be run before and after each phase
- [ ] The plan states clear proceed / do-not-proceed criteria for Node extraction and Go extraction
- [ ] Reviewers can use this document alone to start an investigation spike without re-researching the repo

### Guardrails (Must NOT)
- Must NOT rewrite application code as part of this task
- Must NOT assume a big-bang backend replacement is acceptable
- Must NOT break current standalone install flow (`weave-fleet`), Next standalone packaging, or Tauri desktop startup UX
- Must NOT reduce current capabilities around session lifecycle, workspace isolation, callbacks, SSE streaming, or SQLite persistence
- Must NOT treat “Go is faster” as sufficient justification without parity, packaging, and maintenance evidence

## Current-State Responsibilities and Pain Points

### Backend Responsibilities Today
- **HTTP API surface / routing**
  - `src/app/api/**/route.ts`
  - Owns request validation, response shaping, SSE responses, and route composition.
- **OpenCode instance lifecycle**
  - `src/lib/server/process-manager.ts`
  - Spawns `opencode serve`, allocates ports, tracks instances, health-checks, auto-respawns, shutdown cleanup, startup recovery.
- **Event ingestion + fan-out**
  - `src/lib/server/instance-event-hub.ts`
  - Maintains one shared OpenCode event subscription per instance and multiplexes to watchers and browser SSE.
- **Session state + activity transitions**
  - `src/lib/server/session-status-watcher.ts`, `src/lib/server/activity-emitter.ts`
  - Persists busy/idle/waiting_input state and publishes transient activity updates.
- **Callback orchestration / child-parent session coordination**
  - `src/lib/server/callback-monitor.ts`, `src/lib/server/callback-service.ts`
  - Detects busy→idle transitions, polls as a safety net, and injects callback prompts into parent sessions.
- **Persistence and recovery**
  - `src/lib/server/database.ts`, `src/lib/server/db-repository.ts`
  - SQLite schema/migrations plus repository access for sessions, instances, workspaces, callbacks, roots, and token totals.
- **Workspace isolation + filesystem orchestration**
  - `src/lib/server/workspace-manager.ts`
  - Creates worktrees/clones, cleans them up, enforces local workflow isolation.
- **Config / auth / tool integration**
  - `src/lib/server/config-manager.ts`, `src/lib/server/auth-store.ts`, `src/app/api/open-directory/route.ts`
  - Reads Weave config, installed skills, auth.json, and launches external tools.
- **Version/update/runtime bootstrap**
  - `src/instrumentation.ts`, `src/lib/server/version-check.ts`, `/api/version`
  - Startup version check and health endpoint used by desktop sidecar boot.

### Architectural Pain Points to Evaluate
- **Long-lived backend living inside a UI framework runtime**
  - `process-manager.ts`, `activity-emitter.ts`, `callback-monitor.ts`, and `instance-event-hub.ts` all use `globalThis` to compensate for Next.js/Turbopack re-evaluation.
- **Backend identity is coupled to Next’s server process**
  - Signal handling, lifecycle cleanup, and recovery all assume one durable Node server, even though the host technology is nominally a web framework.
- **Packaging is host-coupled**
  - Standalone and Tauri both currently package `server.js` and Node runtime artifacts, so any extraction affects release assembly, installers, and desktop sidecar startup.
- **SSE + background loops are not “stateless route” workloads**
  - Session event streams, callback polling, health checks, analytics flushes, and listener monitoring behave like service daemons.
- **Native/runtime dependencies may constrain extraction choices**
  - `better-sqlite3` is currently bundled into standalone output and Tauri app-bundle; Go would likely replace the DB driver and change packaging assumptions.

### Option Comparison Baseline
- **A) Keep backend in Next.js**
  - Lowest migration cost, lowest near-term regression risk, preserves current shipping model.
  - Retains framework/runtime mismatch and ongoing complexity around server singletons/background workers.
- **B) Extract backend to standalone Node/TypeScript service, keep Next for UI**
  - Best incremental path: reuse most `src/lib/server/` logic, preserve JS ecosystem, keep type/model sharing simpler.
  - Still ships Node, but with cleaner separation of concerns and less dependence on Next runtime semantics.
- **C) Extract backend to Go service, keep Next for UI**
  - Highest potential long-term fit for daemon/process orchestration workload and desktop-friendly static binaries.
  - Highest migration cost and highest parity risk because process/event/persistence behavior must be reimplemented, not just rehosted.

## TODOs

- [ ] 1. **Freeze the current architecture baseline**
  **What**: Document the existing runtime split between UI, API adapters, service logic, standalone packaging, CLI, and Tauri wrapper so future evaluation work compares against a stable target rather than assumptions.
  **Files**: `README.md`, `next.config.ts`, `src/app/api/**/route.ts`, `src/lib/server/*.ts`, `src/cli/index.ts`, `scripts/assemble-standalone.sh`, `scripts/launcher.sh`, `scripts/install.sh`, `scripts/install.ps1`, `scripts/tauri-prebuild.mjs`, `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`
  **Acceptance**: A reviewer can point to exact files for API hosting, orchestration, persistence, packaging, CLI, and desktop sidecar responsibilities.

- [ ] 2. **Create a backend responsibility inventory by capability**
  **What**: Break backend scope into capability slices that can later be extracted independently: API transport, session lifecycle, process supervision, SSE/event bus, callbacks, workspace isolation, SQLite persistence, config/auth/tooling, and update/version endpoints.
  **Files**: `src/lib/server/process-manager.ts`, `src/lib/server/instance-event-hub.ts`, `src/lib/server/session-status-watcher.ts`, `src/lib/server/callback-monitor.ts`, `src/lib/server/callback-service.ts`, `src/lib/server/workspace-manager.ts`, `src/lib/server/database.ts`, `src/lib/server/db-repository.ts`, `src/app/api/sessions/route.ts`, `src/app/api/sessions/[id]/events/route.ts`, `src/app/api/activity-stream/route.ts`, `src/app/api/config/route.ts`, `src/app/api/open-directory/route.ts`, `src/app/api/version/route.ts`
  **Acceptance**: Every backend behavior visible to users is mapped to an owner module and tagged as either “transport-only”, “business logic”, or “runtime/daemon concern”.

- [ ] 3. **Define current pain points with evidence, not preference**
  **What**: Convert qualitative concerns into measurable evaluation questions: module reload workarounds, singleton leakage risk, SSE resilience, startup recovery complexity, packaging friction, Tauri sidecar coupling, and test gaps.
  **Files**: `src/lib/server/process-manager.ts`, `src/lib/server/activity-emitter.ts`, `src/lib/server/callback-monitor.ts`, `src/lib/server/instance-event-hub.ts`, `src/instrumentation.ts`, `src-tauri/src/lib.rs`, `scripts/tauri-prebuild.mjs`
  **Acceptance**: Each pain point includes repo evidence and at least one metric or observable symptom to test during evaluation.

- [ ] 4. **Evaluate Option A — keep backend in Next.js**
  **What**: Assess the “do nothing structural” option as the control. Identify what targeted hardening would look like instead of extraction: clearer service boundaries, tighter tests, startup/health instrumentation, and reduced route coupling without changing host technology.
  **Files**: `src/app/api/**/route.ts`, `src/lib/server/*.ts`, `next.config.ts`, `src/proxy.ts`
  **Acceptance**: The plan records the actual benefits, limits, and remaining risks of staying in Next.js, including what pain points would still exist after modest refactoring.

- [ ] 5. **Evaluate Option B — extract to standalone Node/TypeScript service**
  **What**: Define a target architecture where Next becomes UI-only and a dedicated Node service owns orchestration/runtime concerns. Identify reusable modules, required boundary changes, API contract stabilization, local dev topology, standalone packaging changes, and Tauri sidecar impact.
  **Files**: `src/lib/server/*.ts`, `src/lib/api-client.ts`, `src/proxy.ts`, `next.config.ts`, `scripts/assemble-standalone.sh`, `scripts/launcher.sh`, `scripts/tauri-prebuild.mjs`, `src-tauri/src/lib.rs`
  **Acceptance**: The plan describes a concrete extraction path that keeps the UI working through the existing API client/base-URL mechanism and preserves today’s install/start flow.

- [ ] 6. **Evaluate Option C — extract to Go service**
  **What**: Define a target architecture where a Go daemon owns orchestration, SSE/event fan-out, callbacks, process supervision, workspace management, and persistence, while Next remains UI-only. Explicitly account for Go-specific lifecycle concerns: background context ownership, goroutine shutdown, channel ownership, bounded fan-out, HTTP streaming, SQLite driver choice, and platform packaging.
  **Files**: `src/lib/server/process-manager.ts`, `src/lib/server/instance-event-hub.ts`, `src/lib/server/session-status-watcher.ts`, `src/lib/server/callback-monitor.ts`, `src/lib/server/workspace-manager.ts`, `src/lib/server/database.ts`, `src/app/api/sessions/[id]/events/route.ts`, `src/app/api/activity-stream/route.ts`, `scripts/launcher.sh`, `scripts/install.sh`, `scripts/install.ps1`, `src-tauri/src/lib.rs`
  **Acceptance**: The plan identifies which Node behaviors would be reimplemented vs. wrapped, plus the minimum proof required before any Go rewrite is approved.

- [ ] 7. **Compare shipping and distribution implications across A/B/C**
  **What**: For each option, document how local dev, standalone install, CLI behavior, auto-update/release assets, and Tauri desktop would work. Include binary/runtime artifacts, startup flow, health checks, port binding, and user-visible startup errors.
  **Files**: `scripts/assemble-standalone.sh`, `scripts/launcher.sh`, `scripts/install.sh`, `scripts/install.ps1`, `scripts/tauri-prebuild.mjs`, `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`, `src/cli/index.ts`
  **Acceptance**: The plan makes it clear whether each option preserves “download once, run locally, open localhost or desktop app” with equal or better ergonomics.

- [ ] 8. **Design an incremental strangler migration path**
  **What**: Prefer extraction by boundary rather than by rewrite. Sequence proposed phases such as: (1) stabilize contracts and parity tests, (2) move transport to an explicit service boundary, (3) extract stateless/simple endpoints, (4) extract orchestration endpoints, (5) extract SSE/eventing, (6) extract packaging/startup, (7) retire duplicated paths. Treat big-bang replacement as a rejected fallback.
  **Files**: `src/app/api/**/route.ts`, `src/lib/api-client.ts`, `src/proxy.ts`, `src/lib/server/*.ts`, `scripts/*`, `src-tauri/src/lib.rs`
  **Acceptance**: The plan orders work so each phase can ship behind a feature flag or environment toggle and roll back cleanly.

- [ ] 9. **Define the feature parity verification matrix**
  **What**: Turn today’s behavior into a mandatory parity checklist that all extraction candidates must pass before cutover. Cover both automated and manual checks, and tie them to the existing server test suite where possible.
  **Files**: `src/lib/server/__tests__/process-manager.test.ts`, `src/lib/server/__tests__/session-status-watcher.test.ts`, `src/lib/server/__tests__/callback-monitor.test.ts`, `src/lib/server/__tests__/workspace-manager.test.ts`, `src/lib/server/__tests__/database.test.ts`, `src/lib/server/__tests__/db-repository.test.ts`, `src/lib/server/__tests__/v2-verification.test.ts`, `src/lib/server/__tests__/v2-integration.test.ts`, `src/hooks/use-global-sse.ts`, `src/app/api/sessions/[id]/events/route.ts`, `src/app/api/activity-stream/route.ts`
  **Acceptance**: The plan contains explicit pass/fail categories for:
  - API behavior and error semantics
  - session create/prompt/fork/resume/abort/terminate/delete lifecycle
  - process orchestration and recovery after restart/crash
  - event streaming and reconnection behavior
  - callback delivery and deduplication
  - persistence/migrations/data compatibility
  - workspace isolation/cleanup
  - packaging/startup UX for standalone and Tauri

- [ ] 10. **Specify detailed parity test categories and commands**
  **What**: Require a layered test pack for every serious extraction spike.
  **Files**: `package.json`, `src/lib/server/__tests__/*.test.ts`, `scripts/assemble-standalone.sh`, `scripts/tauri-prebuild.mjs`, `src-tauri/src/lib.rs`
  **Acceptance**:
  - [ ] Unit/regression: `npm run test`
  - [ ] Type/lint baseline for remaining TS code: `npm run typecheck` and `npm run lint`
  - [ ] API contract tests: golden request/response comparisons for key endpoints
  - [ ] Session lifecycle tests: create, prompt, idle transition, resume, abort, terminate, delete
  - [ ] Process supervision tests: port allocation, dead instance detection, restart recovery, signal handling
  - [ ] SSE tests: per-session stream, global activity stream, keepalive behavior, reconnect behavior, disconnect cleanup
  - [ ] Callback tests: busy→idle callback, error callback, polling fallback, duplicate suppression
  - [ ] Persistence tests: schema creation, migration compatibility, session/workspace/callback/token totals integrity
  - [ ] Packaging tests: standalone artifact launches, Tauri sidecar starts, `/api/version` health check succeeds, CLI subcommands still run without the server path
  - [ ] UX smoke tests: install → launch → create session → observe stream → close/reopen desktop app → verify data/session state survives as expected

- [ ] 11. **Run a risk analysis focused on regression hotspots**
  **What**: Identify the highest-risk capability areas and what mitigations are mandatory before extraction or rewrite.
  **Files**: `src/lib/server/process-manager.ts`, `src/lib/server/instance-event-hub.ts`, `src/lib/server/callback-monitor.ts`, `src/lib/server/workspace-manager.ts`, `src/lib/server/database.ts`, `src-tauri/src/lib.rs`
  **Acceptance**: The plan explicitly covers these risks and mitigations:
  - session state drift between live memory and DB
  - lost or duplicated SSE events/callbacks
  - orphaned `opencode serve` processes or leaked watchers
  - incorrect recovery after server restart/crash
  - packaging regressions in standalone/Tauri installers
  - cross-platform behavior changes (Windows spawn semantics, signal handling, path rules)
  - SQLite/data migration incompatibilities
  - degraded startup convenience or requirement for extra user setup

- [ ] 12. **Recommend a phased decision path, not just a target architecture**
  **What**: Recommend what to do first based on risk-adjusted value. The preferred path should decide whether to stop at better boundaries in Next, proceed to dedicated Node service, or require a separate Go proof-of-concept before any commitment.
  **Files**: `.weave/plans/backend-host-evaluation.md`
  **Acceptance**: The recommendation names a default path, a fallback path, and explicit conditions under which the Go path becomes justified.

- [ ] 13. **Define decision acceptance criteria for proceeding with a swap**
  **What**: Set objective gates so the team can say “do not proceed” if evidence is weak.
  **Files**: `.weave/plans/backend-host-evaluation.md`
  **Acceptance**: Proceed only if the candidate backend demonstrates all of the following:
  - [ ] No critical parity failures in session lifecycle, orchestration, SSE, persistence, or packaging
  - [ ] No worse local install/startup flow than current standalone/Tauri experience
  - [ ] Equal or better crash recovery and process cleanup behavior
  - [ ] Equal or better cross-platform behavior on macOS, Linux, and Windows
  - [ ] Operational complexity is lower overall, not merely moved elsewhere
  - [ ] For Go specifically: measurable wins in reliability, packaging simplicity, or runtime behavior that outweigh rewrite cost and dual-language maintenance

## Recommended Phased Approach

### Phase 0 — Decision Prep
- [ ] Capture the current-state architecture and parity baseline from the files listed above.
- [ ] Lock in golden API behaviors and smoke-test scenarios before changing hosting boundaries.

### Phase 1 — Boundary Hardening Inside Current Architecture
- [ ] Treat `src/lib/server/` as the backend core and document a stable internal service surface.
- [ ] Reduce route-layer knowledge to transport/validation only.
- [ ] Expand parity tests around orchestration, SSE, packaging, and startup health.

### Phase 2 — Node Extraction Spike (Preferred First Extraction)
- [ ] Prototype a dedicated Node/TypeScript service using the existing backend modules with minimal logic rewrites.
- [ ] Keep Next UI pointed at the extracted API via `src/lib/api-client.ts` base URL support.
- [ ] Preserve current standalone and Tauri behavior by swapping the sidecar target from `server.js` to the extracted service only after parity passes.

### Phase 3 — Decision Gate
- [ ] If Node extraction removes the main pain points with acceptable complexity, stop there.
- [ ] Only pursue Go if important pain points remain unsolved and the Node extraction spike proves the service boundary is correct.

### Phase 4 — Go Feasibility Spike (Conditional)
- [ ] Build a narrow Go proof-of-concept for the hardest runtime slice: process supervision + SSE/event multiplexing + recovery.
- [ ] Require explicit documentation of context ownership, goroutine termination, error propagation, and synchronization before broadening scope.
- [ ] Reject full Go migration if the POC cannot prove parity on orchestration and packaging with lower long-term complexity.

## Verification
- [ ] All tests pass
- [ ] No regressions in session lifecycle behavior
- [ ] No regressions in process orchestration, recovery, or cleanup
- [ ] No regressions in SSE/event streaming and callback delivery
- [ ] No regressions in SQLite persistence, migrations, or existing data handling
- [ ] Standalone packaging still launches with the same or better UX
- [ ] Tauri desktop startup, sidecar health checks, tray polling, and update flow still work
- [ ] CLI subcommands (`init`, `skill`) still work independently of the main app startup path
- [ ] Cross-platform validation completed for macOS, Linux, and Windows
