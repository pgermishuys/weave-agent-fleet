import {
  parseIssueUrlsFromOutput,
  extractIssueReferences,
} from "@/lib/issue-utils";
import type {
  AccumulatedMessage,
  AccumulatedToolPart,
  AccumulatedTextPart,
} from "@/lib/api-types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMessage(
  overrides: Partial<AccumulatedMessage> = {}
): AccumulatedMessage {
  return {
    messageId: "msg-1",
    sessionId: "sess-1",
    role: "assistant",
    parts: [],
    ...overrides,
  };
}

function makeToolPart(
  overrides: Partial<AccumulatedToolPart> = {}
): AccumulatedToolPart {
  return {
    partId: "part-1",
    type: "tool",
    tool: "bash",
    callId: "call-1",
    state: { status: "completed", output: "" },
    ...overrides,
  };
}

function makeTextPart(
  overrides: Partial<AccumulatedTextPart> = {}
): AccumulatedTextPart {
  return {
    partId: "text-part-1",
    type: "text",
    text: "hello",
    ...overrides,
  };
}

const ISSUE_URL_1 = "https://github.com/acme/my-repo/issues/42";
const ISSUE_URL_2 = "https://github.com/acme/my-repo/issues/99";
const ISSUE_URL_OTHER_REPO = "https://github.com/other-org/other-repo/issues/7";

// ─── parseIssueUrlsFromOutput ─────────────────────────────────────────────────

describe("parseIssueUrlsFromOutput", () => {
  it("returns [] for null", () => {
    expect(parseIssueUrlsFromOutput(null)).toEqual([]);
  });

  it("returns [] for undefined", () => {
    expect(parseIssueUrlsFromOutput(undefined)).toEqual([]);
  });

  it("returns [] for empty string", () => {
    expect(parseIssueUrlsFromOutput("")).toEqual([]);
  });

  it("returns [] for whitespace-only string", () => {
    expect(parseIssueUrlsFromOutput("   ")).toEqual([]);
  });

  it("returns [] for non-string input (number)", () => {
    expect(parseIssueUrlsFromOutput(12345)).toEqual([]);
  });

  it("returns [] for non-GitHub URL", () => {
    expect(parseIssueUrlsFromOutput("https://example.com/issues/42")).toEqual(
      []
    );
  });

  it("returns [] for a GitHub PR URL (not an issue URL)", () => {
    expect(
      parseIssueUrlsFromOutput("https://github.com/acme/repo/pull/10")
    ).toEqual([]);
  });

  it("extracts a single issue URL", () => {
    const result = parseIssueUrlsFromOutput(
      `Created issue ${ISSUE_URL_1} successfully`
    );
    expect(result).toEqual([
      { owner: "acme", repo: "my-repo", number: 42, url: ISSUE_URL_1 },
    ]);
  });

  it("extracts multiple issue URLs from one string", () => {
    const text = `Issues: ${ISSUE_URL_1} and ${ISSUE_URL_OTHER_REPO}`;
    const result = parseIssueUrlsFromOutput(text);
    expect(result).toHaveLength(2);
    expect(result[0].url).toBe(ISSUE_URL_1);
    expect(result[1].url).toBe(ISSUE_URL_OTHER_REPO);
  });

  it("deduplicates identical issue URLs", () => {
    const text = `${ISSUE_URL_1} and again ${ISSUE_URL_1}`;
    const result = parseIssueUrlsFromOutput(text);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe(ISSUE_URL_1);
  });

  it("extracts issue but not PR from mixed text", () => {
    const text = `PR: https://github.com/acme/repo/pull/10 Issue: ${ISSUE_URL_1}`;
    const result = parseIssueUrlsFromOutput(text);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe(ISSUE_URL_1);
  });

  it("works when called multiple times consecutively (regex lastIndex reset)", () => {
    // Exercises the global regex lastIndex reset
    const r1 = parseIssueUrlsFromOutput(ISSUE_URL_1);
    const r2 = parseIssueUrlsFromOutput(ISSUE_URL_2);
    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);
    expect(r1[0].number).toBe(42);
    expect(r2[0].number).toBe(99);
  });
});

// ─── extractIssueReferences ───────────────────────────────────────────────────

describe("extractIssueReferences", () => {
  it("returns [] for empty messages", () => {
    expect(extractIssueReferences([])).toEqual([]);
  });

  it("returns [] when messages have no issue URLs", () => {
    const msgs = [
      makeMessage({
        parts: [
          makeToolPart({
            state: { status: "completed", output: "no URLs here" },
          }),
        ],
      }),
    ];
    expect(extractIssueReferences(msgs)).toEqual([]);
  });

  it("extracts issue URLs from bash tool output", () => {
    const msgs = [
      makeMessage({
        parts: [
          makeToolPart({
            state: { status: "completed", output: `Created ${ISSUE_URL_1}` },
          }),
        ],
      }),
    ];
    const result = extractIssueReferences(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe(ISSUE_URL_1);
  });

  it("extracts issue URLs from text parts", () => {
    const msgs = [
      makeMessage({
        parts: [
          makeTextPart({ text: `See ${ISSUE_URL_2} for details` }),
        ],
      }),
    ];
    const result = extractIssueReferences(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe(ISSUE_URL_2);
  });

  it("ignores non-bash tool parts", () => {
    const msgs = [
      makeMessage({
        parts: [
          makeToolPart({
            tool: "todowrite",
            state: { status: "completed", output: ISSUE_URL_1 },
          }),
        ],
      }),
    ];
    expect(extractIssueReferences(msgs)).toEqual([]);
  });

  it("deduplicates across messages", () => {
    const msgs = [
      makeMessage({
        messageId: "m1",
        parts: [
          makeToolPart({
            state: { status: "completed", output: ISSUE_URL_1 },
          }),
        ],
      }),
      makeMessage({
        messageId: "m2",
        parts: [
          makeTextPart({ text: ISSUE_URL_1 }),
        ],
      }),
    ];
    const result = extractIssueReferences(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe(ISSUE_URL_1);
  });

  it("preserves first-appearance order", () => {
    const msgs = [
      makeMessage({
        messageId: "m1",
        parts: [
          makeToolPart({
            state: { status: "completed", output: ISSUE_URL_2 },
          }),
        ],
      }),
      makeMessage({
        messageId: "m2",
        parts: [
          makeToolPart({
            state: { status: "completed", output: ISSUE_URL_1 },
          }),
        ],
      }),
    ];
    const result = extractIssueReferences(msgs);
    expect(result).toHaveLength(2);
    expect(result[0].url).toBe(ISSUE_URL_2); // first appearance
    expect(result[1].url).toBe(ISSUE_URL_1);
  });

  it("extracts issues but not PRs from messages with both", () => {
    const msgs = [
      makeMessage({
        parts: [
          makeToolPart({
            state: {
              status: "completed",
              output: `PR: https://github.com/acme/repo/pull/10 Issue: ${ISSUE_URL_1}`,
            },
          }),
        ],
      }),
    ];
    const result = extractIssueReferences(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe(ISSUE_URL_1);
  });
});
