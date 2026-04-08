// @vitest-environment jsdom
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRef } from "react";
import { useTextSelection } from "@/hooks/use-text-selection";

// ─── jsdom shims ──────────────────────────────────────────────────────────────

// jsdom does not implement Range.getBoundingClientRect — stub it.
if (typeof Range !== "undefined" && !Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () =>
    ({
      top: 100,
      bottom: 120,
      left: 50,
      right: 200,
      width: 150,
      height: 20,
      x: 50,
      y: 100,
      toJSON: () => ({}),
    } as DOMRect);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Creates a DOM element, adds it to document.body, and returns it. */
function createContainer(): HTMLDivElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

/**
 * Builds a minimal fake Selection that the hook can query.
 * `anchorNode` is the node used for the `contains()` check.
 */
function buildSelection(opts: {
  text: string;
  anchorNode: Node | null;
  collapsed?: boolean;
}): Selection {
  const range = document.createRange();
  // Create a text node with the selected text (for getRangeAt)
  const textNode = document.createTextNode(opts.text);
  document.body.appendChild(textNode);
  range.selectNode(textNode);

  return {
    isCollapsed: opts.collapsed ?? false,
    rangeCount: opts.collapsed ? 0 : 1,
    anchorNode: opts.anchorNode,
    toString: () => opts.text,
    getRangeAt: () => range,
    removeAllRanges: vi.fn(),
  } as unknown as Selection;
}

/** Fires a `selectionchange` event on `document`. */
function fireSelectionChange() {
  document.dispatchEvent(new Event("selectionchange"));
}

/** Runs fake timers forward past the debounce window. */
async function flushDebounce(ms = 200) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("useTextSelection", () => {
  let container: HTMLDivElement;
  let getSelectionSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    container = createContainer();
    getSelectionSpy = vi.spyOn(window, "getSelection");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("returns null initially (no selection)", () => {
    getSelectionSpy.mockReturnValue(null);

    const { result } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(container);
      return useTextSelection(ref);
    });

    expect(result.current).toBeNull();
  });

  it("returns null when selection is collapsed", async () => {
    getSelectionSpy.mockReturnValue(
      buildSelection({ text: "", anchorNode: container, collapsed: true })
    );

    const { result } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(container);
      return useTextSelection(ref);
    });

    act(() => fireSelectionChange());
    await flushDebounce();

    expect(result.current).toBeNull();
  });

  it("returns null when selected text is below the minimum length threshold", async () => {
    // Default minLength is 10 — use 5-char text
    const shortText = "Hello";
    getSelectionSpy.mockReturnValue(
      buildSelection({ text: shortText, anchorNode: container })
    );

    const { result } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(container);
      return useTextSelection(ref);
    });

    act(() => fireSelectionChange());
    await flushDebounce();

    expect(result.current).toBeNull();
  });

  it("returns selection state when text is long enough and inside the container", async () => {
    const selectedText = "This is a long enough selection text for the hook.";
    getSelectionSpy.mockReturnValue(
      buildSelection({ text: selectedText, anchorNode: container })
    );

    const { result } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(container);
      return useTextSelection(ref);
    });

    act(() => fireSelectionChange());
    await flushDebounce();

    expect(result.current).not.toBeNull();
    expect(result.current?.text).toBe(selectedText);
    expect(result.current?.rect).toBeDefined();
  });

  it("returns null when selection anchor is outside the container", async () => {
    const outside = document.createElement("div");
    document.body.appendChild(outside);

    const selectedText = "This is a selection outside the container.";
    getSelectionSpy.mockReturnValue(
      buildSelection({ text: selectedText, anchorNode: outside })
    );

    const { result } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(container);
      return useTextSelection(ref);
    });

    act(() => fireSelectionChange());
    await flushDebounce();

    expect(result.current).toBeNull();
  });

  it("clears immediately (no debounce) when selection becomes collapsed", async () => {
    // First: establish a valid selection
    const selectedText = "This is a long enough selection text.";
    getSelectionSpy.mockReturnValue(
      buildSelection({ text: selectedText, anchorNode: container })
    );

    const { result } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(container);
      return useTextSelection(ref);
    });

    act(() => fireSelectionChange());
    await flushDebounce();
    expect(result.current).not.toBeNull();

    // Then: simulate selection collapse
    getSelectionSpy.mockReturnValue(
      buildSelection({ text: "", anchorNode: null, collapsed: true })
    );

    // Fire selectionchange — should clear immediately without waiting for debounce
    act(() => fireSelectionChange());

    // Should be null right away (no timer advancement needed)
    expect(result.current).toBeNull();
  });

  it("clears immediately when selection moves outside the container", async () => {
    // First: valid selection inside container
    const selectedText = "This is a long enough selection text.";
    getSelectionSpy.mockReturnValue(
      buildSelection({ text: selectedText, anchorNode: container })
    );

    const { result } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(container);
      return useTextSelection(ref);
    });

    act(() => fireSelectionChange());
    await flushDebounce();
    expect(result.current).not.toBeNull();

    // Then: selection moves outside
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    getSelectionSpy.mockReturnValue(
      buildSelection({ text: "Outside text here.", anchorNode: outside })
    );

    act(() => fireSelectionChange());

    // Should clear immediately without debounce
    expect(result.current).toBeNull();
  });

  it("debounces updates — does not update until debounce period passes", async () => {
    const selectedText = "This is a long enough selection text.";
    getSelectionSpy.mockReturnValue(
      buildSelection({ text: selectedText, anchorNode: container })
    );

    const { result } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(container);
      return useTextSelection(ref, 10, 150);
    });

    act(() => fireSelectionChange());

    // Before debounce fires, result should still be null
    expect(result.current).toBeNull();

    // Advance past the debounce threshold
    await flushDebounce(200);

    expect(result.current).not.toBeNull();
    expect(result.current?.text).toBe(selectedText);
  });

  it("respects a custom minLength threshold", async () => {
    const tenCharText = "1234567890";
    getSelectionSpy.mockReturnValue(
      buildSelection({ text: tenCharText, anchorNode: container })
    );

    // minLength = 20 — 10-char text should NOT trigger
    const { result } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(container);
      return useTextSelection(ref, 20);
    });

    act(() => fireSelectionChange());
    await flushDebounce();

    expect(result.current).toBeNull();
  });

  it("cleans up the event listener on unmount", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");

    const { unmount } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(container);
      return useTextSelection(ref);
    });

    expect(addSpy).toHaveBeenCalledWith("selectionchange", expect.any(Function));

    unmount();

    expect(removeSpy).toHaveBeenCalledWith("selectionchange", expect.any(Function));
  });
});
