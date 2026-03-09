import {
  getTaskToolSessionId,
  getTaskToolInput,
  type AccumulatedToolPart,
} from "@/lib/api-types";

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal AccumulatedToolPart with an arbitrary state blob. */
function makePart(state: unknown): AccumulatedToolPart {
  return {
    partId: "p1",
    type: "tool",
    tool: "task",
    callId: "c1",
    state,
  } as AccumulatedToolPart;
}

// ─── getTaskToolSessionId ────────────────────────────────────────────────────

describe("getTaskToolSessionId", () => {
  it("returns null when state is null", () => {
    expect(getTaskToolSessionId(makePart(null))).toBeNull();
  });

  it("returns null when state is undefined", () => {
    expect(getTaskToolSessionId(makePart(undefined))).toBeNull();
  });

  it("returns null when state has no metadata or output", () => {
    expect(getTaskToolSessionId(makePart({}))).toBeNull();
  });

  it("returns null when metadata exists but has no sessionId", () => {
    expect(
      getTaskToolSessionId(makePart({ metadata: { foo: "bar" } }))
    ).toBeNull();
  });

  // ── metadata.sessionId (camelCase) ──

  it("extracts sessionId from state.metadata.sessionId (camelCase)", () => {
    expect(
      getTaskToolSessionId(
        makePart({ metadata: { sessionId: "ses_abc123" } })
      )
    ).toBe("ses_abc123");
  });

  // ── metadata.sessionID (SDK convention) ──

  it("extracts sessionID from state.metadata.sessionID (capital ID)", () => {
    expect(
      getTaskToolSessionId(
        makePart({ metadata: { sessionID: "ses_def456" } })
      )
    ).toBe("ses_def456");
  });

  it("prefers camelCase sessionId over capital sessionID", () => {
    expect(
      getTaskToolSessionId(
        makePart({
          metadata: { sessionId: "ses_camel", sessionID: "ses_capital" },
        })
      )
    ).toBe("ses_camel");
  });

  // ── output string parsing ──

  it("parses task_id from output string", () => {
    const output =
      "task_id: ses_32d33ab2bffeQN1UOiJ8eVKu9L (for resuming to continue this task if needed)\n\nSome result text here.";
    expect(getTaskToolSessionId(makePart({ output }))).toBe(
      "ses_32d33ab2bffeQN1UOiJ8eVKu9L"
    );
  });

  it("parses task_id with extra whitespace", () => {
    expect(
      getTaskToolSessionId(makePart({ output: "task_id:   ses_xyz789" }))
    ).toBe("ses_xyz789");
  });

  it("returns null when output is a non-matching string", () => {
    expect(
      getTaskToolSessionId(makePart({ output: "no session info here" }))
    ).toBeNull();
  });

  it("returns null when output is a number (not a string)", () => {
    expect(getTaskToolSessionId(makePart({ output: 42 }))).toBeNull();
  });

  it("prefers metadata over output parsing", () => {
    expect(
      getTaskToolSessionId(
        makePart({
          metadata: { sessionId: "ses_from_meta" },
          output: "task_id: ses_from_output",
        })
      )
    ).toBe("ses_from_meta");
  });
});

// ─── getTaskToolInput ────────────────────────────────────────────────────────

describe("getTaskToolInput", () => {
  it("returns null when state is null", () => {
    expect(getTaskToolInput(makePart(null))).toBeNull();
  });

  it("returns null when state has no input", () => {
    expect(getTaskToolInput(makePart({}))).toBeNull();
  });

  it("returns null when input has neither subagent_type nor description", () => {
    expect(getTaskToolInput(makePart({ input: { foo: "bar" } }))).toBeNull();
  });

  it("extracts subagent_type and description", () => {
    expect(
      getTaskToolInput(
        makePart({
          input: { subagent_type: "explore", description: "Find auth files" },
        })
      )
    ).toEqual({ subagent_type: "explore", description: "Find auth files" });
  });

  it("extracts subagent_type alone", () => {
    expect(
      getTaskToolInput(makePart({ input: { subagent_type: "thread" } }))
    ).toEqual({ subagent_type: "thread", description: undefined });
  });

  it("extracts description alone", () => {
    expect(
      getTaskToolInput(makePart({ input: { description: "Do stuff" } }))
    ).toEqual({ subagent_type: undefined, description: "Do stuff" });
  });
});
