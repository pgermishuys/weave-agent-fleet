# Multi-Fleet UX Design — Findings

> Date: 2026-03-14
> Status: Design Decisions / Pre-Implementation
> Scope: UX and UI design for connecting, switching between, and managing multiple Fleet Server instances from a single client

---

## Goal

A user running Fleet in the default monolithic mode (UI + API in one process) should experience zero change. When they register a second fleet server, the UI should expand naturally to support it — no new mental model, no new design language, just the existing sidebar promoted to carry more meaning.

---

## Sidebar Layout

The left sidebar is where all fleet server management lives. It is composed of three distinct zones, each with a single clear job:

```
┌─────────────────────────────┐
│  ⚡ Work Server    ●  [···] │  ← Fleet header: current server identity + management
│  v1.2.0 · worktree, clone   │    (muted: version + capabilities)
├─────────────────────────────┤
│  Local  │  Work  │  Cloud   │  ← Server tabs: switching only
├─────────────────────────────┤
│  Sessions              [+]  │  ← Session list: existing behaviour, unchanged
│  · my-project               │    [+] starts a new session on the current server
│  · another-thing            │
└─────────────────────────────┘
```

### Zone 1: Fleet Header (repurposed from static label)

Currently a static logo/label. Promoted to show **live identity of the currently selected server**, sourced directly from `GET /api/fleet/identity`:

- **Name** — as reported by the server (`FLEET_NAME` env var), e.g. "Work Server"
- **Status dot `●`** — green (connected), grey (unreachable), red (auth error). Passive most of the time; on hover shows a tooltip with last-seen time or latency.
- **`···` menu** — server management actions (see below). This is the only place server registration/editing lives.
- **Subtitle line** — version + capabilities, muted text. e.g. "v1.2.0 · worktree, clone". For Local: just "Local" or omitted entirely.

The header is contextual — it updates immediately when the active tab changes.

### Zone 2: Server Tabs

A tab row directly below the header. Tabs are the **only** mechanism for switching between fleet servers — no dropdown, no other switcher.

- One tab per registered server
- Active tab is highlighted (existing nav component styling)
- **Local** tab is always first, always present, cannot be removed
- Switching tabs: updates the header (Zone 1) and the session list (Zone 3)
- The tab row only appears when **2 or more servers are registered** — single-server users see no tab row at all, preserving the current zero-config experience
- Tab labels should be kept short (user-defined display name). A small house/computer icon on the Local tab distinguishes it visually from remote servers at a glance.

**First-use discoverability**: when only Local exists and no servers have been added yet, a ghost/dashed tab appears next to Local:

```
│  Local  │ + Connect a server │
```

Once a second server is registered this ghost tab disappears and the `···` menu in the header is the path to adding more. The ghost tab solves new-user discoverability without cluttering the experienced-user UI.

### Zone 3: Session List

Unchanged from today. The `[+]` button starts a new session. Its behaviour extends slightly for multi-fleet (see New Session section below), but the button itself and its location do not change.

---

## The `···` Menu (Server Management)

Located in the Fleet header, right side. Opens a small dropdown menu:

| Item | Behaviour |
|------|-----------|
| **Add Fleet Server** | Opens the Add Server dialog |
| **Edit "{current server name}"** | Opens the Edit dialog pre-filled with current server's details |
| **Remove "{current server name}"** | Removes the current server after confirmation. Disabled/hidden when Local is active — Local cannot be removed. |

The menu is scoped to the **currently active server** for Edit and Remove. Add is always available regardless of which tab is active.

---

## Adding / Registering a New Fleet Server

Triggered from `···` → "Add Fleet Server". Opens a centered modal dialog (matching the existing New Session dialog style).

### Fields

| Field | Notes |
|-------|-------|
| **Display Name** | Free text. Pre-filled from the server's reported `name` after the test connection succeeds. User can override. |
| **URL** | e.g. `https://dev.company.com:3000` |
| **API Key** | Password input, masked. Small muted note beneath: *"Stored in browser local storage. Use the desktop app for secure key storage."* — unobtrusive disclosure, not a warning dialog. |

### Connection Test (inline, on "Connect" click)

Before saving, the client calls `GET /api/fleet/identity` with the provided URL and API key:

- ✅ **Success**: Shows an inline confirmation — server's reported name, version, capabilities. e.g. *"Connected to **work-server** v1.2.0 · supports worktree, clone"* with a green dot. The Display Name field is pre-filled with the server's reported name (user can still edit it).
- ❌ **Auth failure**: "Invalid API key — check the key and try again."
- ❌ **Unreachable**: "Could not reach server at that URL — check the URL and your network."

The user confirms → connection saved → new tab appears in the sidebar and becomes active immediately. The header updates to show the new server's identity.

### Edit Flow

Same dialog, pre-filled. Re-runs the connection test on save to confirm the updated credentials still work.

### Remove Flow

Confirmation dialog: *"Remove {name}? Any sessions on this server will no longer be visible."* Destructive action styled accordingly. Does not delete anything on the server — only removes the local registry entry.

---

## Credential Storage

| Client | Storage |
|--------|---------|
| Web UI | `localStorage` — disclosed in the Add Server dialog |
| Tauri desktop | OS keychain (macOS Keychain, Windows Credential Manager) |
| CLI | `~/.weave/connections.json` — file permissions `600` |

The connection registry stores: `name`, `url`, `status` (runtime only, not persisted). The API key is stored separately in the appropriate secure store per client type.

For the web UI, the `name` and `url` are persisted in `localStorage`. The API key is also in `localStorage` for MVP — the disclosure note in the dialog sets expectations. This matches the approach of common self-hosted tools (Grafana, Portainer, etc.) and is acceptable for the self-hosted audience.

---

## The Local Server

- Always the first tab
- Always present — cannot be removed
- Display name: "Local" (fixed, not editable via fleet identity — it is the built-in server)
- No URL or API key fields shown in any dialog
- In the fleet header, the subtitle shows version only (no remote URL)
- Represents the server running in the same process as the UI (default monolithic mode) or `http://localhost:3000` in split mode

---

## Starting a New Session (Multi-Fleet)

The `[+]` button opens the New Session dialog. Its behaviour depends on how many servers are registered:

### Single server (Local only)
No change from today. No server selector shown.

### Two or more servers registered
A **Fleet Server selector** appears at the top of the New Session dialog — defaults to the **currently active tab's server**. This means if you're viewing the Work Server tab and click `[+]`, the dialog opens already scoped to Work Server. Natural, zero extra clicks for the common case.

```
┌─ New Session ────────────────────────────────┐
│                                               │
│  Fleet Server   [ Work Server ▾ ]             │
│                                               │
│  Directory    [/projects/foo            📁]  │
│                                               │
│  Prompt       [................................│
│               ]                               │
│                                        [Start]│
└───────────────────────────────────────────────┘
```

**Server switching within the dialog**: switching the server selector clears the directory field and re-initialises the directory browser pointed at the newly selected server (calling `/api/directories` on that server). This accurately represents that you are now browsing a different machine's filesystem.

**Default server memory**: the last-used server is remembered **per workspace directory** — if you always run `/projects/foo` sessions on Work Server, that pairing is remembered and pre-selected next time you type that directory. For new/unrecognised directories, default to the currently active tab's server.

**Remote directory browser**: the directory picker calls `/api/directories` on the selected server, not the local machine. This works identically to the existing local directory browser — same component, different API base URL (scoped to the selected connection).

---

## Fleet Overview Page (Unified View)

The main overview grid shows sessions from **all connected servers** by default (unified mode). A filter bar at the top allows scoping to a single server:

```
[ All Servers ]  [ Local · 2 active ]  [ Work Server · 5 active ]  [ Cloud Runner · offline ]
```

- Each session card carries a small server badge (coloured dot or short name tag) identifying which server it belongs to
- Sessions from offline servers show greyed out with a "Server unreachable" state — they are not removed, they persist showing last known state
- When the server reconnects, cards restore to normal state automatically
- Switching server tabs in the sidebar also updates the overview filter to match (the two stay in sync)

---

## Connection Health

**Status dot in the Fleet header** — the primary health indicator. Always visible, always reflects the current server.

- 🟢 Green — connected, responding normally
- ⚪ Grey — unreachable (network, server down)
- 🔴 Red — reachable but auth error (key rotated or revoked)

On hover: tooltip shows last successful connection time, or latency.

**Behaviour on disconnect**:
- Sessions from the offline server remain visible, greyed, with "Server unreachable" state
- The client attempts reconnection with exponential backoff (via SSE reconnection + health poll)
- When the server comes back online, the status dot returns to green and sessions restore to live state
- No manual "reconnect" button needed for normal transient disconnects — it's automatic

**Long-term offline**: no special handling in MVP. A server that has been offline for days still shows its last-known sessions. Future consideration: a stale threshold after which sessions collapse to a "server offline" summary row.

---

## Component Reuse

All of this builds on existing components — no new design language:

| New need | Reuses |
|----------|--------|
| Server tabs | Existing sidebar nav tab components |
| Fleet header (promoted) | Existing Fleet header — same element, more content |
| `···` menu | Standard dropdown menu component (already used elsewhere) |
| Add/Edit Server dialog | Same centered modal pattern as New Session dialog |
| Server selector in New Session | Same dropdown/select pattern as existing form fields |
| Remote directory browser | Same directory browser component — different API base URL |
| Status dot | New, but trivial — coloured dot + tooltip |

The only genuinely new component is the status dot with tooltip. Everything else is existing components composed differently.

---

## What Does Not Change for Single-Server Users

- No tab row visible
- Fleet header label stays as **"Fleet"** — only switches to showing the server name once a second server is registered. The `···` menu is the only new addition; for Local it contains only "Add Fleet Server".
- New Session dialog unchanged — no server selector shown
- Overview page unchanged — no filter pills shown
- Zero new UI surface until a second server is registered

---

## Local Token Injection (Monolithic Mode)

**The problem**: all API endpoints are now protected by bearer token auth (see `serve-command.md`). For a remote user this is fine — they register the server with their token via the Add Server dialog. But for a local user running the default monolithic mode (UI + API in one process), requiring them to manually authenticate against their own local server would be absurd friction.

**The solution: token injection via server-rendered HTML (Option C)**

When the server starts in monolithic mode, it already knows the token — it generated or loaded it at startup. It injects the token directly into the initial HTML page response as a `window` global:

```html
<script>window.__FLEET_TOKEN__ = "abc123...";</script>
```

The UI reads `window.__FLEET_TOKEN__` on load and holds it in memory. `api-client.ts` includes it as a `Bearer` token on all API calls automatically. The token is never written to `localStorage` — it lives only in the page's memory for the lifetime of the tab.

**Why this is safe**: the injected token is only present in HTML served by the local process itself. A remote user browsing to a Fleet server they've connected to would not receive a token via this mechanism — the server only injects the token when serving its own UI from the same process.

**The result for the local user**: Fleet starts, browser opens, everything works exactly as today. The token injection is entirely invisible. No registration flow, no copy-paste, no setup.

### Auth Mode Matrix

| Mode | Auth behaviour |
|------|---------------|
| `npm run dev` | `FLEET_AUTH_DISABLED=true` — no auth, works as today |
| `weave-fleet` (monolithic, local user) | Token injected into page HTML — transparent, no user action |
| `weave-fleet serve` (remote server) | Token printed once at startup — user registers via Add Server dialog |

All three cases work without friction for their intended audience.
