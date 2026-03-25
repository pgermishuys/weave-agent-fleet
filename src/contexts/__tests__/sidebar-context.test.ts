// @vitest-environment jsdom

import React from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  SidebarProvider,
  useSidebar,
  viewHasPanel,
} from "@/contexts/sidebar-context";

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(SidebarProvider, null, children);
}

describe("sidebar context", () => {
  it("restores the last panel view when toggled open", () => {
    localStorage.clear();
    const { result } = renderHook(() => useSidebar(), { wrapper });

    act(() => {
      result.current.setActiveView("github");
    });
    expect(result.current.activeView).toBe("github");
    expect(result.current.panelOpen).toBe(true);

    act(() => {
      result.current.toggleSidebar();
    });
    expect(result.current.activeView).toBe("welcome");
    expect(result.current.panelOpen).toBe(false);

    act(() => {
      result.current.toggleSidebar();
    });
    expect(result.current.activeView).toBe("github");
    expect(result.current.panelOpen).toBe(true);
  });

  it("tracks panel visibility by view", () => {
    expect(viewHasPanel("fleet")).toBe(true);
    expect(viewHasPanel("github")).toBe(true);
    expect(viewHasPanel("repositories")).toBe(true);
    expect(viewHasPanel("welcome")).toBe(false);
  });

  it("restores the last panel view (repositories) when toggled open", () => {
    localStorage.clear();
    const { result } = renderHook(() => useSidebar(), { wrapper });

    act(() => {
      result.current.setActiveView("repositories");
    });
    expect(result.current.activeView).toBe("repositories");
    expect(result.current.panelOpen).toBe(true);

    act(() => {
      result.current.toggleSidebar();
    });
    expect(result.current.activeView).toBe("welcome");
    expect(result.current.panelOpen).toBe(false);

    act(() => {
      result.current.toggleSidebar();
    });
    expect(result.current.activeView).toBe("repositories");
    expect(result.current.panelOpen).toBe(true);
  });
});
