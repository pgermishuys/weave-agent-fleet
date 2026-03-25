import { parseSlashCommand, isSlashCommand, extractSlashCommandText } from "@/lib/slash-command-utils";

// ─── parseSlashCommand ────────────────────────────────────────────────────────

describe("parseSlashCommand", () => {
  it("ParsesSimpleCommandWithNoArgs", () => {
    const result = parseSlashCommand("/metrics");
    expect(result).toEqual({ command: "metrics", args: "" });
  });

  it("ParsesCommandWithMultipleArgs", () => {
    const result = parseSlashCommand("/compact arg1 arg2");
    expect(result).toEqual({ command: "compact", args: "arg1 arg2" });
  });

  it("ReturnsNullForBareSlashOnly", () => {
    expect(parseSlashCommand("/")).toBeNull();
  });

  it("ReturnsNullForSlashFollowedBySpaceOnly", () => {
    expect(parseSlashCommand("/ ")).toBeNull();
  });

  it("ReturnsNullForTextWithoutLeadingSlash", () => {
    expect(parseSlashCommand("not a command")).toBeNull();
  });

  it("ReturnsNullForEmptyString", () => {
    expect(parseSlashCommand("")).toBeNull();
  });

  it("ReturnsNullForWhitespaceOnlyString", () => {
    expect(parseSlashCommand("   ")).toBeNull();
  });

  it("ParsesWhitespacePrefixedSlashCommand", () => {
    const result = parseSlashCommand("  /command");
    expect(result).toEqual({ command: "command", args: "" });
  });

  it("ParsesCommandWithLeadingWhitespaceAndArgs", () => {
    const result = parseSlashCommand("  /compact foo bar");
    expect(result).toEqual({ command: "compact", args: "foo bar" });
  });

  it("TrimsTrailingWhitespaceFromArgs", () => {
    const result = parseSlashCommand("/compact arg1  ");
    expect(result).toEqual({ command: "compact", args: "arg1" });
  });
});

// ─── isSlashCommand ───────────────────────────────────────────────────────────

describe("isSlashCommand", () => {
  it("ReturnsTrueForSlashCommand", () => {
    expect(isSlashCommand("/metrics")).toBe(true);
  });

  it("ReturnsTrueForSlashCommandWithArgs", () => {
    expect(isSlashCommand("/compact arg1 arg2")).toBe(true);
  });

  it("ReturnsTrueForBareSlash", () => {
    expect(isSlashCommand("/")).toBe(true);
  });

  it("ReturnsTrueForWhitespacePrefixedSlashCommand", () => {
    expect(isSlashCommand("  /command")).toBe(true);
  });

  it("ReturnsFalseForPlainText", () => {
    expect(isSlashCommand("not a command")).toBe(false);
  });

  it("ReturnsFalseForEmptyString", () => {
    expect(isSlashCommand("")).toBe(false);
  });

  it("ReturnsFalseForWhitespaceOnlyString", () => {
    expect(isSlashCommand("   ")).toBe(false);
  });

  it("ReturnsFalseForTextStartingWithNonSlash", () => {
    expect(isSlashCommand("hello /world")).toBe(false);
  });
});

// ─── extractSlashCommandText ──────────────────────────────────────────────────

describe("extractSlashCommandText", () => {
  it("ReturnsCommandForSimpleStringChild", () => {
    expect(extractSlashCommandText("/start-work")).toBe("/start-work");
  });

  it("ReturnsCommandWithArgsForStringChild", () => {
    expect(extractSlashCommandText("/compact arg1 arg2")).toBe("/compact arg1 arg2");
  });

  it("ReturnsNullForNonSlashText", () => {
    expect(extractSlashCommandText("some code")).toBeNull();
  });

  it("ReturnsNullForEmptyString", () => {
    expect(extractSlashCommandText("")).toBeNull();
  });

  it("ReturnsNullForBareSlash", () => {
    expect(extractSlashCommandText("/")).toBeNull();
  });

  it("ReturnsCommandForArrayOfStringNodes", () => {
    // React children can be arrays — concatenation should still yield a valid command
    expect(extractSlashCommandText(["/start", "-work"])).toBe("/start-work");
  });

  it("ReturnsNullForProseContainingSlashCommand", () => {
    // Guards against "run /start-work now" being considered a command
    expect(extractSlashCommandText("run /start-work now")).toBeNull();
  });

  it("ReturnsNullForNull", () => {
    expect(extractSlashCommandText(null)).toBeNull();
  });

  it("ReturnsNullForUndefined", () => {
    expect(extractSlashCommandText(undefined)).toBeNull();
  });

  it("TrimsWhitespaceAroundValidCommand", () => {
    expect(extractSlashCommandText("  /start-work  ")).toBe("/start-work");
  });
});
