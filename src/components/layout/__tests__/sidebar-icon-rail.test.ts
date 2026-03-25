import { describe, expect, it } from "vitest";
import {
  nextViewForSwitch,
  viewForPathname,
} from "@/components/layout/sidebar-icon-rail";

describe("viewForPathname", () => {
  it("maps fleet routes", () => {
    expect(viewForPathname("/")).toBe("fleet");
    expect(viewForPathname("/sessions/abc")).toBe("fleet");
  });

  it("maps github routes", () => {
    expect(viewForPathname("/github")).toBe("github");
    expect(viewForPathname("/github/octocat/hello-world")).toBe("github");
  });

  it("maps repositories routes", () => {
    expect(viewForPathname("/repositories")).toBe("repositories");
    expect(viewForPathname("/repositories/%2Fhome%2Fuser%2Fmy-project")).toBe("repositories");
  });

  it("maps welcome and ignores non-panel links", () => {
    expect(viewForPathname("/welcome")).toBe("welcome");
    expect(viewForPathname("/settings")).toBeNull();
  });
});

describe("nextViewForSwitch", () => {
  it("closes panel when clicking active fleet icon", () => {
    expect(nextViewForSwitch("fleet", "fleet")).toBe("welcome");
  });

  it("closes panel when clicking active github icon", () => {
    expect(nextViewForSwitch("github", "github")).toBe("welcome");
  });

  it("closes panel when clicking active repositories icon", () => {
    expect(nextViewForSwitch("repositories", "repositories")).toBe("welcome");
  });

  it("switches to repositories view", () => {
    expect(nextViewForSwitch("fleet", "repositories")).toBe("repositories");
    expect(nextViewForSwitch("welcome", "repositories")).toBe("repositories");
  });

  it("switches to target view for non-active or welcome views", () => {
    expect(nextViewForSwitch("welcome", "fleet")).toBe("fleet");
    expect(nextViewForSwitch("fleet", "github")).toBe("github");
    expect(nextViewForSwitch("welcome", "welcome")).toBe("welcome");
  });
});
