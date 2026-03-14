# Plan: Multi-Fleet UI

> Status: Completed
> Scope: Client-side UI for connecting to, switching between, and managing multiple Fleet Server instances. No server-side work — UI only.

---

## TL;DR

- Add a `FleetConnectionRegistry` (localStorage-backed) that holds named connections; Local is always built-in and reads its token from `window.__FLEET_TOKEN__`
- Evolve `apiFetch` to be connection-aware — all existing callers continue to work unchanged
- Promote the sidebar Fleet header to show live server identity + `···` management menu; add a server tab row (hidden until 2+ servers)
- Add Add/Edit/Remove Server dialogs following the `install-skill-dialog` pattern
- Add a server selector to the New Session dialog (hidden until 2+ servers)
- Add server filter pills to the Fleet overview toolbar (hidden until 2+ servers)

---

## Phase 1 — Connection Registry (foundation)

- [x] **1. Create `src/lib/fleet-connection-registry.ts`**
  - Define the `FleetConnection` type:
    ```ts
    export type ConnectionStatus = "online" | "offline" | "connecting" | "error";

    export interface FleetConnection {
      id: string;           // unique slug, e.g. "local", "work-server"
      name: string;         // display name
      url: string;          // base URL, e.g. "http://localhost:3000"
      token?: string;       // bearer token — undefined for Local (read from window)
      status: ConnectionStatus; // runtime only, not persisted
      isLocal: boolean;     // true only for the built-in Local connection
    }
    ```
  - Define `FleetConnectionRegistry` class with:
    - `getConnections(): FleetConnection[]` — Local always first
    - `getActiveConnection(): FleetConnection`
    - `setActiveConnection(id: string): void` — persists to localStorage
    - `addConnection(conn: Omit<FleetConnection, "status">): void` — persists to localStorage
    - `removeConnection(id: string): void` — throws if `isLocal`; persists
    - `updateConnection(id: string, patch: Partial<Omit<FleetConnection, "id" | "isLocal" | "status">>): void`
    - `setConnectionStatus(id: string, status: ConnectionStatus): void` — runtime only, no persist
    - `getTokenForConnection(id: string): string | undefined` — for Local: reads `window.__FLEET_TOKEN__` fresh each time, never localStorage
  - Local connection is always injected at index 0; its `url` defaults to `""` (relative, same-origin); its `token` is never stored
  - localStorage keys: `weave:fleet:connections` (array without Local), `weave:fleet:activeConnectionId`
  - Export a singleton: `export const connectionRegistry = new FleetConnectionRegistry()`
  - **Acceptance**: TypeScript compiles; Local connection always present in `getConnections()`; `window.__FLEET_TOKEN__` is read fresh on every `getTokenForConnection("local")` call and never written to localStorage

- [x] **2. Create `src/contexts/fleet-connection-context.tsx`**
  - `"use client"` context wrapping `connectionRegistry`
  - Exposes via context value:
    ```ts
    interface FleetConnectionContextValue {
      connections: FleetConnection[];
      activeConnection: FleetConnection;
      setActiveConnection: (id: string) => void;
      addConnection: (conn: Omit<FleetConnection, "status">) => void;
      removeConnection: (id: string) => void;
      updateConnection: (id: string, patch: Partial<...>) => void;
    }
    ```
  - Uses `useState` seeded from `connectionRegistry`; mutations call both registry methods and `setState` to trigger re-renders
  - Mount in `src/app/client-layout.tsx`: wrap the existing provider tree with `<FleetConnectionProvider>` as the outermost provider (outside `ThemeProvider` is fine, but inside is also fine — just outermost of the Weave providers)
  - **Acceptance**: `npm run typecheck` passes; context available anywhere in the tree

- [x] **3. Create `src/hooks/use-fleet-connections.ts`**
  - Thin hook: `export function useFleetConnections(): FleetConnectionContextValue { return useContext(FleetConnectionContext); }`
  - **Acceptance**: Compiles; returns the full context value

---

## Phase 2 — Connection-Aware API Client

- [x] **4. Evolve `src/lib/api-client.ts`**
  - Add optional `connectionId` parameter to `apiFetch` and `apiUrl`:
    ```ts
    export function apiUrl(path: string, connectionId?: string): string
    export function apiFetch(path: string, init?: RequestInit, connectionId?: string): Promise<Response>
    ```
  - When `connectionId` is omitted: use existing behaviour (relative URL, no auth header) — **all existing callers continue to work unchanged**
  - When `connectionId` is provided: look up the connection in `connectionRegistry`, build absolute URL from `connection.url + path`, inject `Authorization: Bearer <token>` header if a token exists
  - `sseUrl` gains the same optional `connectionId` param
  - The `connectionRegistry` singleton is imported directly (no React context needed here — this is a plain module)
  - **Acceptance**: `npm run typecheck` passes; existing callers that omit `connectionId` behave identically to today; a call with a remote `connectionId` uses the correct base URL and auth header

- [x] **5. Add `connectionId` param to `src/hooks/use-directory-browser.ts`**
  - Add optional `connectionId?: string` to the hook's params
  - Pass it through to the `apiFetch` call: `apiFetch(url, { signal: controller.signal }, connectionId)`
  - Default: `undefined` (Local, existing behaviour)
  - **Acceptance**: `npm run typecheck` passes; existing callers unchanged

- [x] **6. Add `connectionId` prop to `src/components/session/directory-picker.tsx`**
  - Add optional `connectionId?: string` to `DirectoryPickerProps`
  - Pass it to `useDirectoryBrowser(popoverOpen, connectionId)`
  - Default: `undefined`
  - **Acceptance**: `npm run typecheck` passes; existing callers unchanged

---

## Phase 3 — Connection Health

- [x] **7. Create `src/hooks/use-fleet-identity.ts`**
  - Fetches `GET /api/fleet/identity` for a given connection:
    ```ts
    export interface FleetIdentity {
      name: string;
      version: string;
      description: string;
      capabilities: string[];
    }
    export function useFleetIdentity(connectionId: string): {
      identity: FleetIdentity | null;
      isLoading: boolean;
      error: string | undefined;
    }
    ```
  - Uses `apiFetch("/api/fleet/identity", undefined, connectionId)`
  - Fetches once on mount; re-fetches when `connectionId` changes
  - **Acceptance**: `npm run typecheck` passes; returns `null` while loading or on error

- [x] **8. Create `src/hooks/use-connection-health.ts`**
  - Polls `GET /api/fleet/identity` per connection on a 30-second interval
  - On success: calls `connectionRegistry.setConnectionStatus(id, "online")` and triggers a React re-render via a counter state
  - On failure: calls `connectionRegistry.setConnectionStatus(id, "offline")` (or `"error"` for 401)
  - Returns nothing (side-effect only hook)
  - Called once at the app root (e.g. inside `FleetConnectionProvider`) covering all registered connections
  - Uses `AbortController` for cleanup on unmount/interval clear
  - **Acceptance**: Status dot in the sidebar updates to grey when a server is unreachable; returns to green when it comes back

---

## Phase 4 — Sidebar: Fleet Header + Server Tabs

- [x] **9. Create `src/components/layout/fleet-server-tabs.tsx`**
  - Renders a horizontal tab row, one tab per connection
  - Tabs use existing sidebar nav styling (match the `isFleetActive` active/inactive classes from `sidebar.tsx`)
  - Local tab gets a small `Home` icon (lucide `Home` or `Monitor`) to distinguish it visually
  - Active tab is the `activeConnection.id` from `useFleetConnections()`
  - Clicking a tab calls `setActiveConnection(id)`
  - Status dot per tab: `●` coloured by `connection.status` — green (`text-green-500`) for online, grey (`text-muted-foreground`) for offline/connecting, red (`text-red-500`) for error
  - **Hidden when only 1 connection** — `if (connections.length < 2) return null`
  - Ghost tab: when `connections.length === 1`, render alongside Local:
    ```
    | Local  | + Connect a server |
    ```
    The ghost tab is a dashed-border button that opens the Add Server dialog. Disappears once 2+ real connections exist.
  - **Acceptance**: Tab row hidden for single-server users; appears immediately when a second connection is added; clicking a tab updates `activeConnection`

- [x] **10. Modify `src/components/layout/sidebar.tsx` — Fleet header promotion**
  - Import `useFleetConnections` and `MoreHorizontal` (lucide) and `DropdownMenu` components
  - In the expanded Fleet header row (lines 229–266), replace the static `"Fleet"` label with dynamic content:
    - **Single server** (`connections.length < 2`): keep label `"Fleet"` — zero visible change for existing users. Show `···` menu containing only "Add Fleet Server".
    - **Multi-server** (`connections.length >= 2`): show `activeConnection.name` + status dot `●`
  - Add `···` button (using `DropdownMenu`) on the right side of the Fleet header row:
    - "Add Fleet Server" — opens `AddServerDialog` (always shown)
    - "Edit \"{name}\"" — opens `AddServerDialog` in edit mode (hidden when Local is active)
    - "Remove \"{name}\"" — opens `RemoveServerDialog` (hidden when Local is active)
  - Render `<FleetServerTabs />` directly below the Fleet header row, before the workspace tree
  - Collapsed sidebar: no changes needed — the icon-only collapsed view is unchanged
  - **Acceptance**: Single-server users see no new UI except the `···` menu button; multi-server users see the active server name and status dot

---

## Phase 5 — Add / Edit / Remove Server Dialogs

- [x] **11. Create `src/components/fleet/add-server-dialog.tsx`**
  - Modal dialog following the `install-skill-dialog.tsx` pattern (Dialog + DialogHeader + DialogFooter, loading/error/success states)
  - Props: `open: boolean`, `onOpenChange: (open: boolean) => void`, `editConnection?: FleetConnection` (if provided, dialog is in edit mode, pre-filled)
  - Fields:
    - **URL** — `Input`, e.g. `https://dev.company.com:3000`
    - **API Key** — `Input` with `type="password"`, masked
    - **Display Name** — `Input`, pre-filled from server identity after test; user can override
  - "Connect" / "Save" button flow:
    1. Set loading state
    2. Call `fetch(url + "/api/fleet/identity", { headers: { Authorization: "Bearer " + token } })`
    3. On success: pre-fill Display Name from `identity.name`; show inline confirmation with server name, version, capabilities (green dot)
    4. On auth failure (401): show "Invalid API key — check the key and try again."
    5. On network error: show "Could not reach server at that URL — check the URL and your network."
    6. User clicks "Save" (enabled only after successful test): calls `addConnection` or `updateConnection` from `useFleetConnections()`, closes dialog
  - Disclosure note below API Key field: *"Stored in browser local storage. Use the desktop app for secure key storage."* — `text-[10px] text-muted-foreground`
  - Cancel button resets state and closes
  - **Acceptance**: Dialog validates connection before saving; inline error messages match spec; new connection appears as a sidebar tab immediately after save

- [x] **12. Create `src/components/fleet/remove-server-dialog.tsx`**
  - Uses existing `AlertDialog` component (`src/components/ui/alert-dialog.tsx`)
  - Props: `open: boolean`, `onOpenChange: (open: boolean) => void`, `connection: FleetConnection`
  - Message: *"Remove {connection.name}? Any sessions on this server will no longer be visible."*
  - Destructive confirm button calls `removeConnection(connection.id)` from `useFleetConnections()`, then closes
  - Cancel button closes without action
  - **Acceptance**: Confirmation dialog matches spec; connection and its tab are removed immediately after confirm

---

## Phase 6 — New Session Dialog: Server Selector

- [x] **13. Modify `src/components/session/new-session-dialog.tsx`**
  - Import `useFleetConnections` and `Select` component (check existing usage in the codebase, or use a `<select>` element styled to match if no shadcn Select is present)
  - Add state: `const [selectedConnectionId, setSelectedConnectionId] = useState<string>(activeConnection.id)`
  - When dialog opens: default `selectedConnectionId` to `activeConnection.id`
  - **Show server selector only when `connections.length >= 2`** — single-server users see no change
  - Server selector renders above the Directory field:
    ```
    Fleet Server   [ Work Server ▾ ]
    ```
  - When server selector changes:
    - Update `selectedConnectionId`
    - Clear `directory` field: `setDirectory("")`
    - The `DirectoryPicker` re-initialises because `connectionId` prop changes
  - Pass `connectionId={selectedConnectionId}` to `<DirectoryPicker />`
  - Pass `connectionId` to `useCreateSession` (or include it in the session creation payload — check `useCreateSession`'s API; if it calls `apiFetch("/api/sessions", ...)`, pass the `connectionId` as the third arg)
  - **Last-used server memory**: use `usePersistedState` with key `weave:new-session:lastServer:{directory}` — on directory change, look up and pre-select the remembered server for that directory
  - **Acceptance**: Single-server users see no change; multi-server users see the server selector defaulting to the active tab's server; switching server clears the directory field

---

## Phase 7 — Overview Page: Server Filter Pills

- [x] **14. Modify `src/components/fleet/fleet-toolbar.tsx`**
  - Import `useFleetConnections`
  - Add `activeServerFilter: string | "all"` and `onServerFilterChange: (id: string | "all") => void` to `FleetToolbarProps`
  - **Show filter pills only when `connections.length >= 2`** — single-server users see no change
  - Render pill row above (or inline with) the existing search/group/sort controls:
    ```
    [ All Servers ]  [ Local · 2 ]  [ Work Server · 5 ]
    ```
    - Session counts per pill are passed in via props or derived from the sessions list (pass a `sessionCounts: Record<string, number>` prop)
    - Active pill is highlighted (solid background); inactive pills are outlined
    - Offline connections show their name greyed out: `[ Cloud Runner · offline ]`
  - The parent page (fleet overview) is responsible for filtering the session list based on `activeServerFilter`
  - **Acceptance**: Pills hidden for single-server users; clicking a pill filters sessions to that server; "All Servers" shows all

- [x] **15. Wire server filter in the fleet overview page**
  - Find the fleet overview page (likely `src/app/page.tsx` or `src/components/fleet/fleet-page.tsx`) — read the file to confirm
  - Add `activeServerFilter` state: `useState<string | "all">("all")`
  - Pass `activeServerFilter` and `onServerFilterChange` to `<FleetToolbar />`
  - Filter the `sessions` array before passing to the session grid: when `activeServerFilter !== "all"`, keep only sessions where `session.connectionId === activeServerFilter`
  - Note: sessions from the current single-server implementation have no `connectionId` — for Phase 7 MVP, sessions from Local have an implicit `connectionId: "local"`. Add this mapping where sessions are consumed.
  - **Acceptance**: Filter pills correctly scope the session grid; "All Servers" restores the full list

---

## Verification

- [x] **16. Type-check and lint**
  - Run `npm run typecheck` — must pass with zero errors
  - Run `npm run lint` — must pass

- [ ] **17. Single-server regression check**
  - With no connections other than Local: verify no new UI elements appear (no tabs, no server selector in New Session dialog, no filter pills in overview, Fleet header still shows "Fleet")
  - The `···` menu button in the Fleet header is the only new element visible to single-server users — verify it shows only "Add Fleet Server"

- [ ] **18. Multi-server smoke test**
  - Register a second server via `···` → Add Fleet Server (can use a mock URL in dev)
  - Verify: server tabs appear, Fleet header shows active server name, New Session dialog shows server selector, overview shows filter pills
  - Switch tabs: verify header updates, session list scopes to that server

---

## File Inventory

### New Files

| File | Purpose |
|------|---------|
| `src/lib/fleet-connection-registry.ts` | Connection registry — CRUD, localStorage persistence, Local token from `window.__FLEET_TOKEN__` |
| `src/contexts/fleet-connection-context.tsx` | React context wrapping the registry; exposes connections + mutations |
| `src/hooks/use-fleet-connections.ts` | Hook consuming `FleetConnectionContext` |
| `src/hooks/use-fleet-identity.ts` | Fetches `GET /api/fleet/identity` for a given connection |
| `src/hooks/use-connection-health.ts` | Polls health per connection; updates registry status |
| `src/components/layout/fleet-server-tabs.tsx` | Server tab row — hidden until 2+ connections |
| `src/components/fleet/add-server-dialog.tsx` | Add / Edit Server dialog with inline connection test |
| `src/components/fleet/remove-server-dialog.tsx` | Remove Server confirmation (AlertDialog) |

### Modified Files

| File | Change |
|------|--------|
| `src/lib/api-client.ts` | Add optional `connectionId` param to `apiFetch`, `apiUrl`, `sseUrl` |
| `src/hooks/use-directory-browser.ts` | Add optional `connectionId` param, pass to `apiFetch` |
| `src/components/session/directory-picker.tsx` | Add optional `connectionId` prop, pass to `useDirectoryBrowser` |
| `src/components/session/new-session-dialog.tsx` | Add server selector (shown only when 2+ connections) |
| `src/components/layout/sidebar.tsx` | Promote Fleet header with live server name + `···` menu; render `<FleetServerTabs />` |
| `src/components/fleet/fleet-toolbar.tsx` | Add server filter pills (shown only when 2+ connections) |
| `src/app/client-layout.tsx` | Wrap provider tree with `<FleetConnectionProvider>` |
| `src/app/page.tsx` | Wire `activeServerFilter` state + session filtering |

---

## Key Constraints

- `window.__FLEET_TOKEN__` is **never** stored in localStorage — read fresh from `window` on every Local API call
- Local connection is always present, always first, cannot be removed or edited
- `apiFetch` backward compat — every existing caller that omits `connectionId` works identically to today
- All new UI surfaces (tabs, server selector, filter pills) are **hidden** until a second server is registered — zero regression for single-server users
- All new components use existing shadcn/ui components and match existing sidebar/dialog styling — no new design language
