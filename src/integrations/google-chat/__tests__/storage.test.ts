// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  GOOGLE_CHAT_LAST_SPACE_KEY,
  clearGoogleChatClientState,
} from "@/integrations/google-chat/storage";

describe("google-chat storage helpers", () => {
  it("ClearsLastSpaceKey", () => {
    localStorage.setItem(GOOGLE_CHAT_LAST_SPACE_KEY, "spaces/ABC123");

    clearGoogleChatClientState();

    expect(localStorage.getItem(GOOGLE_CHAT_LAST_SPACE_KEY)).toBeNull();
  });

  it("ClearsAllWeaveGoogleChatKeys", () => {
    localStorage.setItem(GOOGLE_CHAT_LAST_SPACE_KEY, "spaces/ABC123");
    localStorage.setItem("weave:google-chat:someOtherKey", "value");
    localStorage.setItem("weave:github:unrelated", "keep");

    clearGoogleChatClientState();

    expect(localStorage.getItem(GOOGLE_CHAT_LAST_SPACE_KEY)).toBeNull();
    expect(localStorage.getItem("weave:google-chat:someOtherKey")).toBeNull();
    // Should not touch unrelated keys
    expect(localStorage.getItem("weave:github:unrelated")).toBe("keep");
  });

  it("DoesNotThrowWhenLocalStorageIsEmpty", () => {
    localStorage.clear();
    expect(() => clearGoogleChatClientState()).not.toThrow();
  });
});
