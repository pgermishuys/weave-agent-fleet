# Technical Debt

Tracking known issues deferred from the question tool-card race-condition fix
(commit: `add_opencode_go_as_provider` branch). Items below were reviewed and
deemed non-blocking for merge but worth addressing later.

---

## TD-001: `alreadyAnswered` only detects 404/409

**Severity:** LOW
**Origin:** Adversarial review of question tool-card fix
**Files:** `src/lib/server/opencode-client.ts` (lines 240, 279)

### Problem

`respondToQuestion` and `rejectQuestion` set `alreadyAnswered = true` only when
the upstream opencode server returns `404` or `409`. If the server ever returns
`410 Gone` or `408 Request Timeout` for an expired question, the UI will surface
a hard error instead of treating it as a benign race.

### Current behavior

```ts
const alreadyAnswered = res.status === 404 || res.status === 409;
```

### Suggested fix

Confirm the opencode server's contract for "question no longer awaiting an
answer" and broaden the status set if needed (e.g. add 410, 408). Alternatively,
treat any 4xx (except 400 for malformed input) as already-answered.

### Effort

~30 min (requires verifying the opencode server's response codes for expired
questions; code change itself is one line per function).

---

## TD-002: Skip fallback masks the original `/reject` error

**Severity:** LOW
**Origin:** Adversarial review of question tool-card fix
**Files:** `src/components/session/tool-cards/question-tool-card.tsx`
(`handleSkip`, lines ~155-214)

### Problem

When the user clicks Skip, the client first calls `/reject`. If `/reject` fails
with a non-alreadyAnswered error, the client falls back to `/reply` with
`["user skipped"]` answers for compatibility with servers that don't implement
`/reject`. If `/reply` then succeeds, the user sees success; if both fail, only
the `/reply` error is surfaced to the user. The original `/reject` error is
logged server-side but not visible to the client, which degrades debuggability
when both endpoints fail for different reasons.

### Current behavior

```ts
if (!res.ok) {
  // Fallback: send empty answers via /reply ...
  const fallback = await fetch(...);
  if (!fallback.ok) {
    throw new Error(...); // only /reply error surfaced
  }
}
```

### Suggested fix

Either:
1. Surface both errors when both fail (e.g. `"reject failed (upstream X); reply fallback also failed (upstream Y)"`), or
2. Log the original `/reject` failure client-side (console.warn) so it's
   recoverable from browser devtools even when `/reply` succeeds.

### Effort

~20 min.

---

## TD-003: `handleSkip` control flow is hard to follow

**Severity:** LOW (nit)
**Origin:** Adversarial review of question tool-card fix
**Files:** `src/components/session/tool-cards/question-tool-card.tsx`
(`handleSkip`, lines ~155-214)

### Problem

The nested `if (!res.ok) { ...fallback... if (!fallback.ok) throw }` structure
has three exit paths interleaved with two fetch calls and two alreadyAnswered
checks. Readability suffers; future edits risk introducing a path that doesn't
set `isSubmitted` or doesn't reset `isSubmitting`.

### Suggested fix

Extract the fallback into a helper, e.g.:

```ts
async function tryRejectThenReply(...): Promise<{ ok: boolean; alreadyAnswered: boolean; error?: string }> {
  // try /reject, fall back to /reply, return a single result
}
```

Then `handleSkip` becomes a flat sequence: call helper, branch on result, set
state. Same pattern could be applied to `handleSubmit` for symmetry.

### Effort

~30 min (refactor + manual verification of skip/reply paths).

---

## Notes

- Items TD-001 through TD-003 are all LOW severity — none block merge.
- TD-001 is the most likely to bite in production if the opencode server
  expands its status vocabulary; worth prioritizing when the server contract
  is next revisited.
- TD-002 and TD-003 are pure quality/debuggability improvements with no
  user-visible impact under normal operation.