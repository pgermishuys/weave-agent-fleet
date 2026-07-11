"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import { HelpCircle, Loader2, Check, X, Send, CornerDownRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CollapsibleToolCall } from "../collapsible-tool-call";
import { cn } from "@/lib/utils";
import type {
  AccumulatedPart,
  PendingQuestion,
  QuestionInfo,
  QuestionOption,
} from "@/lib/api-types";

interface QuestionToolCardProps {
  part: AccumulatedPart & { type: "tool" };
  sessionId: string;
  pendingQuestions: PendingQuestion[];
}

export function QuestionToolCard({
  part,
  sessionId,
  pendingQuestions,
}: QuestionToolCardProps) {
  // Find the matching pending question using callID
  const pending = useMemo(
    () => pendingQuestions.find((q) => q.tool?.callID === part.callId),
    [pendingQuestions, part.callId]
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const state = part.state as any;
  const isCompleted = state?.status === "completed";
  const isError = state?.status === "error";
  const isRunning = state?.status === "running" || !state?.status;

  // Determine questions to show — prefer pending question data, fall back to input
  const questions: QuestionInfo[] = useMemo(() => {
    if (pending?.questions?.length) return pending.questions;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const input = state?.input as any;
    if (Array.isArray(input?.questions)) return input.questions;
    return [];
  }, [pending, state]);

  const requestID = pending?.id;

  // Track which callIDs we've ever seen a pending question for. The tool call
  // part can render before the `question.asked` SSE event lands in
  // pendingQuestions; during that window requestID is undefined. Without this
  // ref we'd briefly render the "no longer accepting answers" stale state
  // before flipping to the live form once the pending question arrives.
  // Only treat as stale when we *had* a pending question and it's now gone.
  const seenCallIds = useRef<Set<string>>(new Set());
  if (pending) seenCallIds.current.add(part.callId);
  const everSawPending = seenCallIds.current.has(part.callId);

  // A question may have already been answered/rejected/expired server-side
  // (e.g. race, instance restart, SSE list desync) while the tool call part
  // is still rendered as "running". When that happens there is no pending
  // entry — flag it so we render a disabled "no longer available" state
  // instead of a live form that silently no-ops on Submit.
  //
  // `isCompleted` (SSE says the tool call finished cleanly) is NOT treated
  // as stale — that path collapses to the regular CollapsibleToolCall below.
  // `everSawPending` guards against a false stale flash on first render
  // before the `question.asked` event has arrived.
  const isStale = !requestID && !isCompleted && everSawPending;

  // ── State ──────────────────────────────────────────────────────────────────
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, string[]>>({});
  const [customTexts, setCustomTexts] = useState<Record<number, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submittedAnswers, setSubmittedAnswers] = useState<string[][] | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ── Option toggling ────────────────────────────────────────────────────────
  const toggleOption = useCallback(
    (qIndex: number, option: QuestionOption, multiple: boolean) => {
      setSelectedAnswers((prev) => {
        const current = prev[qIndex] ?? [];
        if (multiple) {
          // Multi-select: toggle independently
          if (current.includes(option.label)) {
            return { ...prev, [qIndex]: current.filter((l) => l !== option.label) };
          }
          return { ...prev, [qIndex]: [...current, option.label] };
        }
        // Single-select: if already selected, deselect; otherwise select only this one
        if (current.includes(option.label)) {
          return { ...prev, [qIndex]: [] };
        }
        return { ...prev, [qIndex]: [option.label] };
      });
    },
    []
  );

  const setCustomText = useCallback((qIndex: number, text: string) => {
    setCustomTexts((prev) => ({ ...prev, [qIndex]: text }));
  }, []);

  // ── Selection guard ─────────────────────────────────────────────────────────
  // True only when EVERY question has a selected option or non-empty custom text.
  // Used to gate both the keyboard shortcut and the Submit button so the user
  // can't fire off a partial answer set.
  const hasSelection = useMemo(() => {
    if (questions.length === 0) return false;
    return questions.every((q, i) => {
      const selected = selectedAnswers[i] ?? [];
      if (selected.length > 0) return true;
      const custom = customTexts[i]?.trim();
      if (custom) return true;
      return false;
    });
  }, [questions, selectedAnswers, customTexts]);

  // ── Build answer payload ────────────────────────────────────────────────────
  const buildAnswers = useCallback((): string[][] => {
    return questions.map((q, i) => {
      const selected = selectedAnswers[i] ?? [];
      const custom = customTexts[i]?.trim();
      const result: string[] = [...selected];
      if (custom) result.push(custom);
      // If nothing selected and question has no custom field (or custom===false), return empty
      return result.length > 0 ? result : [];
    });
  }, [questions, selectedAnswers, customTexts]);

  // ── Submit handler ──────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!requestID || !sessionId || !hasSelection) return;
    const answers = buildAnswers();
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/questions/${requestID}/reply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers }),
        }
      );
      const data = (await res.json().catch(() => null)) as
        | Record<string, unknown>
        | null;

      // The API returns 200 with { alreadyAnswered: true } when the opencode
      // server says the question is no longer awaiting an answer. Treat that
      // as a benign race — flip to submitted so the UI stops being actionable.
      if (res.ok && data?.alreadyAnswered === true) {
        setSubmittedAnswers(answers);
        setIsSubmitted(true);
        setSubmitError(null);
        return;
      }

      if (!res.ok) {
        // Non-2xx (and not alreadyAnswered) — surface the real message.
        const upstreamInfo =
          typeof data?.status === "number"
            ? ` (upstream ${data.status})`
            : "";
        const message =
          (typeof data?.error === "string" && data.error) ||
          `Request failed (${res.status})${upstreamInfo}`;
        throw new Error(message);
      }
      setSubmittedAnswers(answers);
      setIsSubmitted(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setIsSubmitting(false);
    }
  }, [requestID, sessionId, buildAnswers, hasSelection]);

  // ── Skip handler ────────────────────────────────────────────────────────────
  const handleSkip = useCallback(async () => {
    if (!requestID || !sessionId) return;
    setIsSubmitting(true);
    setSubmitError(null);
    const skipAnswers = questions.map(() => ["user skipped"]);
    try {
      // Skip prefers the dedicated /reject endpoint so the opencode server
      // records it as a rejection rather than an empty answer.
      const res = await fetch(
        `/api/sessions/${sessionId}/questions/${requestID}/reject`,
        { method: "POST" }
      );
      const data = (await res.json().catch(() => null)) as
        | Record<string, unknown>
        | null;

      if (res.ok && data?.alreadyAnswered === true) {
        setSubmittedAnswers(skipAnswers);
        setIsSubmitted(true);
        setSubmitError(null);
        return;
      }

      if (!res.ok) {
        // Fallback: send empty answers via /reply so a skip still works if
        // the opencode server doesn't implement /reject for this ID.
        const fallback = await fetch(
          `/api/sessions/${sessionId}/questions/${requestID}/reply`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ answers: skipAnswers }),
          }
        );
        const fallbackData = (await fallback.json().catch(() => null)) as
          | Record<string, unknown>
          | null;
        if (fallback.ok && fallbackData?.alreadyAnswered === true) {
          setSubmittedAnswers(skipAnswers);
          setIsSubmitted(true);
          setSubmitError(null);
          return;
        }
        if (!fallback.ok) {
          const message =
            (typeof fallbackData?.error === "string" && fallbackData.error) ||
            (typeof fallbackData?.status === "number"
              ? `Request failed (${fallbackData.status})`
              : `Request failed (${fallback.status})`);
          throw new Error(message);
        }
      }
      setSubmittedAnswers(skipAnswers);
      setIsSubmitted(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Skip failed");
    } finally {
      setIsSubmitting(false);
    }
  }, [requestID, sessionId, questions]);

  // ── Keyboard submit ─────────────────────────────────────────────────────────
  // Pressing Enter (without Shift) on any custom text input triggers submit.
  // This mirrors the Submit button behaviour so users can answer without
  // reaching for the mouse. Shift+Enter is ignored (reserved for newlines
  // in potential future multi-line inputs).
  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && !e.shiftKey && !isSubmitting && !isSubmitted && !isStale) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit, isSubmitting, isSubmitted, isStale]
  );

  // Pressing Enter anywhere on the card submits — as long as every question
  // has been answered. Option buttons suppress Enter themselves (no toggle),
  // and the custom text input handles Enter separately above, so this
  // container handler catches Enter from any remaining target (including the
  // card background) and triggers submit when all questions are answered.
  const handleCardKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "Enter" || e.shiftKey) return;
      const target = e.target as HTMLElement;
      // Let the custom text input handle Enter itself (triggers submit
      // directly); don't double-fire from the container.
      if (target.tagName === "INPUT") return;
      if (!isSubmitting && !isSubmitted && !isStale && hasSelection) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit, isSubmitting, isSubmitted, isStale, hasSelection]
  );

  // ── Fallback: completed or no matching pending question ──────────────────
  // Don't collapse if the user already submitted — keep showing the answer.
  // Only collapse when the tool call is genuinely complete (SSE confirmed).
  // A dropped-but-not-complete pending entry (race / restart / desync) is
  // handled below as a disabled "stale" form so the user sees their input
  // and a clear "no longer available" message rather than silent collapse.
  if (isCompleted && !isSubmitted) {
    return <CollapsibleToolCall part={part} />;
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className="my-1 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs border-l-2 border-l-amber-500/60"
      onKeyDown={handleCardKeyDown}
    >
      {/* Header bar */}
      <div className="flex items-center gap-2 mb-2">
        <HelpCircle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
        <span className="font-mono text-amber-500/90 text-xs">question</span>
        {isRunning && !isSubmitted && !isStale && (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />
        )}
        {isSubmitted && <Check className="h-3 w-3 text-green-500 shrink-0" />}
        {isError && !isSubmitted && (
          <X className="h-3 w-3 text-red-500 shrink-0" />
        )}
      </div>

      {/* Questions */}
      <div className="space-y-3">
        {questions.map((q, qi) => {
          const selected = selectedAnswers[qi] ?? [];
          const showCustom = q.custom !== false;

          return (
            <div key={qi} className="space-y-2">
              {/* Header */}
              {q.header && (
                <div className="font-semibold text-foreground/85">
                  {q.header}
                </div>
              )}
              {/* Question text */}
              {q.question && (
                <div className="text-muted-foreground leading-relaxed">
                  {q.question}
                </div>
              )}

              {/* Options */}
              {q.options && q.options.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {q.options.map((opt) => {
                    const isSelected = selected.includes(opt.label);
                    return (
                      <button
                        key={opt.label}
                        type="button"
                        disabled={isSubmitted || isStale}
                        onClick={() => toggleOption(qi, opt, !!q.multiple)}
                        onKeyDown={(e) => {
                          // Enter is reserved for submit — suppress native
                          // button click-on-Enter so it doesn't also toggle
                          if (e.key === "Enter") e.preventDefault();
                        }}
                        title={opt.description}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs border transition-colors",
                          "disabled:cursor-not-allowed",
                          isSelected
                            ? "bg-amber-500/20 border-amber-500/40 text-amber-600 dark:text-amber-400"
                            : "bg-muted/40 border-border hover:bg-muted/60 hover:border-amber-500/30"
                        )}
                      >
                        {opt.description ? (
                          <>
                            <span>{opt.label}</span>
                            <span className="text-[10px] text-muted-foreground/60 max-w-[140px] truncate hidden sm:inline">
                              — {opt.description}
                            </span>
                          </>
                        ) : (
                          <span>{opt.label}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Custom / free-text input */}
              {showCustom && (
                <div className="flex items-center gap-1.5">
                  <CornerDownRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                  <Input
                    type="text"
                    placeholder="Type a custom answer…"
                    value={customTexts[qi] ?? ""}
                    onChange={(e) => setCustomText(qi, e.target.value)}
                    onKeyDown={handleInputKeyDown}
                    disabled={isSubmitted || isStale}
                    className="h-7 text-xs"
                  />
                </div>
              )}

              {/* Submitted answer display */}
              {isSubmitted && submittedAnswers && (
                <div className="text-[11px] text-muted-foreground/70 mt-1">
                  Answered:{" "}
                  <span className="text-foreground/80">
                    {submittedAnswers[qi]?.join(", ") || "(no answer)"}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Action buttons */}
      {isStale ? (
        // Stale: the question is no longer accepting answers on the server.
        // Don't render active Submit/Skip buttons — they would no-op. Show a
        // clear notice so the user understands why nothing happens on click.
        <div className="mt-3 pt-2 border-t border-border/40 text-xs text-amber-600 dark:text-amber-400">
          This question is no longer accepting answers.
        </div>
      ) : (
        !isSubmitted &&
        questions.length > 0 && (
          <div className="flex items-center gap-2 mt-3 pt-2 border-t border-border/40">
            <Button
              size="xs"
              variant="default"
              onClick={handleSubmit}
              disabled={isSubmitting || !hasSelection}
              title={!hasSelection ? "Select an option or type an answer first" : undefined}
              className="text-xs"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <Send className="h-3 w-3" />
                  Submit
                </>
              )}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={handleSkip}
              disabled={isSubmitting}
              className="text-xs text-muted-foreground"
            >
              Skip
            </Button>
          </div>
        )
      )}

      {/* Submit error */}
      {submitError && !isSubmitted && (
        <div className="mt-2 text-xs text-red-600 dark:text-red-400 bg-red-500/10 rounded px-2 py-1">
          {submitError}
        </div>
      )}
    </div>
  );
}
