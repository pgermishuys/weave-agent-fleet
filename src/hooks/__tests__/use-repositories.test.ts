import { describe, expect, it } from "vitest";
import { groupByRoot } from "@/hooks/use-repositories";
import type { ScannedRepository } from "@/lib/api-types";

describe("groupByRoot", () => {
  it("returns an empty map for empty input", () => {
    const result = groupByRoot([]);
    expect(result.size).toBe(0);
  });

  it("groups repositories by parent root", () => {
    const repos: ScannedRepository[] = [
      { name: "project-a", path: "/home/user/repos/project-a", parentRoot: "/home/user/repos" },
      { name: "project-b", path: "/home/user/repos/project-b", parentRoot: "/home/user/repos" },
      { name: "other", path: "/work/other", parentRoot: "/work" },
    ];

    const result = groupByRoot(repos);

    expect(result.size).toBe(2);
    expect(result.get("/home/user/repos")).toHaveLength(2);
    expect(result.get("/work")).toHaveLength(1);
  });

  it("sorts repositories alphabetically within each group", () => {
    const repos: ScannedRepository[] = [
      { name: "zebra", path: "/root/zebra", parentRoot: "/root" },
      { name: "apple", path: "/root/apple", parentRoot: "/root" },
      { name: "mango", path: "/root/mango", parentRoot: "/root" },
    ];

    const result = groupByRoot(repos);
    const names = result.get("/root")?.map((r) => r.name);
    expect(names).toEqual(["apple", "mango", "zebra"]);
  });

  it("handles repositories with different roots", () => {
    const repos: ScannedRepository[] = [
      { name: "a", path: "/root1/a", parentRoot: "/root1" },
      { name: "b", path: "/root2/b", parentRoot: "/root2" },
      { name: "c", path: "/root3/c", parentRoot: "/root3" },
    ];

    const result = groupByRoot(repos);
    expect(result.size).toBe(3);
  });
});

describe("path encoding roundtrip", () => {
  it("encodes and decodes Unix paths correctly", () => {
    const original = "/home/user/my-project";
    const encoded = encodeURIComponent(original);
    const decoded = decodeURIComponent(encoded);
    expect(decoded).toBe(original);
    // Ensure encoded form is a single URL segment (no slashes)
    expect(encoded).not.toContain("/");
  });

  it("encodes and decodes Windows paths correctly", () => {
    const original = "C:\\repos\\my-project";
    const encoded = encodeURIComponent(original);
    const decoded = decodeURIComponent(encoded);
    expect(decoded).toBe(original);
    expect(encoded).not.toContain("\\");
  });

  it("handles paths with spaces and special chars", () => {
    const original = "/home/user/my project (2024)";
    const encoded = encodeURIComponent(original);
    const decoded = decodeURIComponent(encoded);
    expect(decoded).toBe(original);
  });
});
