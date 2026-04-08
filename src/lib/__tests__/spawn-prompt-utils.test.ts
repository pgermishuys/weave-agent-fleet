import { describe, it, expect } from "vitest";
import { formatSpawnPrompt, generateBranchName, deriveTitle } from "@/lib/spawn-prompt-utils";

// ─── formatSpawnPrompt ───────────────────────────────────────────────────────

describe("formatSpawnPrompt", () => {
  const baseOpts = {
    selectedText: "Refactor the authentication module to use JWT tokens.",
    sessionTitle: "Auth Overhaul",
    sourceSessionId: "ses_abc123",
  };

  it("returns well-formed markdown with all required sections", () => {
    const result = formatSpawnPrompt(baseOpts);

    expect(result).toContain("# Task:");
    expect(result).toContain("## Context");
    expect(result).toContain(`"${baseOpts.sessionTitle}"`);
    expect(result).toContain(baseOpts.sourceSessionId);
    expect(result).toContain("## Selected Text");
    expect(result).toContain(baseOpts.selectedText);
    expect(result).toContain("---");
    expect(result).toContain("Complete this task independently.");
  });

  it("includes conversationSummary in Instructions section when provided", () => {
    const result = formatSpawnPrompt({
      ...baseOpts,
      conversationSummary: "Focus on the login and token refresh flows.",
    });

    expect(result).toContain("## Instructions");
    expect(result).toContain("Focus on the login and token refresh flows.");
  });

  it("omits Instructions section when conversationSummary is absent", () => {
    const result = formatSpawnPrompt(baseOpts);
    expect(result).not.toContain("## Instructions");
  });

  it("omits Instructions section when conversationSummary is blank whitespace", () => {
    const result = formatSpawnPrompt({ ...baseOpts, conversationSummary: "   " });
    expect(result).not.toContain("## Instructions");
  });

  it("derives title from first ~60 chars of selected text", () => {
    const result = formatSpawnPrompt({
      ...baseOpts,
      selectedText: "Fix the bug in the user registration form validation logic.",
    });
    // Title should appear after "# Task: "
    expect(result).toMatch(/^# Task: .+/m);
    const titleLine = result.split("\n").find((l) => l.startsWith("# Task:")) ?? "";
    expect(titleLine.length).toBeLessThanOrEqual("# Task: ".length + 60);
  });

  it("handles very long selected text without overflowing the title", () => {
    const longText = "A".repeat(200);
    const result = formatSpawnPrompt({ ...baseOpts, selectedText: longText });
    const titleLine = result.split("\n").find((l) => l.startsWith("# Task:")) ?? "";
    // Title portion (after "# Task: ") must be <= 60 chars
    const titlePart = titleLine.replace("# Task: ", "");
    expect(titlePart.length).toBeLessThanOrEqual(60);
  });

  it("includes the full selected text even when very long", () => {
    const longText = "B".repeat(2000);
    const result = formatSpawnPrompt({ ...baseOpts, selectedText: longText });
    expect(result).toContain(longText);
  });

  it("handles empty optional conversationSummary gracefully", () => {
    expect(() => formatSpawnPrompt({ ...baseOpts, conversationSummary: "" })).not.toThrow();
  });

  it("embeds session title and ID in context block", () => {
    const result = formatSpawnPrompt({
      selectedText: "Do something",
      sessionTitle: "My Special Session",
      sourceSessionId: "ses_xyz999",
    });
    expect(result).toContain('"My Special Session"');
    expect(result).toContain("ses_xyz999");
  });
});

// ─── deriveTitle ─────────────────────────────────────────────────────────────

describe("deriveTitle", () => {
  it("returns a short title from normal text", () => {
    const t = deriveTitle("Refactor the auth module to use JWT tokens.");
    expect(t).toBeTruthy();
    expect(t.length).toBeLessThanOrEqual(60);
  });

  it("strips markdown heading syntax", () => {
    const t = deriveTitle("## Fix the login bug");
    expect(t).not.toContain("#");
  });

  it("strips bold/italic markers", () => {
    const t = deriveTitle("**Important**: fix the **auth** bug");
    expect(t).not.toContain("**");
  });

  it("strips inline code", () => {
    const t = deriveTitle("Call `authenticate()` with JWT");
    expect(t).not.toContain("`");
  });

  it("strips markdown links", () => {
    const t = deriveTitle("See [this guide](https://example.com) for details");
    expect(t).not.toContain("[");
    expect(t).not.toContain("(https");
  });

  it("truncates to 60 chars", () => {
    const t = deriveTitle("A".repeat(200));
    expect(t.length).toBeLessThanOrEqual(60);
  });

  it("returns 'New Task' for empty or whitespace-only text", () => {
    expect(deriveTitle("")).toBe("New Task");
    expect(deriveTitle("   ")).toBe("New Task");
  });

  it("collapses newlines to spaces", () => {
    const t = deriveTitle("Fix\nthe\nbug");
    expect(t).not.toContain("\n");
  });
});

// ─── generateBranchName ──────────────────────────────────────────────────────

describe("generateBranchName", () => {
  it("prefixes with 'weave/'", () => {
    expect(generateBranchName("fix auth bug")).toMatch(/^weave\//);
  });

  it("lowercases the text", () => {
    const b = generateBranchName("Fix Auth Bug");
    expect(b).toBe("weave/fix-auth-bug");
  });

  it("replaces spaces with hyphens", () => {
    const b = generateBranchName("refactor auth module");
    expect(b).toBe("weave/refactor-auth-module");
  });

  it("strips special characters", () => {
    const b = generateBranchName("fix: auth bug (critical!)");
    expect(b).not.toMatch(/[():!]/);
  });

  it("collapses multiple hyphens", () => {
    const b = generateBranchName("fix---the---bug");
    expect(b).toBe("weave/fix-the-bug");
  });

  it("strips leading and trailing hyphens from the slug", () => {
    const b = generateBranchName("  - fix auth -  ");
    expect(b).toMatch(/^weave\/[^-].*[^-]$/);
  });

  it("truncates slug to 50 chars (not counting prefix)", () => {
    const b = generateBranchName("a".repeat(200));
    const slug = b.replace("weave/", "");
    expect(slug.length).toBeLessThanOrEqual(50);
  });

  it("produces 'weave/session' for empty/whitespace-only text", () => {
    expect(generateBranchName("")).toBe("weave/session");
    expect(generateBranchName("   ")).toBe("weave/session");
  });

  it("strips characters that are invalid in git branch names", () => {
    const b = generateBranchName("fix@auth#bug$now%here");
    // Only a-z, 0-9, and hyphens (plus the weave/ prefix) should remain
    expect(b).toMatch(/^weave\/[a-z0-9-]+$/);
  });

  it("produces consistent output for typical session text", () => {
    expect(generateBranchName("Refactor the authentication module to use JWT")).toBe(
      "weave/refactor-the-authentication-module-to-use-jwt"
    );
  });
});
