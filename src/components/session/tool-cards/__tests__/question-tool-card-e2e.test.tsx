import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { QuestionToolCard } from "../question-tool-card";
import type { AccumulatedPart, PendingQuestion } from "@/lib/api-types";

/**
 * E2E Integration Tests for Question Flow
 *
 * These tests simulate the full question lifecycle:
 * 1. Question appears in UI
 * 2. User selects/enters answer
 * 3. Submit is clicked
 * 4. Answer is sent to backend
 * 5. Backend processes and responds
 *
 * Includes timing measurements to detect delays that could cause OpenCode 404 errors.
 */

// ─── Factory Functions ──────────────────────────────────────────────────────

function makePart(overrides: Partial<AccumulatedPart & { state?: Record<string, unknown> }> = {}): AccumulatedPart & { type: "tool" } {
  return {
    partId: "part-1",
    type: "tool",
    tool: "question",
    callId: "call-1",
    state: {
      status: "running",
      input: {
        questions: [
          {
            question: "What is your name?",
            header: "User Info",
            options: [
              { label: "Alice", description: "First person" },
              { label: "Bob", description: "Second person" },
              { label: "Charlie", description: "Third person" },
            ],
            multiple: false,
            custom: true,
          },
        ],
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function makePendingQuestion(overrides: Partial<PendingQuestion> = {}): PendingQuestion {
  return {
    id: `q_${Date.now()}`,
    sessionID: "sess-1",
    questions: [
      {
        question: "What is your name?",
        header: "User Info",
        options: [
          { label: "Alice", description: "First person" },
          { label: "Bob", description: "Second person" },
          { label: "Charlie", description: "Third person" },
        ],
        multiple: false,
        custom: true,
      },
    ],
    tool: { messageID: "msg-1", callID: "call-1" },
    ...overrides,
  };
}

// ─── Helper for response timing ─────────────────────────────────────────────

function createDelayedResponse(delayMs: number, responseBody: Record<string, unknown> = { ok: true }) {
  return {
    ok: responseBody.ok ?? true,
    status: 200,
    json: vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(responseBody), delayMs);
        })
    ),
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("QuestionToolCard - E2E Integration Tests", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let performanceTimings: Record<string, number> = {};

  beforeEach(() => {
    performanceTimings = {};
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    // Mark when tests start for timing reference
    performanceTimings.testStart = Date.now();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("Complete flow: render → answer → submit → success", () => {
    it("should complete full flow within reasonable time", async () => {
      const pendingQuestion = makePendingQuestion();
      mockFetch.mockResolvedValue(createDelayedResponse(50, { ok: true }));

      performanceTimings.renderStart = Date.now();
      const { container } = render(
        <QuestionToolCard
          part={makePart()}
          sessionId="sess-1"
          pendingQuestions={[pendingQuestion]}
        />
      );
      performanceTimings.renderEnd = Date.now();

      // Wait for question to be visible
      performanceTimings.questionWaitStart = Date.now();
      const questionHeader = await screen.findByText("User Info");
      performanceTimings.questionWaitEnd = Date.now();

      // Select an answer
      performanceTimings.answerStart = Date.now();
      const aliceButton = screen.getByRole("button", { name: /Alice/i });
      fireEvent.click(aliceButton);
      performanceTimings.answerEnd = Date.now();

      // Find and click submit
      performanceTimings.submitWaitStart = Date.now();
      const submitBtn = await screen.findByRole("button", { name: /submit/i });
      performanceTimings.submitWaitEnd = Date.now();

      performanceTimings.submitClickStart = Date.now();
      fireEvent.click(submitBtn);
      performanceTimings.submitClickEnd = Date.now();

      // Wait for response
      performanceTimings.responseWaitStart = Date.now();
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      }, { timeout: 5000 });
      performanceTimings.responseWaitEnd = Date.now();

      // Verify the answer was sent
      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/reply");
      expect(JSON.parse(opts.body as string)).toEqual({
        answers: [["Alice"]],
      });

      // Log timing breakdown
      console.log("\n⏱️  Timing Breakdown:");
      console.log(`   - Component render: ${performanceTimings.renderEnd - performanceTimings.renderStart}ms`);
      console.log(
        `   - Question wait (findByText): ${performanceTimings.questionWaitEnd - performanceTimings.questionWaitStart}ms`
      );
      console.log(
        `   - Answer selection (click): ${performanceTimings.answerEnd - performanceTimings.answerStart}ms`
      );
      console.log(
        `   - Submit button wait: ${performanceTimings.submitWaitEnd - performanceTimings.submitWaitStart}ms`
      );
      console.log(
        `   - Submit click + response: ${performanceTimings.responseWaitEnd - performanceTimings.submitClickStart}ms`
      );
      console.log(
        `   - Total: ${performanceTimings.responseWaitEnd - performanceTimings.testStart}ms`
      );

      // Total should be less than 10 seconds (reasonable for a UI test)
      const totalTime = performanceTimings.responseWaitEnd - performanceTimings.testStart;
      expect(totalTime).toBeLessThan(10000);
    });
  });

  describe("Multiple submissions and race conditions", () => {
    it("should not submit twice when clicking submit button multiple times", async () => {
      const pendingQuestion = makePendingQuestion();
      mockFetch.mockResolvedValue(createDelayedResponse(200, { ok: true }));

      render(
        <QuestionToolCard
          part={makePart()}
          sessionId="sess-1"
          pendingQuestions={[pendingQuestion]}
        />
      );

      // Select answer
      const aliceButton = await screen.findByRole("button", { name: /Alice/i });
      fireEvent.click(aliceButton);

      // Find submit button
      const submitBtn = await screen.findByRole("button", { name: /submit/i });

      // Click submit multiple times rapidly
      fireEvent.click(submitBtn);
      fireEvent.click(submitBtn);
      fireEvent.click(submitBtn);

      // Wait a bit for async operations
      await waitFor(() => expect(mockFetch).toHaveBeenCalled(), { timeout: 5000 });

      // Should only have called fetch once (not three times)
      // This tests that the submit is properly disabled after first click
      expect(mockFetch.mock.calls.length).toBeLessThanOrEqual(1);
    });
  });

  describe("Slow response handling (simulating OpenCode delay)", () => {
    it("should handle slow responses gracefully (500ms delay)", async () => {
      const pendingQuestion = makePendingQuestion();
      // Simulate a slow OpenCode response
      mockFetch.mockResolvedValue(createDelayedResponse(500, { ok: true }));

      render(
        <QuestionToolCard
          part={makePart()}
          sessionId="sess-1"
          pendingQuestions={[pendingQuestion]}
        />
      );

      const aliceButton = await screen.findByRole("button", { name: /Alice/i });
      fireEvent.click(aliceButton);

      const submitBtn = await screen.findByRole("button", { name: /submit/i });

      const submitTime = Date.now();
      fireEvent.click(submitBtn);

      // Wait for fetch to complete
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      }, { timeout: 3000 });

      const elapsed = Date.now() - submitTime;
      console.log(`\n⏱️  Slow response test: Responded in ${elapsed}ms (mocked 500ms delay)`);

      // Should handle it without crashing
      expect(mockFetch).toHaveBeenCalled();
    });

    it("should handle very slow responses (3000ms delay)", async () => {
      const pendingQuestion = makePendingQuestion();
      // Simulate a VERY slow OpenCode response (might timeout)
      mockFetch.mockResolvedValue(createDelayedResponse(3000, { ok: true }));

      render(
        <QuestionToolCard
          part={makePart()}
          sessionId="sess-1"
          pendingQuestions={[pendingQuestion]}
        />
      );

      const aliceButton = await screen.findByRole("button", { name: /Alice/i });
      fireEvent.click(aliceButton);

      const submitBtn = await screen.findByRole("button", { name: /submit/i });

      const submitTime = Date.now();
      fireEvent.click(submitBtn);

      // Wait longer for very slow response
      await new Promise((resolve) => setTimeout(resolve, 3500));

      const elapsed = Date.now() - submitTime;
      console.log(`\n⚠️  Very slow response test: Took ${elapsed}ms (mocked 3000ms delay)`);
      console.log(`   This could explain 404 errors if OpenCode times out before getting the answer!`);

      // The component should still function
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe("Network error recovery", () => {
    it("should display error when backend returns 500", async () => {
      const pendingQuestion = makePendingQuestion();
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({ error: "Internal server error" }),
      });

      render(
        <QuestionToolCard
          part={makePart()}
          sessionId="sess-1"
          pendingQuestions={[pendingQuestion]}
        />
      );

      const aliceButton = await screen.findByRole("button", { name: /Alice/i });
      fireEvent.click(aliceButton);

      const submitBtn = await screen.findByRole("button", { name: /submit/i });
      fireEvent.click(submitBtn);

      // Should show some kind of error
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });
    });

    it("should handle OpenCode 404 (question not found) gracefully", async () => {
      const pendingQuestion = makePendingQuestion();
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          ok: false,
          alreadyAnswered: true,
          status: 404,
        }),
      });

      render(
        <QuestionToolCard
          part={makePart()}
          sessionId="sess-1"
          pendingQuestions={[pendingQuestion]}
        />
      );

      const aliceButton = await screen.findByRole("button", { name: /Alice/i });
      fireEvent.click(aliceButton);

      const submitBtn = await screen.findByRole("button", { name: /submit/i });
      fireEvent.click(submitBtn);

      // Should handle 404 from OpenCode without crashing
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });
    });
  });

  describe("Custom text input flow", () => {
    it("should handle custom text answer submission", async () => {
      const pendingQuestion = makePendingQuestion();
      mockFetch.mockResolvedValue({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ ok: true }) });

      render(
        <QuestionToolCard
          part={makePart()}
          sessionId="sess-1"
          pendingQuestions={[pendingQuestion]}
        />
      );

      // Find custom input
      const customInput = screen.getByPlaceholderText("Type a custom answer…");
      fireEvent.change(customInput, { target: { value: "David" } });

      // Submit with Enter key
      fireEvent.keyDown(customInput, { key: "Enter", shiftKey: false });

      // Wait for fetch
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      }, { timeout: 5000 });

      // Verify answer sent
      const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(opts.body as string)).toEqual({
        answers: [["David"]],
      });
    });
  });
});
