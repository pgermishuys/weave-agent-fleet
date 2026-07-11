import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { QuestionToolCard } from "../question-tool-card";
import type {
  AccumulatedPart,
  PendingQuestion,
} from "@/lib/api-types";

// ─── Factories ─────────────────────────────────────────────────────────────────

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
            question: "What color?",
            header: "Pick one",
            options: [
              { label: "Red", description: "The red one" },
              { label: "Blue", description: "The blue one" },
            ],
            multiple: false,
            custom: true,
          },
        ],
      },
    },
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function makePendingQuestion(overrides: Partial<PendingQuestion> = {}): PendingQuestion {
  return {
    id: "q_abc123",
    sessionID: "sess-1",
    questions: [
      {
        question: "What color?",
        header: "Pick one",
        options: [
          { label: "Red", description: "The red one" },
          { label: "Blue", description: "The blue one" },
        ],
        multiple: false,
        custom: true,
      },
    ],
    tool: { messageID: "msg-1", callID: "call-1" },
    ...overrides,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function renderCard(overrides: {
  part?: AccumulatedPart & { type: "tool" };
  sessionId?: string;
  pendingQuestions?: PendingQuestion[];
} = {}) {
  const defaultProps = {
    part: makePart(),
    sessionId: "sess-1",
    pendingQuestions: [makePendingQuestion()],
    ...overrides,
  };
  return render(
    <QuestionToolCard
      part={defaultProps.part}
      sessionId={defaultProps.sessionId}
      pendingQuestions={defaultProps.pendingQuestions}
    />
  );
}

function respondOk() {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({ ok: true }),
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("QuestionToolCard", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("Enter key on custom text input", () => {
    it("calls POST /reply when Enter is pressed on a custom text input with text", async () => {
      mockFetch.mockResolvedValue(respondOk());

      renderCard();

      const input = screen.getByPlaceholderText("Type a custom answer…");
      fireEvent.change(input, { target: { value: "custom answer" } });
      fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/reply");
      expect(JSON.parse(opts.body as string)).toEqual({
        answers: [["custom answer"]],
      });
    });

    it("does not submit when Shift+Enter is pressed", async () => {
      mockFetch.mockResolvedValue(respondOk());

      renderCard();

      const input = screen.getByPlaceholderText("Type a custom answer…");
      fireEvent.change(input, { target: { value: "some text" } });
      fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("does not submit when already submitted", async () => {
      mockFetch.mockResolvedValue(respondOk());

      renderCard();

      // Select an option first (needed for hasSelection guard) then submit
      fireEvent.click(screen.getByText("Red"));
      fireEvent.click(screen.getByText("Submit"));

      // Wait until the input becomes disabled (isSubmitted → true)
      const input = screen.getByPlaceholderText("Type a custom answer…");
      await vi.waitFor(() => {
        expect(input.hasAttribute("disabled")).toBe(true);
      });

      // Clear call history
      mockFetch.mockClear();

      // Try Enter again
      fireEvent.change(input, { target: { value: "more text" } });
      fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("Enter key on the card background", () => {
    function selectFirstOption() {
      fireEvent.click(screen.getByText("Red"));
    }

    it("submits when Enter is pressed on the card background with a selection", () => {
      mockFetch.mockResolvedValue(respondOk());
      const { container } = renderCard();
      selectFirstOption();
      mockFetch.mockClear();

      const card = container.firstElementChild!;
      fireEvent.keyDown(card, { key: "Enter", shiftKey: false });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain("/reply");
    });

    it("does not submit when Enter is pressed on the card background without a selection", () => {
      mockFetch.mockResolvedValue(respondOk());
      const { container } = renderCard();

      const card = container.firstElementChild!;
      fireEvent.keyDown(card, { key: "Enter", shiftKey: false });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("does not submit when Shift+Enter is pressed on the card background", () => {
      mockFetch.mockResolvedValue(respondOk());
      const { container } = renderCard();
      selectFirstOption();
      mockFetch.mockClear();

      const card = container.firstElementChild!;
      fireEvent.keyDown(card, { key: "Enter", shiftKey: true });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("submits when Enter is pressed on an option button with all questions answered (Enter is submit-only, not toggle)", () => {
      mockFetch.mockResolvedValue(respondOk());
      const { container } = renderCard();

      // Select an option first so hasSelection is satisfied
      fireEvent.click(screen.getByText("Red"));
      mockFetch.mockClear();

      // Press Enter directly on the button
      const redBtn = screen.getByText("Red").closest("button")!;
      fireEvent.keyDown(redBtn, { key: "Enter", shiftKey: false });

      // Should submit (not toggle — Enter suppressed on buttons)
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain("/reply");
    });

    it("does not submit when Enter is pressed on an option button without a selection", () => {
      mockFetch.mockResolvedValue(respondOk());
      renderCard();

      const redBtn = screen.getByText("Red").closest("button")!;
      fireEvent.keyDown(redBtn, { key: "Enter", shiftKey: false });

      // hasSelection is false (no answers yet) → no submit
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("Submit button enabled state", () => {
    it("is disabled when nothing is selected or typed", () => {
      renderCard();

      const submitBtn = screen.getByText("Submit");
      expect(submitBtn.hasAttribute("disabled")).toBe(true);
    });

    it("is enabled after selecting an option", () => {
      renderCard();

      // Submit is disabled initially
      expect(screen.getByText("Submit").hasAttribute("disabled")).toBe(true);

      // Select Red
      fireEvent.click(screen.getByText("Red"));

      // Submit should now be enabled
      expect(screen.getByText("Submit").hasAttribute("disabled")).toBe(false);
    });

    it("is enabled after typing a custom answer", () => {
      renderCard();

      expect(screen.getByText("Submit").hasAttribute("disabled")).toBe(true);

      const input = screen.getByPlaceholderText("Type a custom answer…");
      fireEvent.change(input, { target: { value: "custom" } });

      expect(screen.getByText("Submit").hasAttribute("disabled")).toBe(false);
    });
  });
});
