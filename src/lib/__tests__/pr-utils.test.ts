import { isBashTool, parsePrUrlsFromOutput, extractPrReferences } from "@/lib/pr-utils";
import type { AccumulatedMessage, AccumulatedToolPart, AccumulatedTextPart } from "@/lib/api-types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMessage(overrides: Partial<AccumulatedMessage> = {}): AccumulatedMessage {
  return {
    messageId: "msg-1",
    sessionId: "sess-1",
    role: "assistant",
    parts: [],
    ...overrides,
  };
}

function makeToolPart(overrides: Partial<AccumulatedToolPart> = {}): AccumulatedToolPart {
  return {
    partId: "part-1",
    type: "tool",
    tool: "bash",
    callId: "call-1",
    state: { status: "completed", output: "" },
    ...overrides,
  };
}

function makeTextPart(overrides: Partial<AccumulatedTextPart> = {}): AccumulatedTextPart {
  return {
    partId: "text-part-1",
    type: "text",
    text: "hello",
    ...overrides,
  };
}

const PR_URL_1 = "https://github.com/acme/my-repo/pull/42";
const PR_URL_2 = "https://github.com/acme/my-repo/pull/99";
const PR_URL_OTHER_REPO = "https://github.com/other-org/other-repo/pull/7";

// ─── isBashTool ────────────────────────────────────────────────────────────────

describe("isBashTool", () => {
  it('returns true for "bash"', () => {
    expect(isBashTool("bash")).toBe(true);
  });

  it('returns true for "Bash" (mixed case)', () => {
    expect(isBashTool("Bash")).toBe(true);
  });

  it('returns true for "BASH" (upper case)', () => {
    expect(isBashTool("BASH")).toBe(true);
  });

  it('returns false for "Bash_tool"', () => {
    expect(isBashTool("Bash_tool")).toBe(false);
  });

  it('returns false for "shell"', () => {
    expect(isBashTool("shell")).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isBashTool("")).toBe(false);
  });

  it('returns false for "todowrite"', () => {
    expect(isBashTool("todowrite")).toBe(false);
  });
});

// ─── parsePrUrlsFromOutput ─────────────────────────────────────────────────────

describe("parsePrUrlsFromOutput", () => {
  it("returns [] for null", () => {
    expect(parsePrUrlsFromOutput(null)).toEqual([]);
  });

  it("returns [] for undefined", () => {
    expect(parsePrUrlsFromOutput(undefined)).toEqual([]);
  });

  it("returns [] for a number", () => {
    expect(parsePrUrlsFromOutput(42)).toEqual([]);
  });

  it("returns [] for an object", () => {
    expect(parsePrUrlsFromOutput({ url: PR_URL_1 })).toEqual([]);
  });

  it("returns [] for empty string", () => {
    expect(parsePrUrlsFromOutput("")).toEqual([]);
  });

  it("returns [] for whitespace-only string", () => {
    expect(parsePrUrlsFromOutput("   \n  ")).toEqual([]);
  });

  it("returns [] for a string with no URLs", () => {
    expect(parsePrUrlsFromOutput("Successfully merged branch main")).toEqual([]);
  });

  it("returns [] for a GitHub issue URL (not a PR URL)", () => {
    expect(parsePrUrlsFromOutput("https://github.com/acme/repo/issues/10")).toEqual([]);
  });

  it("returns [] for a non-GitHub URL", () => {
    expect(parsePrUrlsFromOutput("https://gitlab.com/acme/repo/pull/5")).toEqual([]);
  });

  it("extracts a single PR URL from a string", () => {
    const result = parsePrUrlsFromOutput(`Pull request created: ${PR_URL_1}`);
    expect(result).toEqual([
      { owner: "acme", repo: "my-repo", number: 42, url: PR_URL_1 },
    ]);
  });

  it("extracts multiple distinct PR URLs from a string", () => {
    const result = parsePrUrlsFromOutput(`PR1: ${PR_URL_1}\nPR2: ${PR_URL_2}`);
    expect(result).toHaveLength(2);
    expect(result[0].url).toBe(PR_URL_1);
    expect(result[1].url).toBe(PR_URL_2);
  });

  it("deduplicates repeated PR URLs", () => {
    const result = parsePrUrlsFromOutput(`${PR_URL_1}\n${PR_URL_1}`);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe(PR_URL_1);
  });

  it("correctly parses owner, repo, number from URL", () => {
    const result = parsePrUrlsFromOutput(PR_URL_1);
    expect(result[0]).toEqual({ owner: "acme", repo: "my-repo", number: 42, url: PR_URL_1 });
  });

  it("handles URL with trailing newline or text after the number", () => {
    const output = `Created: ${PR_URL_1}\nSome follow-up text`;
    const result = parsePrUrlsFromOutput(output);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe(PR_URL_1);
  });

  it("handles typical gh pr create output format", () => {
    const output = `\nhttps://github.com/acme/my-repo/pull/42\n`;
    const result = parsePrUrlsFromOutput(output);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ owner: "acme", repo: "my-repo", number: 42, url: PR_URL_1 });
  });
});

// ─── extractPrReferences ──────────────────────────────────────────────────────

describe("extractPrReferences", () => {
  it("returns [] for empty messages array", () => {
    expect(extractPrReferences([])).toEqual([]);
  });

  it("returns [] for messages with only text parts (no PR URLs)", () => {
    const messages = [makeMessage({ parts: [makeTextPart({ text: "Hello world" })] })];
    expect(extractPrReferences(messages)).toEqual([]);
  });

  it("returns [] for messages with bash parts but no PR URLs in output", () => {
    const messages = [
      makeMessage({
        parts: [
          makeToolPart({
            tool: "bash",
            state: { status: "completed", output: "Ran successfully" },
          }),
        ],
      }),
    ];
    expect(extractPrReferences(messages)).toEqual([]);
  });

  it("returns [] for messages with non-bash tool parts containing PR URLs", () => {
    const messages = [
      makeMessage({
        parts: [
          makeToolPart({
            tool: "todowrite",
            state: { status: "completed", output: `PR created: ${PR_URL_1}` },
          }),
        ],
      }),
    ];
    expect(extractPrReferences(messages)).toEqual([]);
  });

  it("extracts a PR URL from a bash tool part output", () => {
    const messages = [
      makeMessage({
        parts: [
          makeToolPart({
            tool: "bash",
            state: { status: "completed", output: `Created: ${PR_URL_1}` },
          }),
        ],
      }),
    ];
    const result = extractPrReferences(messages);
    expect(result).toEqual([
      { owner: "acme", repo: "my-repo", number: 42, url: PR_URL_1 },
    ]);
  });

  it("collects PRs from multiple messages", () => {
    const messages = [
      makeMessage({
        messageId: "msg-1",
        parts: [
          makeToolPart({
            partId: "p1",
            tool: "bash",
            state: { status: "completed", output: PR_URL_1 },
          }),
        ],
      }),
      makeMessage({
        messageId: "msg-2",
        parts: [
          makeToolPart({
            partId: "p2",
            tool: "bash",
            state: { status: "completed", output: PR_URL_2 },
          }),
        ],
      }),
    ];
    const result = extractPrReferences(messages);
    expect(result).toHaveLength(2);
    expect(result[0].url).toBe(PR_URL_1);
    expect(result[1].url).toBe(PR_URL_2);
  });

  it("deduplicates PR URLs across multiple messages", () => {
    const messages = [
      makeMessage({
        messageId: "msg-1",
        parts: [makeToolPart({ partId: "p1", state: { status: "completed", output: PR_URL_1 } })],
      }),
      makeMessage({
        messageId: "msg-2",
        parts: [makeToolPart({ partId: "p2", state: { status: "completed", output: PR_URL_1 } })],
      }),
    ];
    const result = extractPrReferences(messages);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe(PR_URL_1);
  });

  it("also detects PR URLs from text parts", () => {
    const messages = [
      makeMessage({
        parts: [
          makeTextPart({ text: `I created a PR: ${PR_URL_1}` }),
        ],
      }),
    ];
    const result = extractPrReferences(messages);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe(PR_URL_1);
  });

  it("deduplicates when same URL appears in both bash output and text part", () => {
    const messages = [
      makeMessage({
        parts: [
          makeToolPart({ state: { status: "completed", output: PR_URL_1 } }),
          makeTextPart({ text: `PR: ${PR_URL_1}` }),
        ],
      }),
    ];
    const result = extractPrReferences(messages);
    expect(result).toHaveLength(1);
  });

  it("collects PRs from different repos in the same session", () => {
    const messages = [
      makeMessage({
        parts: [
          makeToolPart({
            state: { status: "completed", output: `${PR_URL_1}\n${PR_URL_OTHER_REPO}` },
          }),
        ],
      }),
    ];
    const result = extractPrReferences(messages);
    expect(result).toHaveLength(2);
    expect(result[0].url).toBe(PR_URL_1);
    expect(result[1].url).toBe(PR_URL_OTHER_REPO);
  });

  it("preserves first-appearance order across messages", () => {
    const messages = [
      makeMessage({
        messageId: "msg-1",
        parts: [makeToolPart({ partId: "p1", state: { status: "completed", output: PR_URL_OTHER_REPO } })],
      }),
      makeMessage({
        messageId: "msg-2",
        parts: [makeToolPart({ partId: "p2", state: { status: "completed", output: PR_URL_1 } })],
      }),
    ];
    const result = extractPrReferences(messages);
    expect(result[0].url).toBe(PR_URL_OTHER_REPO);
    expect(result[1].url).toBe(PR_URL_1);
  });

  it("handles non-completed bash parts (still scans output)", () => {
    const messages = [
      makeMessage({
        parts: [
          makeToolPart({
            tool: "bash",
            state: { status: "running", output: PR_URL_1 },
          }),
        ],
      }),
    ];
    const result = extractPrReferences(messages);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe(PR_URL_1);
  });

  it("handles mixed tool types — only scans bash and text parts", () => {
    const messages = [
      makeMessage({
        parts: [
          makeTextPart({ partId: "txt", text: "some text" }),
          makeToolPart({
            partId: "todo-part",
            tool: "todowrite",
            state: { status: "completed", output: PR_URL_2 },
          }),
          makeToolPart({
            partId: "bash-part",
            tool: "bash",
            state: { status: "completed", output: PR_URL_1 },
          }),
        ],
      }),
    ];
    const result = extractPrReferences(messages);
    // Only PR_URL_1 (bash) should be found; PR_URL_2 in todowrite output is ignored
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe(PR_URL_1);
  });
});
