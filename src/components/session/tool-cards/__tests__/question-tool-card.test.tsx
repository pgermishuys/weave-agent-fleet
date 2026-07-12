import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
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

function makeMultiQuestionPart(): AccumulatedPart & { type: "tool" } {
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
            header: "Question 1",
            options: [
              { label: "Red", description: "The red one" },
              { label: "Blue", description: "The blue one" },
            ],
            multiple: false,
            custom: true,
          },
          {
            question: "What size?",
            header: "Question 2",
            options: [
              { label: "Small", description: "Small size" },
              { label: "Large", description: "Large size" },
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

function makeMultiQuestionPending(): PendingQuestion {
  return {
    id: "q_abc123",
    sessionID: "sess-1",
    questions: [
      {
        question: "What color?",
        header: "Question 1",
        options: [
          { label: "Red", description: "The red one" },
          { label: "Blue", description: "The blue one" },
        ],
        multiple: false,
        custom: true,
      },
      {
        question: "What size?",
        header: "Question 2",
        options: [
          { label: "Small", description: "Small size" },
          { label: "Large", description: "Large size" },
        ],
        multiple: false,
        custom: true,
      },
    ],
    tool: { messageID: "msg-1", callID: "call-1" },
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

    it("submits with skipped answer when Enter is pressed on the card background without a selection", () => {
      mockFetch.mockResolvedValue(respondOk());
      const { container } = renderCard();

      const card = container.firstElementChild!;
      fireEvent.keyDown(card, { key: "Enter", shiftKey: false });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(opts.body as string)).toEqual({
        answers: [["skipped"]],
      });
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
      renderCard();

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

    it("submits with skipped answer when Enter is pressed on an option button without a selection", () => {
      mockFetch.mockResolvedValue(respondOk());
      renderCard();

      const redBtn = screen.getByText("Red").closest("button")!;
      fireEvent.keyDown(redBtn, { key: "Enter", shiftKey: false });

      // When on last question without selection, should submit with skipped
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(opts.body as string)).toEqual({
        answers: [["skipped"]],
      });
    });
  });

  describe("Submit button enabled state", () => {
    it("is enabled even when nothing is selected or typed (allows submitting with skipped)", () => {
      renderCard();

      const submitBtn = screen.getByText("Submit");
      expect(submitBtn.hasAttribute("disabled")).toBe(false);
    });

    it("remains enabled after selecting an option", async () => {
      renderCard();

      // Submit is enabled initially (allows submitting with skipped)
      expect(screen.getByText("Submit").hasAttribute("disabled")).toBe(false);

      // Select Red
      fireEvent.click(screen.getByText("Red"));

      // Submit should still be enabled
      await vi.waitFor(() => {
        expect(screen.getByText("Submit").hasAttribute("disabled")).toBe(false);
      });
    });

    it("remains enabled after typing a custom answer", async () => {
      renderCard();

      expect(screen.getByText("Submit").hasAttribute("disabled")).toBe(false);

      const input = screen.getByPlaceholderText("Type a custom answer…");
      fireEvent.change(input, { target: { value: "custom" } });

      await vi.waitFor(() => {
        expect(screen.getByText("Submit").hasAttribute("disabled")).toBe(false);
      });
    });
  });

  describe("Subtab navigation for multiple questions", () => {
    function renderMultiQuestionCard() {
      return render(
        <QuestionToolCard
          part={makeMultiQuestionPart()}
          sessionId="sess-1"
          pendingQuestions={[makeMultiQuestionPending()]}
        />
      );
    }

    it("shows question indicator with current question number", () => {
      renderMultiQuestionCard();

      expect(screen.getByText("Question 1 of 2")).toBeInTheDocument();
    });

    it("shows first question by default", () => {
      renderMultiQuestionCard();

      expect(screen.getByText("Question 1")).toBeInTheDocument();
      expect(screen.getByText("What color?")).toBeInTheDocument();
      expect(screen.queryByText("Question 2")).not.toBeInTheDocument();
      expect(screen.queryByText("What size?")).not.toBeInTheDocument();
    });

    it("navigates to next question when Next button is clicked", () => {
      renderMultiQuestionCard();

      // Click Next button
      fireEvent.click(screen.getByLabelText("Next question"));

      expect(screen.getByText("Question 2 of 2")).toBeInTheDocument();
      expect(screen.getByText("Question 2")).toBeInTheDocument();
      expect(screen.getByText("What size?")).toBeInTheDocument();
      expect(screen.queryByText("Question 1")).not.toBeInTheDocument();
      expect(screen.queryByText("What color?")).not.toBeInTheDocument();
    });

    it("navigates back to previous question when Previous button is clicked", () => {
      renderMultiQuestionCard();

      // Go to next question
      fireEvent.click(screen.getByLabelText("Next question"));
      expect(screen.getByText("Question 2 of 2")).toBeInTheDocument();

      // Go back to previous question
      fireEvent.click(screen.getByLabelText("Previous question"));

      expect(screen.getByText("Question 1 of 2")).toBeInTheDocument();
      expect(screen.getByText("Question 1")).toBeInTheDocument();
      expect(screen.getByText("What color?")).toBeInTheDocument();
    });

    it("disables Previous button on first question", () => {
      renderMultiQuestionCard();

      const prevBtn = screen.getByLabelText("Previous question");
      expect(prevBtn.hasAttribute("disabled")).toBe(true);
    });

    it("disables Next button on last question", () => {
      renderMultiQuestionCard();

      // Go to last question
      fireEvent.click(screen.getByLabelText("Next question"));

      const nextBtn = screen.getByLabelText("Next question");
      expect(nextBtn.hasAttribute("disabled")).toBe(true);
    });

    it("preserves answers when navigating between questions", async () => {
      mockFetch.mockResolvedValue(respondOk());
      renderMultiQuestionCard();

      // Answer first question
      fireEvent.click(screen.getByText("Red"));
      // Auto-advance to next question after 100ms
      await vi.waitFor(
        () => {
          expect(screen.getByText("Question 2 of 2")).toBeInTheDocument();
        },
        { timeout: 500 }
      );

      // Answer second question
      fireEvent.click(screen.getByText("Large"));
      // Now submit should be enabled
      await vi.waitFor(() => {
        expect(screen.getByText("Submit").hasAttribute("disabled")).toBe(false);
      });

      // Navigate back to first question
      fireEvent.click(screen.getByLabelText("Previous question"));

      // First answer should still be selected
      const redBtn = screen.getByText("Red").closest("button")!;
      expect(redBtn).toHaveClass("bg-amber-500/20");
    });

    it("does not show navigation when only one question", () => {
      renderCard();

      expect(screen.queryByLabelText("Previous question")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Next question")).not.toBeInTheDocument();
      expect(screen.queryByText("Question 1 of 1")).not.toBeInTheDocument();
    });
  });
});
