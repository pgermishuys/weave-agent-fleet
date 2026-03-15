# Server Tab → Session Grid Filter Sync

## TL;DR
> **Summary**: Wire the sidebar server tabs to the existing `activeServerFilter` state in `page.tsx` via the `FleetConnectionContext`, so clicking a server tab automatically filters the session grid and keeps toolbar filter pills in sync. Remove the now-redundant toolbar pills once the tabs become the primary filter surface.
> **Estimated Effort**: Short

## Context
### Original Request
When a user clicks a server/connection in the sidebar server tabs, the main session grid should automatically filter to show only sessions from that server. Clicking "Local" shows only local sessions. There must be a way to see all sessions across all servers.

### Key Findings

**Two parallel filter surfaces exist today — neither is wired to the other:**

| Surface | Where | Drives |
|---|---|---|
| Sidebar server tabs (`fleet-server-tabs.tsx`) | Sidebar | `activeConnection` in `FleetConnectionContext` (only affects sidebar workspace tree) |
| Toolbar filter pills (`fleet-toolbar.tsx` lines 107–152) | Main content | `activeServerFilter` state in `page.tsx` (actually filters the session grid) |

**`FleetConnectionContext` (`fleet-connection-context.tsx`)**
- Stores `activeConnection: FleetConnection` (read from localStorage via registry)
- `setActiveConnection(id)` writes to localStorage, re-reads state — both sidebar and any context consumer react
- Currently the only consumer that reacts to `activeConnection` is the sidebar workspace tree label

**`page.tsx` filter chain**
- `activeServerFilter` is plain `useState` (line 53), default `"all"`
- Filter logic (lines 128–134): filters `workspaceFiltered` where `connectionId ?? "local" === activeServerFilter`
- `sessionCounts` (lines 149–156) counts per-connection for toolbar pill badges
- `setActiveServerFilter` is passed to `FleetToolbar` as `onServerFilterChange`

**Toolbar pills visibility rule** (`fleet-toolbar.tsx` line 98): only rendered when `connections.length >= 2`

**Sidebar tabs visibility rule** (`fleet-server-tabs.tsx` line 38): hidden when `connections.length < 2`; ghost "Connect a server" tab shown when exactly 1 connection

**Session data**: `SessionListItem.connectionId?: string` — `undefined` means local; `"local"` is the sentinel used by the filter

**`activeConnection` in context vs filter**: `activeConnection.id` is the connection id string (e.g. `"local"`, `"work-server"`). The filter expects `"all"` or a connection id. The `LOCAL_CONNECTION.id` is `"local"`, which matches the `"local"` sentinel used in filtering.

**Edge cases identified:**
1. Connection removed while it is the active filter → `removeConnection` in registry already falls back to `"local"` for `activeConnectionId`, but `activeServerFilter` state in page would be stale
2. Single-connection (local only) setup → toolbar pills hidden, tabs show ghost → no multi-server UI needed
3. "All servers" concept → needs an explicit entry in the tab row (no equivalent in sidebar tabs today)

---

## Objectives
### Core Objective
Clicking a sidebar server tab should immediately filter the session grid to show only that server's sessions, while keeping toolbar pills (if shown) in sync. An "All Servers" entry must be accessible.

### Deliverables
- [ ] `FleetConnectionContext` exposes an `activeServerFilter` value (`"all" | string`) and a setter, so any component can read or change the session filter
- [ ] Sidebar server tabs: clicking a tab sets the server filter; an "All" tab is added for 2+ connections
- [ ] Toolbar filter pills: removed (superseded by sidebar tabs), keeping search/group/sort controls intact
- [ ] `page.tsx`: reads `activeServerFilter` from context instead of local `useState`
- [ ] Connection-removed guard: if the active filter connection is removed, the filter resets to `"all"`
- [ ] Single-connection path unchanged: no "All" tab, no pills, ghost tab still shown

### Definition of Done
- [ ] `pnpm build` (or `next build`) completes with zero TypeScript errors
- [ ] With 2+ connections: clicking a server tab in the sidebar changes which sessions appear in the main grid
- [ ] With 2+ connections: clicking the "All" tab in the sidebar shows all sessions
- [ ] Toolbar search / group / sort still work correctly after filter change
- [ ] Removing the active filter connection resets the grid to "All"
- [ ] With only 1 connection (Local): ghost tab shown, grid shows all (local) sessions, no pills in toolbar

### Guardrails (Must NOT)
- Do not break the `?workspace=…` URL filter — server filter is applied after workspace filter, this must be preserved
- Do not remove the search, group-by, or sort-by controls from the toolbar
- Do not change the `FleetConnectionRegistry` (localStorage layer)
- Do not change how `activeConnection` drives the sidebar workspace tree label

---

## TODOs

- [x] 1. Add `activeServerFilter` + `setActiveServerFilter` to `FleetConnectionContext`
  **What**: Extend the context value interface and provider state with `activeServerFilter: string | "all"` and `setActiveServerFilter: (id: string | "all") => void`. Initial value: `"all"`. Add a `useEffect` inside the provider that resets to `"all"` whenever a connection is removed and the current filter matches the removed id (detect via a side-effect on `connections` list change).
  **Files**:
  - `src/contexts/fleet-connection-context.tsx` — add `activeServerFilter` state, `setActiveServerFilter` callback, reset effect, and include both in the context value object
  **Acceptance**: TypeScript compiles; `useFleetConnections().activeServerFilter` returns `"all"` on initial render; calling `setActiveServerFilter("some-id")` updates the value reactively

- [x] 2. Remove `activeServerFilter` local state from `page.tsx` and read from context
  **What**: Delete the `const [activeServerFilter, setActiveServerFilter] = useState<string | "all">("all")` line (line 53). Replace with `const { activeServerFilter, setActiveServerFilter } = useFleetConnections()`. The rest of the filter chain (`serverFiltered`, `sessionCounts`) remains unchanged — they already consume `activeServerFilter` by name.
  **Files**:
  - `src/app/page.tsx` — remove useState import for this piece of state; destructure from `useFleetConnections()`
  **Acceptance**: Page compiles; selecting a pill in the toolbar still filters the grid correctly (regression check before tabs are updated)

- [x] 3. Update `FleetServerTabs` to drive the server filter
  **What**: When 2+ connections exist, add an "All" tab as the first entry that calls `setActiveServerFilter("all")`. Each existing connection tab should call `setActiveServerFilter(conn.id)` in addition to (or instead of — see note) `setActiveConnection(conn.id)`. Highlight the active tab based on `activeServerFilter` instead of (or alongside) `activeConnection.id`.
  - The "All" tab: icon can be a `LayoutGrid` or `Globe` lucide icon, label "All"
  - Active state check: `activeServerFilter === "all"` for the All tab; `activeServerFilter === conn.id` for connection tabs
  - Keep calling `setActiveConnection(conn.id)` so the sidebar workspace tree label continues to update correctly
  - Single-connection path (ghost tab): no changes needed to that branch
  **Files**:
  - `src/components/layout/fleet-server-tabs.tsx` — import `setActiveServerFilter` from `useFleetConnections()`; add "All" tab; update `onClick` handlers; update `isActive` logic
  **Acceptance**: With 2+ connections, clicking a tab updates `activeServerFilter` in context and the grid visibly re-filters; "All" tab shows all sessions; active tab is visually highlighted correctly

- [x] 4. Remove toolbar server filter pills from `FleetToolbar`
  **What**: Delete the pill section (lines 107–152 in `fleet-toolbar.tsx`): the `{isMultiServer && onServerFilterChange && ( ... )}` block. Remove the `activeServerFilter`, `onServerFilterChange`, and `sessionCounts` props from the `FleetToolbarProps` interface, their defaults in the function signature, and the `isMultiServer` const.
  **Files**:
  - `src/components/fleet/fleet-toolbar.tsx` — remove pill JSX block, remove three interface props, remove `isMultiServer` const, remove unused `useFleetConnections` import if no longer needed
  **Acceptance**: Toolbar renders only search + group-by + sort-by; no TypeScript errors

- [x] 5. Clean up `page.tsx` prop-passing to `FleetToolbar`
  **What**: Remove the `activeServerFilter`, `onServerFilterChange`, and `sessionCounts` props from the `<FleetToolbar ... />` call (lines 501–503) now that they are no longer accepted. Remove the `sessionCounts` useMemo block (lines 149–156) if it has no other consumers.
  **Files**:
  - `src/app/page.tsx` — remove three props from `<FleetToolbar>`; remove `sessionCounts` useMemo
  **Acceptance**: Page compiles with no unused variable warnings; `FleetToolbar` renders correctly without those props

- [x] 6. Guard: reset filter when active connection is removed
  **What**: In the `FleetConnectionContext` provider, add a `useEffect` that watches `connections`. If `activeServerFilter` is not `"all"` and is not present in the current `connections` list, call `setActiveServerFilter("all")`. This handles the case where a remote server is deleted while its tab is the active filter.
  **Files**:
  - `src/contexts/fleet-connection-context.tsx` — add `useEffect([connections, activeServerFilter])` guard (can be done in the same edit as TODO #1 if both are tackled together)
  **Acceptance**: Adding a connection, setting it as active filter, then removing it via the "Remove" dialog resets the grid to "All" sessions automatically

---

## Verification
- [x] `pnpm build` passes (zero TypeScript errors, zero lint errors)
- [x] Single-connection mode: no regressions — ghost tab visible, grid shows local sessions, toolbar has no pills
- [x] Multi-server mode: sidebar tabs drive grid filter; "All" tab restores full list
- [x] Workspace URL filter (`?workspace=…`) still narrows sessions before the server filter is applied
- [x] Search, group-by, and sort-by still work in combination with the server tab filter
- [x] Removing active-filter connection resets grid to "All"
