# Single Go Binary Evaluation — Serve Frontend + Backend Locally

## TL;DR
> **Summary**: Evaluate replacing the current bundled Node + Next standalone server with a single Go local app that embeds static frontend assets and serves API + SSE from the same process, while preserving today’s “one install, one local app” experience. The safest path is an incremental strangler migration with contract freezing, static-frontend proof, and a narrow Go runtime spike before any cutover.
> **Estimated Effort**: XL

## Context
### Original Request
Create a focused architecture/migration plan for Weave Agent Fleet to evaluate a **single Go binary** target that serves both the frontend and backend locally, including target architecture, blockers, migration strategy, Go correctness concerns, delivery model, parity verification, decision criteria, and executable checkbox tasks.

### Key Findings
- The app is currently a single **Next.js 16 App Router** server with bundled backend logic and `output: 'standalone'` in `next.config.ts`.
- The frontend is mostly client-rendered and API-driven:
  - client shell/providers: `src/app/client-layout.tsx`
  - API base abstraction already exists: `src/lib/api-client.ts`
  - browser SSE is already a localhost HTTP concern: `src/hooks/use-global-sse.ts`, `src/hooks/use-session-events.ts`
- Static serving is blocked today by concrete Next runtime dependencies:
  - forced dynamic app shell: `src/app/layout.tsx`
  - Next route handlers under `src/app/api/**/route.ts`
  - Next-only UI/runtime helpers such as `next/link`, `next/image`, `next/navigation`, `next/font/google` in files like `src/components/layout/sidebar.tsx`, `src/app/sessions/[id]/page.tsx`, `src/app/layout.tsx`
- Backend responsibilities already behave like a long-lived daemon more than a request-only web app:
  - process supervision/recovery: `src/lib/server/process-manager.ts`
  - event multiplexing + reconnect: `src/lib/server/instance-event-hub.ts`
  - callback monitoring: `src/lib/server/callback-monitor.ts`
  - background state propagation: `src/lib/server/session-status-watcher.ts`, `src/lib/server/activity-emitter.ts`
  - SQLite persistence: `src/lib/server/database.ts`, `src/lib/server/db-repository.ts`
- Current shipping convenience depends on bundled Node + Next assumptions:
  - standalone build/assembly: `next.config.ts`, `scripts/assemble-standalone.sh`
  - launcher expects `bin/node` + `app/server.js`: `scripts/launcher.sh`
  - installers distribute that layout: `scripts/install.sh`, `scripts/install.ps1`
  - Tauri spawns a Node sidecar, polls `/api/version`, then opens localhost: `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`, `scripts/tauri-prebuild.mjs`
- Prior repo research already concluded the blockers are **moderate**, not fundamental, and that the backend workload is a better conceptual fit for Go than for Next runtime singletons.

### Biggest Unknowns / Risks
- The biggest frontend unknown is whether the current Next app can be reduced to a stable static artifact cheaply, or whether a React SPA/Vite migration becomes the cleaner path.
- The biggest backend unknown is whether the OpenCode integration surface can be reproduced in Go without hidden SDK behavior currently provided by `@opencode-ai/sdk`.
- The biggest delivery unknown is whether this can be a **true single binary** on all targets, or only a **single installer/app bundle**, depending on SQLite driver choice, CLI parity, and Tauri retention.
- The biggest regression risk is not raw API parity; it is the combination of **process supervision + SSE fan-out + callback correctness + persistence/recovery + startup UX**.

## Objectives
### Core Objective
Produce a decision-ready plan to evaluate a single Go local app that serves embedded frontend assets plus API and SSE, without regressing Weave Fleet’s current local install, desktop startup, orchestration, or persistence behavior.

### Deliverables
- [ ] A concrete target architecture for a single Go binary local app
- [ ] A blocker inventory with direct repo evidence for frontend, API/SSE, and packaging
- [ ] An incremental migration sequence with an explicit cutover strategy
- [ ] A Go-specific runtime correctness checklist applying goroutine/context/channel ownership rules
- [ ] A release/delivery model that preserves or improves today’s single-app convenience
- [ ] A parity verification matrix with hard acceptance gates
- [ ] A proceed / reject decision framework based on evidence rather than preference

### Definition of Done
- [ ] The plan names the exact repo files that make static serving, API extraction, and packaging difficult today
- [ ] The plan defines a target Go runtime shape with ownership for HTTP, SSE, supervision, and persistence
- [ ] The plan states whether an intermediate extracted Node backend is required, optional, or avoidable
- [ ] The plan includes a concrete “single-binary convenience parity” gate
- [ ] Reviewers can use this document to run a spike without re-researching the repo

### Guardrails (Must NOT)
- Must NOT do a big-bang rewrite
- Must NOT break current standalone install flow or Tauri startup UX before parity is proven
- Must NOT assume “Go is better” without proving frontend artifact feasibility and runtime parity
- Must NOT use request-scoped lifetimes for background work in the Go design
- Must NOT accept a design that leaves orphan goroutines, orphan `opencode serve` processes, or unbounded SSE fan-out

## Target Architecture

### Proposed Target
- **One Go process** listens on localhost and serves:
  - static frontend assets
  - REST API
  - per-session SSE
  - global activity SSE
  - health/version endpoints
- Suggested future Go layout:
  - `go.mod`
  - `cmd/weave-fleet/main.go`
  - `internal/app/runtime.go`
  - `internal/http/router.go`
  - `internal/http/api/*.go`
  - `internal/http/sse.go`
  - `internal/orchestrator/process_manager.go`
  - `internal/orchestrator/event_hub.go`
  - `internal/callbacks/monitor.go`
  - `internal/persistence/sqlite.go`
  - `internal/workspaces/manager.go`
  - `internal/platform/processes_unix.go`
  - `internal/platform/processes_windows.go`
  - `internal/web/embed.go`
  - `frontend-dist/**` (normalized static artifact folder to embed)

### Frontend Asset Serving
- Build the frontend into a deterministic static folder (`frontend-dist/**`), then embed it with `go:embed`.
- Go serves hashed JS/CSS/assets with immutable cache headers and serves `index.html` for app routes.
- Runtime API URLs should remain relative (`/api/...`) so the same artifact works in browser, standalone, and Tauri; this matches the current pattern in `src/lib/api-client.ts`.
- Evaluation branch point:
  - **Preferred first check**: can current Next UI produce a reliable static artifact after removing blockers in `src/app/layout.tsx` and moving `src/app/api/**` out of Next?
  - **Fallback if not**: migrate the frontend shell to a dedicated SPA build that still reuses current React components/hooks where practical.

### Localhost Startup / Health Checks
- Default browser/CLI flow should keep today’s expectation: `http://localhost:3000` unless overridden.
- Desktop/Tauri flow can keep ephemeral port support for collision avoidance; the Go binary should support `--port 0` and print/log the chosen URL.
- Health contract should include:
  - `/healthz` for liveness/readiness
  - `/api/version` for backward-compatible Tauri/launcher checks (mirrors current `src/app/api/version/route.ts` and `src-tauri/src/lib.rs`)
- Readiness should mean: DB opened, schema checked, HTTP router up, and startup supervision initialized. It must **not** wait for all `opencode` instances to exist.

### Optional Tauri Wrapper Path
- Tauri remains optional and becomes a thinner wrapper:
  - Rust spawns the Go binary instead of bundled Node
  - polls `/api/version` or `/healthz`
  - points the webview at localhost when ready
- Relevant migration points:
  - `src-tauri/src/lib.rs`
  - `src-tauri/tauri.conf.json`
  - `scripts/tauri-prebuild.mjs`
- If Tauri is retained, the desktop artifact is a **single app bundle/installer**, even if the browser distribution becomes a true single binary.

## Current-State Blockers and Repo Evidence

### Next Runtime Dependencies Blocking Static Serving
- `src/app/layout.tsx`
  - `export const dynamic = "force-dynamic"`
  - imports `next/font/google`
  - this blocks a clean “static assets only” story in current form
- `src/app/api/**/route.ts`
  - current backend is implemented as Next route handlers, not an external service
  - key examples: `src/app/api/sessions/route.ts`, `src/app/api/sessions/[id]/events/route.ts`, `src/app/api/activity-stream/route.ts`, `src/app/api/version/route.ts`
- Next-only UI helpers are still spread through the UI layer:
  - `next/link`, `next/image`, `next/navigation` in `src/components/layout/sidebar.tsx`, `src/app/page.tsx`, `src/app/sessions/[id]/page.tsx`, `src/components/layout/sidebar-session-item.tsx`
- `src/proxy.ts` shows current reliance on Next middleware-style API CORS handling for split/same-origin modes.

### API / SSE Responsibilities That Must Move
- Session lifecycle transport currently lives in Next routes:
  - create/list sessions: `src/app/api/sessions/route.ts`
  - prompt/resume/fork/abort/command/messages/status/diffs: `src/app/api/sessions/[id]/**/route.ts`
- SSE transport currently lives in Next routes and depends on server-side singleton state:
  - per-session stream: `src/app/api/sessions/[id]/events/route.ts`
  - global stream: `src/app/api/activity-stream/route.ts`
- Runtime/business logic behind those routes already lives outside Next pages and would need to move or be reimplemented:
  - `src/lib/server/process-manager.ts`
  - `src/lib/server/instance-event-hub.ts`
  - `src/lib/server/session-status-watcher.ts`
  - `src/lib/server/callback-monitor.ts`
  - `src/lib/server/callback-service.ts`
  - `src/lib/server/workspace-manager.ts`
  - `src/lib/server/database.ts`
  - `src/lib/server/db-repository.ts`
- Non-session API responsibilities also need explicit ownership in the Go service:
  - config/skills: `src/app/api/config/route.ts`, `src/app/api/skills/**`
  - integrations/GitHub: `src/app/api/integrations/**`
  - version/tools/open-directory/directories/workspace-roots: `src/app/api/version/route.ts`, `src/app/api/available-tools/route.ts`, `src/app/api/open-directory/route.ts`, `src/app/api/directories/route.ts`, `src/app/api/workspace-roots/**`

### Packaging / Distribution Assumptions That Change
- `next.config.ts` assumes Next standalone output and bundles `@opencode-ai/sdk` and `better-sqlite3` as server dependencies.
- `scripts/assemble-standalone.sh` assumes `.next/standalone/server.js`, `.next/static`, public assets, and `better_sqlite3.node`.
- `scripts/launcher.sh` assumes the runtime shape is:
  - bundled Node at `bin/node`
  - Next server at `app/server.js`
  - optional JS CLI at `app/cli.js`
- `scripts/install.sh` and `scripts/install.ps1` teach users that the installed runtime is Node-backed.
- `scripts/tauri-prebuild.mjs` explicitly builds Next standalone, downloads a Node sidecar, and packages `server.js` into `src-tauri/app-bundle/`.
- `src-tauri/tauri.conf.json` currently declares Node as `externalBin` and packages `app/` resources for the sidecar server.

## Migration Strategy

### Recommended Path: Incremental / Strangler
1. **Freeze contracts first**: inventory all API, SSE, DB, and startup behavior before moving runtime boundaries.
2. **Prove static frontend viability**: determine whether the current Next UI can emit a durable static artifact or whether a SPA build is needed.
3. **Introduce an external backend boundary**: keep the frontend talking to relative or configurable HTTP endpoints via `src/lib/api-client.ts`.
4. **Move transport endpoints first, then long-lived runtime loops**: start with health/version/config/simple CRUD, then session transport, then SSE/eventing, then supervision/callbacks/recovery.
5. **Swap packaging last**: only replace `server.js`/Node/Tauri sidecar packaging after behavioral parity is proven.

### Suggested Sequence
- **Phase 0 — Baseline and contracts**
  - freeze API/SSE behavior and startup UX
  - capture current packaging/runtime expectations
- **Phase 1 — Frontend artifact spike**
  - remove or isolate the blockers that prevent static serving
  - choose between “static Next artifact” and “SPA build artifact”
- **Phase 2 — Go runtime skeleton**
  - add Go app shell, router, health endpoint, embedded static serving, and a thin API contract stub
- **Phase 3 — Stateless/simple endpoints**
  - port version, config, skills, directories, available-tools, workspace-roots
- **Phase 4 — Session transport + persistence**
  - port session CRUD, DB access, workspace operations
- **Phase 5 — Runtime-heavy slices**
  - port `opencode` process supervision, event hub, SSE fan-out, callback monitoring, analytics/token accumulation, restart recovery
- **Phase 6 — Delivery swap**
  - replace launcher/install/Tauri sidecar assumptions from Node to Go
- **Phase 7 — Cutover / rollback gate**
  - switch default startup only after parity passes; keep rollback path to current Next server until release confidence is established

### Is an Intermediate Extracted Node Backend Required?
- **Not a strict prerequisite** for the final single-Go-binary target.
- **Recommended as an optional risk-reduction milestone**, not a mandatory shipping phase:
  - useful if contract boundaries are still fuzzy or if frontend static extraction needs time
  - useful to prove “Next is no longer the backend host” before rewriting runtime-heavy logic in Go
- Decision rule:
  - if API/SSE contracts can be frozen cleanly and the Go spike can implement them directly with good parity, skip the intermediate Node backend
  - if API/SSE behavior is still entangled with Next route semantics, use an extracted Node backend as a temporary strangler host first

## Go-Specific Correctness and Runtime Concerns

### App-Scoped Context Lifecycle
- The Go binary should create one root application context in `cmd/weave-fleet/main.go` and pass it downward.
- Background workers must use **app-scoped or subsystem-scoped contexts**, never request contexts.
- Required ownership model:
  - HTTP server goroutine: owned by app runtime, stops on root cancel or fatal listener error
  - per-instance `opencode` subscription goroutine: owned by instance supervisor, stops on instance teardown or app shutdown
  - callback polling loop: owned by callback supervisor, stops on app shutdown
  - health/cleanup sweep loop: owned by runtime supervisor, stops on app shutdown

### Goroutine Ownership / Termination
- Every goroutine must document:
  - which context it uses
  - what cancels it
  - whether errors are fatal, retried, or logged
  - which shared state it touches and how that state is synchronized
- No fire-and-forget goroutines may outlive their owner.
- Shutdown should use `context.CancelFunc` + `sync.WaitGroup` or equivalent supervisor pattern to guarantee quiescence before exit.

### SSE Fan-Out / Backpressure / Channel Ownership
- The event hub should own subscriber registration and per-subscriber queues.
- Use bounded channels/queues per subscriber; never allow unbounded fan-out buffers.
- The creator of a channel closes it.
- If a slow subscriber blocks fan-out, use non-blocking send with explicit behavior:
  - drop with metric/log for non-critical ephemeral events, or
  - disconnect the slow SSE client and force reconnect
- SSE writer goroutines should terminate on:
  - client disconnect
  - write error
  - request context cancellation
  - app shutdown

### Process Supervision and Shutdown
- Recreate the core guarantees of `src/lib/server/process-manager.ts`:
  - port allocation and collision handling
  - Windows vs POSIX process-tree termination
  - startup timeout and readiness detection for `opencode serve`
  - health checks and last-chance verification before kill
  - rate-limited respawn attempts
- Cross-platform process cleanup is a hard gate; a Go port must preserve the Windows-specific correctness currently handled in `process-manager.ts`.

### SQLite Driver / Persistence Concerns
- Evaluate driver choice explicitly:
  - **Pure Go** (`modernc.org/sqlite`-style path): better chance of a true single binary
  - **CGO-backed** SQLite: may offer maturity/perf but weakens the “single binary everywhere” story
- Preserve current DB invariants from `src/lib/server/database.ts`:
  - same default DB path
  - WAL mode
  - busy timeout equivalent
  - schema compatibility with existing `~/.weave/fleet.db`
  - safe startup migrations
- Plan for SQLite concurrency explicitly; do not assume the JS single-thread model carries over.

### Shared State Synchronization
- Global maps that are currently `globalThis` singletons in Node should become explicit owned state in Go runtime structs.
- Any shared mutable maps for instances, watchers, listeners, and callbacks need explicit mutex protection with comments describing field ownership.
- DB handles, instance registries, and subscriber registries should not be mutated from ad-hoc goroutines without synchronization.

## Single-Binary Delivery / Preservation Plan

### Preserve Today’s Convenience Model
- Preserve the user promise: **one download/install, one local command/app, localhost opens and works**.
- Replace “bundled Node + server.js” with one of these outcomes:
  - **Best case**: one true Go binary for browser/CLI distribution
  - **Acceptable fallback**: one installer/app bundle that contains the Go sidecar and optionally Tauri shell

### Release Artifact Targets
- Browser/local app distribution:
  - macOS/Linux: `weave-fleet` binary tarball
  - Windows: `weave-fleet.exe` zip
- Desktop distribution if Tauri retained:
  - macOS `.app` / `.dmg`
  - Windows installer
  - Linux package as supported by Tauri
- Installers should no longer need to fetch/download Node.

### True Single Binary vs Single Installer
- **True single binary is plausible** only if all of the following hold:
  - frontend assets are embedded
  - SQLite path avoids external native runtime friction
  - main app CLI behavior is folded into the Go binary or made explicitly out-of-scope
  - no separate Node runtime remains for backend or frontend serving
- **Tauri builds are not a true single binary**; they are a single desktop bundle/installer. That is still acceptable if convenience parity is equal or better.

### Tauri Fit If Retained
- Tauri becomes a UX wrapper, not a backend dependency.
- Rust changes should be limited to:
  - spawn Go sidecar
  - wait on localhost health
  - preserve tray/update/minimize behavior
- This simplifies `scripts/tauri-prebuild.mjs` by removing Node download and Next standalone normalization if frontend assets are already embedded in Go.

## Feature Parity Verification Strategy

### Required Test Categories
- **Frontend delivery parity**
  - embedded assets load correctly
  - deep links route correctly
  - hashed assets cache correctly
- **API behavior parity**
  - request/response bodies, status codes, and error semantics match current endpoints
- **Orchestration parity**
  - session create/prompt/fork/resume/abort/terminate/delete semantics match current behavior
  - `opencode serve` spawn/reuse/kill/respawn works cross-platform
- **SSE parity**
  - per-session events stream correctly
  - global activity stream keeps working
  - keepalive, reconnect, and disconnect cleanup are preserved
- **Callback parity**
  - busy→idle callback firing
  - error callback firing
  - polling fallback
  - duplicate suppression
- **Persistence parity**
  - existing DB opens successfully
  - migrations are compatible
  - token/cost/session/workspace/callback data remains intact
- **Startup UX parity**
  - install/start health path remains simple
  - browser flow and Tauri flow behave predictably on first launch and restart
- **Packaging parity**
  - release artifacts install and launch without requiring Node

### Acceptance Gates
- [ ] `npm run test`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `go test ./... -race`
- [ ] `go vet ./...`
- [ ] API golden tests pass against current and Go implementations
- [ ] SSE soak tests pass for reconnect, keepalive, disconnect cleanup, and slow consumer behavior
- [ ] Restart/recovery tests pass against an existing `~/.weave/fleet.db` fixture
- [ ] Packaging smoke tests pass on macOS, Linux, and Windows
- [ ] **Single-binary convenience parity** passes: one artifact/install flow, no manual Node install, no extra local service setup, no worse startup UX than `weave-fleet` today

## Decision Criteria

### Evidence That Justifies Proceeding
- [ ] Static frontend artifact generation is proven feasible with acceptable churn
- [ ] Go can reproduce the OpenCode orchestration path without hidden SDK blockers
- [ ] Go runtime passes parity for supervision, SSE, callbacks, and persistence
- [ ] Delivery becomes simpler or materially more robust than Node standalone packaging
- [ ] Cross-platform behavior, especially Windows process handling, is at least as reliable as today
- [ ] The team is comfortable owning a Go + frontend stack long term

### Evidence That Should Stop / Reject the Approach
- [ ] Static frontend extraction requires a near-full frontend rewrite with unclear payoff
- [ ] OpenCode integration depends on Node SDK behavior that is expensive or risky to replicate
- [ ] Go cannot match current SSE/callback/recovery correctness without substantially more complexity
- [ ] SQLite driver constraints prevent a credible single-binary or simpler-installer story
- [ ] Tauri/desktop startup becomes more fragile than the current `/api/version` sidecar flow
- [ ] The result is only “different packaging,” not clearly better reliability, maintainability, or shipping convenience

## TODOs

- [ ] 1. **Freeze the current contract baseline**
  **What**: Inventory every externally visible contract that the Go binary must preserve: HTTP endpoints, SSE event shapes, DB location/schema expectations, launcher behavior, Tauri startup/health flow, and install/update UX.
  **Files**: `README.md`, `src/app/api/**/route.ts`, `src/lib/api-types.ts`, `src/lib/api-client.ts`, `src/hooks/use-global-sse.ts`, `src/hooks/use-session-events.ts`, `scripts/launcher.sh`, `scripts/install.sh`, `scripts/install.ps1`, `src-tauri/src/lib.rs`
  **Acceptance**: A frozen compatibility matrix exists for frontend requests, SSE payloads, startup URLs, health checks, and DB paths.

- [ ] 2. **Prove static frontend artifact feasibility**
  **What**: Decide whether the current Next UI can be normalized into static assets or whether a SPA build target is cleaner. Explicitly document which Next features are blockers versus easy swaps.
  **Files**: `src/app/layout.tsx`, `src/app/client-layout.tsx`, `src/app/page.tsx`, `src/app/sessions/[id]/page.tsx`, `src/components/layout/sidebar.tsx`, `next.config.ts`, `package.json`, `src/proxy.ts`
  **Acceptance**: The team has a written yes/no decision between “static Next artifact” and “frontend build migration,” with a file-by-file blocker list.

- [ ] 3. **Define the Go target skeleton and ownership model**
  **What**: Specify the future Go module/package layout, subsystem boundaries, context tree, shutdown model, and shared-state ownership before any porting starts.
  **Files**: `go.mod`, `cmd/weave-fleet/main.go`, `internal/app/runtime.go`, `internal/http/router.go`, `internal/http/sse.go`, `internal/orchestrator/process_manager.go`, `internal/orchestrator/event_hub.go`, `internal/persistence/sqlite.go`, `internal/web/embed.go`
  **Acceptance**: Every planned long-lived goroutine has a named owner, context, termination path, error policy, and synchronization plan.

- [ ] 4. **Map current backend capabilities to Go migration slices**
  **What**: Break the current backend into porting slices: simple API endpoints, persistence, workspace management, process supervision, SSE/event hub, callback monitoring, analytics/token aggregation, and recovery logic.
  **Files**: `src/lib/server/process-manager.ts`, `src/lib/server/instance-event-hub.ts`, `src/lib/server/session-status-watcher.ts`, `src/lib/server/callback-monitor.ts`, `src/lib/server/callback-service.ts`, `src/lib/server/activity-emitter.ts`, `src/lib/server/database.ts`, `src/lib/server/db-repository.ts`, `src/lib/server/workspace-manager.ts`
  **Acceptance**: Each slice is tagged as “wrap first,” “reimplement directly,” or “defer until parity harness exists.”

- [ ] 5. **Decide whether an intermediate extracted Node backend is needed**
  **What**: Evaluate the optional middle step of moving backend hosting out of Next without yet moving to Go, solely as a boundary-hardening tactic.
  **Files**: `.weave/plans/backend-host-evaluation.md`, `src/lib/api-client.ts`, `src/proxy.ts`, `src/app/api/**/route.ts`
  **Acceptance**: The plan records a clear decision: “skip Node intermediate” or “use Node extraction first,” with explicit reasons and exit criteria.

- [ ] 6. **Design the Go API + SSE transport layer**
  **What**: Define how current Next routes map to Go handlers, including session SSE, global activity SSE, keepalive behavior, reconnect semantics, CORS/same-origin rules, and health/version endpoints.
  **Files**: `src/app/api/sessions/route.ts`, `src/app/api/sessions/[id]/events/route.ts`, `src/app/api/activity-stream/route.ts`, `src/app/api/version/route.ts`, `src/app/api/config/route.ts`, `src/app/api/skills/**`, `internal/http/router.go`, `internal/http/api/*.go`, `internal/http/sse.go`
  **Acceptance**: A route-by-route mapping exists with exact handler ownership and SSE semantics, including backpressure and disconnect behavior.

- [ ] 7. **Design the Go orchestration runtime with correctness guardrails**
  **What**: Port the behavioral contract of process supervision, event subscription, callback monitoring, analytics flushing, and recovery into an explicit Go runtime design that follows Go correctness invariants.
  **Files**: `src/lib/server/process-manager.ts`, `src/lib/server/instance-event-hub.ts`, `src/lib/server/session-status-watcher.ts`, `src/lib/server/callback-monitor.ts`, `src/lib/server/analytics-collector.ts`, `internal/orchestrator/process_manager.go`, `internal/orchestrator/event_hub.go`, `internal/callbacks/monitor.go`
  **Acceptance**: The design documents process-tree handling, bounded fan-out, shutdown sequencing, retry policy, and shared-state synchronization for all runtime loops.

- [ ] 8. **Choose and validate the SQLite strategy**
  **What**: Select the driver and migration approach that best preserve true single-binary viability and existing DB compatibility.
  **Files**: `src/lib/server/database.ts`, `src/lib/server/db-repository.ts`, `internal/persistence/sqlite.go`, `internal/persistence/migrations.go`
  **Acceptance**: The chosen driver is justified against binary portability, WAL/busy-timeout support, existing DB compatibility, and cross-platform packaging needs.

- [ ] 9. **Plan delivery and packaging cutover**
  **What**: Replace Node-centric release assumptions with Go-centric ones while preserving the current install flow and optional Tauri wrapper flow.
  **Files**: `package.json`, `scripts/assemble-standalone.sh`, `scripts/launcher.sh`, `scripts/install.sh`, `scripts/install.ps1`, `scripts/tauri-prebuild.mjs`, `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`
  **Acceptance**: The future artifact list is explicit for standalone, browser, and Tauri delivery, including whether each target is a true single binary or a single installer/bundle.

- [ ] 10. **Define the parity harness before cutover**
  **What**: Create the mandatory automated/manual verification matrix that compares current behavior to the Go target for frontend delivery, API behavior, orchestration, SSE, callbacks, persistence, startup UX, and packaging.
  **Files**: `package.json`, `src/lib/server/__tests__/process-manager.test.ts`, `src/lib/server/__tests__/session-status-watcher.test.ts`, `src/lib/server/__tests__/callback-monitor.test.ts`, `src/lib/server/__tests__/database.test.ts`, `src/lib/server/__tests__/v2-verification.test.ts`, `src/lib/server/__tests__/v2-integration.test.ts`, `go.mod`, `internal/**`, `scripts/*`, `src-tauri/src/lib.rs`
  **Acceptance**: No cutover is allowed without passing the defined gates, including the explicit **single-binary convenience parity** gate.

- [ ] 11. **Run a narrow Go spike before approving full migration**
  **What**: Build only the hardest proof slice first: embedded frontend serving, `/api/version` + `/healthz`, one session API path, one per-session SSE path, one OpenCode process supervision path, and DB open/migration compatibility.
  **Files**: `cmd/weave-fleet/main.go`, `internal/http/router.go`, `internal/http/sse.go`, `internal/orchestrator/process_manager.go`, `internal/persistence/sqlite.go`, `internal/web/embed.go`, `frontend-dist/**`
  **Acceptance**: The spike proves the approach end-to-end without committing to a full rewrite.

- [ ] 12. **Make the go / no-go decision with hard evidence**
  **What**: Decide whether to proceed, pause, or reject based on the spike, parity matrix, packaging impact, and maintenance cost.
  **Files**: `.weave/plans/single-go-binary-evaluation.md`
  **Acceptance**: The decision cites concrete evidence for frontend feasibility, runtime correctness, delivery simplicity, and parity risk.

## Verification
- [ ] All tests pass
- [ ] No regressions
- [ ] `npm run test` passes against the current baseline
- [ ] `npm run typecheck` and `npm run lint` pass for the remaining frontend/TS code
- [ ] `go test ./... -race` passes for the Go target
- [ ] `go vet ./...` is clean
- [ ] Frontend assets are served correctly from the Go binary
- [ ] API behavior matches the frozen contract baseline
- [ ] Orchestration, recovery, and shutdown behavior match current expectations
- [ ] SSE fan-out, keepalive, reconnect, and disconnect cleanup are verified
- [ ] Callback delivery, fallback polling, and deduplication are verified
- [ ] Existing SQLite data opens and migrates safely
- [ ] Startup UX remains equal or better for browser and Tauri flows
- [ ] Packaging validation completes on macOS, Linux, and Windows
- [ ] **Single-binary convenience parity** is explicitly confirmed before any default cutover
