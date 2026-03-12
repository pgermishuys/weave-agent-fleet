import { getToolLabel } from "@/lib/tool-labels";

describe("getToolLabel", () => {
  // ─── bash ──────────────────────────────────────────────────────────────────

  it("returns description for bash when present", () => {
    expect(getToolLabel("bash", { description: "Install deps", command: "npm install" })).toBe(
      "Install deps",
    );
  });

  it("falls back to truncated command for bash when description is missing", () => {
    const cmd = "echo hello world";
    expect(getToolLabel("bash", { command: cmd })).toBe(cmd);
  });

  it("truncates long bash commands at 60 chars", () => {
    const longCmd = "a".repeat(80);
    const result = getToolLabel("bash", { command: longCmd });
    expect(result).toHaveLength(61); // 60 + "…"
    expect(result.endsWith("…")).toBe(true);
  });

  it("falls back to 'bash' when input is null", () => {
    expect(getToolLabel("bash", null)).toBe("bash");
  });

  it("falls back to 'bash' when input has no description or command", () => {
    expect(getToolLabel("bash", {})).toBe("bash");
  });

  // ─── read ──────────────────────────────────────────────────────────────────

  it("returns filePath for read", () => {
    expect(getToolLabel("read", { filePath: "src/index.ts" })).toBe("src/index.ts");
  });

  it("shortens long file paths for read", () => {
    const longPath = "/Users/someone/very/deep/nested/project/src/components/feature/index.ts";
    const result = getToolLabel("read", { filePath: longPath });
    expect(result).toBe("…/feature/index.ts");
  });

  it("falls back to 'read' when input is null", () => {
    expect(getToolLabel("read", null)).toBe("read");
  });

  it("falls back to 'read' when filePath is missing", () => {
    expect(getToolLabel("read", {})).toBe("read");
  });

  // ─── edit ──────────────────────────────────────────────────────────────────

  it("returns filePath for edit", () => {
    expect(getToolLabel("edit", { filePath: "src/utils.ts" })).toBe("src/utils.ts");
  });

  it("shortens long file paths for edit", () => {
    const longPath = "/Users/someone/very/deep/nested/project/src/components/feature/utils.ts";
    const result = getToolLabel("edit", { filePath: longPath });
    expect(result).toBe("…/feature/utils.ts");
  });

  it("falls back to 'edit' when input is null", () => {
    expect(getToolLabel("edit", null)).toBe("edit");
  });

  // ─── write ─────────────────────────────────────────────────────────────────

  it("returns filePath for write", () => {
    expect(getToolLabel("write", { filePath: "src/new-file.ts" })).toBe("src/new-file.ts");
  });

  it("falls back to 'write' when input is null", () => {
    expect(getToolLabel("write", null)).toBe("write");
  });

  // ─── glob ──────────────────────────────────────────────────────────────────

  it("returns pattern for glob", () => {
    expect(getToolLabel("glob", { pattern: "**/*.ts" })).toBe("**/*.ts");
  });

  it("falls back to 'glob' when input is null", () => {
    expect(getToolLabel("glob", null)).toBe("glob");
  });

  it("falls back to 'glob' when pattern is missing", () => {
    expect(getToolLabel("glob", {})).toBe("glob");
  });

  // ─── grep ──────────────────────────────────────────────────────────────────

  it("returns pattern for grep", () => {
    expect(getToolLabel("grep", { pattern: "TODO" })).toBe("TODO");
  });

  it("falls back to 'grep' when input is null", () => {
    expect(getToolLabel("grep", null)).toBe("grep");
  });

  // ─── webfetch ──────────────────────────────────────────────────────────────

  it("returns url for webfetch", () => {
    expect(getToolLabel("webfetch", { url: "https://example.com" })).toBe(
      "https://example.com",
    );
  });

  it("falls back to 'webfetch' when input is null", () => {
    expect(getToolLabel("webfetch", null)).toBe("webfetch");
  });

  // ─── skill ─────────────────────────────────────────────────────────────────

  it("returns name for skill", () => {
    expect(getToolLabel("skill", { name: "fleet-orchestration" })).toBe(
      "fleet-orchestration",
    );
  });

  it("falls back to 'skill' when input is null", () => {
    expect(getToolLabel("skill", null)).toBe("skill");
  });

  // ─── unknown tools ────────────────────────────────────────────────────────

  it("returns tool name for unknown tools", () => {
    expect(getToolLabel("my_custom_tool", { foo: "bar" })).toBe("my_custom_tool");
  });

  it("returns tool name for unknown tools with null input", () => {
    expect(getToolLabel("something", null)).toBe("something");
  });

  // ─── edge cases ───────────────────────────────────────────────────────────

  it("ignores non-string description for bash", () => {
    expect(getToolLabel("bash", { description: 123, command: "ls" })).toBe("ls");
  });

  it("ignores empty string description for bash", () => {
    expect(getToolLabel("bash", { description: "", command: "ls" })).toBe("ls");
  });

  it("ignores non-string filePath for read", () => {
    expect(getToolLabel("read", { filePath: 42 })).toBe("read");
  });

  it("handles path with only two segments", () => {
    // A long-ish path with only 2 segments — can't shorten further
    const twoSegPath = "a".repeat(30) + "/" + "b".repeat(30);
    expect(getToolLabel("read", { filePath: twoSegPath })).toBe(twoSegPath);
  });
});
