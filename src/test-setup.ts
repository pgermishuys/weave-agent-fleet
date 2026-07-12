import "@testing-library/jest-dom";

if (typeof globalThis !== "undefined") {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}
