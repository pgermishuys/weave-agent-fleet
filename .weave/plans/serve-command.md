# Plan: `weave-fleet serve` — Standalone API Server with Token Auth

> Status: Ready for execution
> Scope: New CLI subcommand that starts the Fleet API server in standalone mode with one-way hashed API token authentication on all routes.

---

## Context

Weave Agent Fleet is currently a monolithic Next.js app — UI and API run together. This plan adds a `weave-fleet serve` subcommand that starts **only the API server** (Next.js in API-only mode), bound to `0.0.0.0:3000` by default, protected by a bcrypt-hashed API token.

### Key files touched

| File | Role |
|---|---|
| `src/cli/index.ts` | Add `serve` command |
| `src/cli/serve.ts` | New — serve command implementation |
| `src/lib/server/token-manager.ts` | New — token generation, hashing, persistence |
| `src/middleware.ts` | New — Next.js middleware for auth on all `/api/*` routes |
| `src/cli/config-paths.ts` | Add `getTokenHashPath()` helper |
| `src/app/api/fleet/identity/route.ts` | New — server identity endpoint |
| `src/proxy.ts` | Update CORS to support configurable allowed origins |
| `package.json` | Add `bcryptjs` + `@types/bcryptjs` dependencies |

---

## Tasks

- [x] **1. Add `bcryptjs` dependency**
  - Run `npm install bcryptjs` and `npm install --save-dev @types/bcryptjs`
  - Prefer `bcryptjs` (pure JS, no native bindings) over `bcrypt` to avoid build complexity in the esbuild CLI bundle
  - Verify it appears in `package.json` dependencies

- [x] **2. Add `getTokenHashPath()` to `src/cli/config-paths.ts`**
  - Add a new exported function:
    ```ts
    export function getTokenHashPath(): string {
      // Reuse the existing ~/.weave/ data dir pattern
      return join(homedir(), ".weave", "api-token.hash");
    }
    ```
  - The `~/.weave/` directory already exists (it holds `fleet.db`). Verify by reading `src/lib/server/database.ts` to confirm the path convention.

- [x] **3. Create `src/lib/server/token-manager.ts`**
  - Responsibilities: token generation, hashing, persistence, and verification
  - Exports:
    ```ts
    /**
     * Returns true if a token hash file already exists on disk.
     */
    export function tokenExists(): boolean

    /**
     * Generate a cryptographically random 32-byte token (hex string),
     * hash it with bcrypt (rounds=12), persist the hash to disk,
     * and return the plaintext token (caller must print and discard it).
     * Throws if the hash file already exists — call tokenExists() first.
     */
    export async function generateAndPersistToken(): Promise<string>

    /**
     * Rotate: delete the existing hash, generate a new token, persist it,
     * return the plaintext. Safe to call only when server is stopped.
     */
    export async function rotateToken(): Promise<string>

    /**
     * Verify a presented bearer token against the stored hash.
     * Returns true if valid, false otherwise.
     * Returns false (not throws) if no hash file exists.
     */
    export async function verifyToken(presented: string): Promise<boolean>
    ```
  - Implementation notes:
    - Use `import { randomBytes } from "crypto"` for token generation — `randomBytes(32).toString("hex")` yields a 64-char hex token
    - Use `bcryptjs.hash(token, 12)` for hashing
    - Use `bcryptjs.compare(presented, storedHash)` for verification
    - The hash file directory (`~/.weave/`) must be created with `mkdirSync(..., { recursive: true })` before writing
    - `rotateToken()` deletes the existing hash file before regenerating — if deletion fails, throw (do not silently continue)
    - All file I/O errors should propagate as thrown errors (not swallowed)

- [x] **4. Create `src/middleware.ts` — Next.js auth middleware**
  - Next.js Edge Middleware runs before every request and is the correct place for auth
  - The existing `src/proxy.ts` handles CORS but is not a middleware file — this is a new file
  - Location: `src/middleware.ts` (Next.js auto-discovers this at the `src/` root)
  - Logic:
    ```ts
    import { NextRequest, NextResponse } from "next/server";
    import { verifyToken } from "@/lib/server/token-manager";

    export async function middleware(request: NextRequest) {
      // Only guard API routes
      if (!request.nextUrl.pathname.startsWith("/api/")) {
        return NextResponse.next();
      }

      // Check if a token hash exists — if not, auth is not yet configured
      // (first-start scenario before the server CLI has run). Allow through
      // so the CLI startup can still boot. The CLI serve command ensures
      // a token is generated before the server starts accepting connections.
      // NOTE: In practice, the middleware runs in the Next.js process which
      //       the CLI starts after token generation — this is a safety guard only.

      const authHeader = request.headers.get("authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return NextResponse.json(
          { error: "Unauthorized" },
          { status: 401, headers: corsHeaders }
        );
      }

      const token = authHeader.slice(7);
      const valid = await verifyToken(token);
      if (!valid) {
        return NextResponse.json(
          { error: "Unauthorized" },
          { status: 401, headers: corsHeaders }
        );
      }

      return NextResponse.next();
    }

    export const config = {
      matcher: "/api/:path*",
    };
    ```
  - Include the same CORS headers from `src/proxy.ts` in the 401 responses so preflight rejections are handled correctly
  - **Important**: Next.js Edge Middleware cannot use Node.js built-ins directly. `bcryptjs` is pure JS — it works in the Edge runtime. Verify this is the case; if not, move auth into a helper that runs in the Node.js API route layer instead (see note below).
  - **Alternative if Edge Runtime is incompatible**: Create an `src/lib/server/auth-middleware.ts` helper that wraps each route handler, and apply it to all route files. This is more verbose but avoids Edge Runtime constraints. Prefer the middleware approach first; fall back to per-route wrapping only if `bcryptjs` fails in Edge.

- [x] **5. Create `src/cli/serve.ts` — serve command implementation**
  - This module is imported by the CLI and handles the `serve` subcommand
  - Exported function: `export async function runServe(options: ServeOptions): Promise<void>`
  - `ServeOptions`:
    ```ts
    interface ServeOptions {
      port?: number;       // default: 3000
      host?: string;       // default: "0.0.0.0"
      rotateToken?: boolean;
    }
    ```
  - Logic flow:
    1. **`--rotate-token` path**: call `rotateToken()`, print the new token with clear instructions, exit. The server does NOT start when rotating.
    2. **Normal start path**:
       a. If `tokenExists()` is false: call `generateAndPersistToken()`, print the token to stdout with the message:
          ```
          ╔══════════════════════════════════════════════════════════════╗
          ║  Fleet API Token (shown once — store it securely)           ║
          ║                                                              ║
          ║  <TOKEN>                                                     ║
          ║                                                              ║
          ║  This token is required to connect clients to this server.  ║
          ║  It will never be shown again. To rotate: weave-fleet serve --rotate-token  ║
          ╚══════════════════════════════════════════════════════════════╝
          ```
       b. If `tokenExists()` is true: print `Fleet API token loaded. Starting server...` (no token printed)
       c. Resolve port/host from options, falling back to `FLEET_PORT` / `FLEET_HOST` env vars, then defaults
       d. Start Next.js programmatically using `next start` with `--hostname` and `--port` flags via `child_process.spawn`
       e. Pipe stdout/stderr from the Next.js process to the CLI's stdout/stderr
       f. Forward SIGINT/SIGTERM to the child process for clean shutdown
  - Programmatic Next.js startup command:
    ```ts
    spawn("node", [
      join(__dirname, "../.next/standalone/server.js"),
      // OR for non-standalone: use next's programmatic API
    ], {
      env: {
        ...process.env,
        PORT: String(resolvedPort),
        HOSTNAME: resolvedHost,
      },
      stdio: "inherit",
    })
    ```
  - **Note on Next.js standalone output**: `next.config.ts` already has `output: 'standalone'`. The `weave-fleet` binary is assembled via `scripts/assemble-standalone.sh`. Confirm whether `server.js` from the standalone output is available in the assembled package, and whether spawning it is the right approach vs. using Next.js's programmatic API (`next/dist/server/lib/start-server`). Document the chosen approach in code comments.

- [x] **6. Wire `serve` into `src/cli/index.ts`**
  - Import `runServe` from `./serve`
  - Add `serve` to the `switch (command)` block:
    ```ts
    case "serve": {
      const rotateToken = Boolean(flags["rotate-token"]);
      const port = flags["port"] ? Number(flags["port"]) : undefined;
      const host = typeof flags["host"] === "string" ? flags["host"] : undefined;

      await runServe({ port, host, rotateToken });
      break;
    }
    ```
  - Add `serve` to `printUsage()`:
    ```
    serve                         Start the Fleet API server (standalone mode)
    ```
  - Add serve-specific options to `printUsage()`:
    ```
    Serve Options:
      --port <port>               Port to bind (default: 3000, env: FLEET_PORT)
      --host <host>               Host to bind (default: 0.0.0.0, env: FLEET_HOST)
      --rotate-token              Rotate the API token (server must be stopped)
    ```

- [x] **7. Update `build:cli` script to include `serve.ts` dependencies**
  - The CLI is bundled with esbuild: `esbuild src/cli/index.ts --bundle --platform=node --target=node20 --outfile=cli.js --format=cjs`
  - Since `serve.ts` imports `token-manager.ts` which imports `bcryptjs`, esbuild will bundle it automatically
  - Verify the build succeeds: `npm run build:cli`
  - If `bcryptjs` has any issues with esbuild bundling, add `--external:bcryptjs` and ensure it's available at runtime

- [x] **8. Verify auth middleware doesn't break existing dev/UI mode**
  - In dev mode (`npm run dev`), the middleware will require a token on all `/api/` calls from the UI
  - This is the correct behaviour for remote mode but will break the current localhost-only dev workflow
  - **Mitigation**: In the middleware, skip auth when `NODE_ENV === "development"` OR when a `FLEET_AUTH_DISABLED=true` env var is set. This preserves the existing dev experience without requiring a token.
  - Add `FLEET_AUTH_DISABLED` check: if set to `"true"`, the middleware passes all requests through
  - Document this in code comments

- [x] **9. Create `GET /api/fleet/identity` endpoint**
  - New route: `src/app/api/fleet/identity/route.ts`
  - This endpoint is called by Fleet Clients immediately on connection to confirm server identity and display a meaningful label in multi-fleet UIs
  - Response shape (matches the findings doc):
    ```ts
    {
      name: string;         // FLEET_NAME env var, or "Fleet Server" if unset
      version: string;      // package.json version (already available via NEXT_PUBLIC_APP_VERSION)
      description: string;  // FLEET_DESCRIPTION env var, or "" if unset
      capabilities: string[]; // e.g. ["worktree", "clone"] — static for now
    }
    ```
  - Implementation notes:
    - Read `FLEET_NAME` from `process.env.FLEET_NAME` — default to `"Fleet Server"` if unset
    - Read `FLEET_DESCRIPTION` from `process.env.FLEET_DESCRIPTION` — default to `""`
    - `version` should read from the `NEXT_PUBLIC_APP_VERSION` env var (already set in `next.config.ts`)
    - `capabilities` is static for now: `["worktree", "clone", "existing"]` — these are the isolation strategies the process manager supports
  - This endpoint is subject to bearer token auth like all other `/api/` routes (middleware covers it automatically)
  - **Single-tenant design note**: This endpoint describes *this* server only. It has no awareness of other fleet servers. The multi-fleet aggregation is a client-side concern — this endpoint simply lets the client label the connection correctly in its UI.
  - Add to `ServeOptions` docs: document `FLEET_NAME` and `FLEET_DESCRIPTION` as supported env vars for the `serve` command

- [x] **10. Update `src/proxy.ts` — configurable CORS allowed origins**
  - Currently hardcoded to `Access-Control-Allow-Origin: *`
  - In a remote/multi-fleet setup, a web client served from a specific origin connects to this server. Wildcard `*` is acceptable for development but should be tightenable for production.
  - Change: read `FLEET_ALLOWED_ORIGINS` from `process.env`
    - If unset or `"*"`: keep current behaviour (`Access-Control-Allow-Origin: *`)
    - If set to a comma-separated list (e.g. `"https://fleet.mycompany.com,https://localhost:3001"`): respond with the matching origin from the request's `Origin` header (standard CORS pattern — reflect the matching origin, reject non-matching)
  - Implementation:
    ```ts
    function getAllowedOrigin(requestOrigin: string | null): string {
      const allowed = process.env.FLEET_ALLOWED_ORIGINS ?? "*";
      if (allowed === "*" || !requestOrigin) return "*";
      const origins = allowed.split(",").map(o => o.trim());
      return origins.includes(requestOrigin) ? requestOrigin : "";
    }
    ```
  - If the resolved allowed origin is `""` (not in the allowed list), return `403 Forbidden` for non-preflight requests and `204` with no ACAO header for preflight — the browser will then block the request
  - **Single-tenant design note**: The server does not know about other fleet servers. CORS is purely about which *client* origins are allowed to call *this* server. This is the correct scoping — configurable per server, not globally federated.
  - Update `src/cli/index.ts` / `printUsage()` to document `FLEET_ALLOWED_ORIGINS` under Serve Options

- [x] **11. Inject `window.__FLEET_TOKEN__` into served HTML (monolithic mode)**
  - When the server starts in monolithic mode (UI + API in one process), inject the plaintext token into the HTML page so the browser UI can authenticate without any user action
  - **Where**: the Next.js app's root HTML response. The correct place is `src/app/layout.tsx` — add a `<script>` tag in `<head>` that sets `window.__FLEET_TOKEN__` using a server-side env var
  - **Mechanism**: at startup (in `src/cli/serve.ts` or the launcher), write the plaintext token to a `FLEET_INJECT_TOKEN` env var before spawning the Next.js process. The layout reads `process.env.FLEET_INJECT_TOKEN` server-side and injects it:
    ```tsx
    // src/app/layout.tsx — inside <head>, server-rendered
    {process.env.FLEET_INJECT_TOKEN && (
      <script
        dangerouslySetInnerHTML={{
          __html: `window.__FLEET_TOKEN__=${JSON.stringify(process.env.FLEET_INJECT_TOKEN)};`,
        }}
      />
    )}
    ```
  - `FLEET_INJECT_TOKEN` is set only when running in monolithic mode (`weave-fleet` binary). It is **not** set in `weave-fleet serve` (standalone API-only mode) — remote users receive no injected token and must register via the Add Server dialog
  - `FLEET_AUTH_DISABLED=true` (dev mode): no token exists, nothing to inject — the condition is naturally false
  - The injected token lives in page memory only — the UI reads `window.__FLEET_TOKEN__` and never writes it to localStorage
  - **Acceptance**:
    - `weave-fleet` (monolithic): open browser, open DevTools console, `window.__FLEET_TOKEN__` is a non-empty string; API calls from the UI succeed without manual auth setup
    - `weave-fleet serve` (API-only): `window.__FLEET_TOKEN__` is `undefined` in the browser
    - `npm run dev`: `window.__FLEET_TOKEN__` is `undefined`; dev mode still works via `FLEET_AUTH_DISABLED`

- [x] **12. Manual end-to-end verification**
  - Build the CLI: `npm run build:cli`
  - Run `node cli.js serve` — verify token is printed on first start
  - Run `node cli.js serve` again — verify token is NOT printed, server starts silently
  - Make an API call without a token: `curl http://localhost:3000/api/sessions` — expect `401`
  - Make an API call with the correct token: `curl -H "Authorization: Bearer <token>" http://localhost:3000/api/sessions` — expect `200`
  - Make an API call with a wrong token — expect `401`
  - Run `node cli.js serve --rotate-token` while the server is stopped — verify new token printed, old token rejected, new token accepted
  - Verify `npm run dev` still works without requiring a token (auth bypass in dev mode)
  - Call `curl -H "Authorization: Bearer <token>" http://localhost:3000/api/fleet/identity` — verify correct name, version, capabilities returned
  - Start with `FLEET_NAME="my-server"` env var set — verify identity endpoint returns `"name": "my-server"`
  - Verify CORS: with `FLEET_ALLOWED_ORIGINS` unset, cross-origin requests are allowed; with it set to a specific origin, non-matching origins are blocked
  - Run `weave-fleet` (monolithic mode) — open browser, check `window.__FLEET_TOKEN__` in DevTools console — expect a non-empty string; verify UI API calls succeed without manual auth
  - Run `weave-fleet serve` (standalone) — check `window.__FLEET_TOKEN__` — expect `undefined`

---

## Decision Log

| Decision | Rationale |
|---|---|
| `bcryptjs` over `bcrypt` | Pure JS — no native bindings, works in esbuild bundle without `--external` complications |
| Hash stored at `~/.weave/api-token.hash` | Consistent with `fleet.db` location in `~/.weave/` |
| Token printed with box art | Makes the one-time display unmissable in terminal output |
| `FLEET_AUTH_DISABLED=true` bypass | Preserves existing dev/UI workflow without breaking changes |
| Offline-only `--rotate-token` | Avoids live state complexity — operator stops server, rotates, restarts |
| Auth in Next.js middleware | Single enforcement point across all 27+ API routes — no per-route changes |
| Edge Runtime concern noted | `bcryptjs` is pure JS and should work; fallback to per-route helper documented |
| Server stays single-tenant | No federation, no server-to-server communication — multi-fleet topology is entirely a client-side concern |
| `GET /api/fleet/identity` added | Enables clients to label connections correctly in multi-fleet UIs; server describes itself only |
| `FLEET_NAME` / `FLEET_DESCRIPTION` env vars | User-configurable server identity without code changes; defaults are sensible |
| `FLEET_ALLOWED_ORIGINS` for CORS | Wildcards are fine for dev; production operators can lock down to specific client origins per-server |
| Local token injection via `window.__FLEET_TOKEN__` | In monolithic mode the server injects the token into the served HTML at startup — local users get zero-friction auth with no registration flow. Token lives in page memory only, never localStorage. Remote users receive no injected token and register via the Add Server dialog. See `.weave/findings/multi-fleet-ux.md` § Local Token Injection. |
