import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/server/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  storePendingSession,
  consumePendingSession,
  pendingSessionCount,
  clearPendingSessions,
} from "@/app/api/integrations/google-chat/auth/_pkce";
import { createHash } from "crypto";

describe("PKCE utilities", () => {
  beforeEach(() => clearPendingSessions());
  afterEach(() => clearPendingSessions());

  describe("generateCodeVerifier", () => {
    it("ReturnsStringOf86Characters", () => {
      const verifier = generateCodeVerifier();
      // 64 bytes → 86 base64url chars
      expect(verifier).toHaveLength(86);
    });

    it("ContainsOnlyBase64UrlCharacters", () => {
      const verifier = generateCodeVerifier();
      expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it("GeneratesUniqueValuesEachCall", () => {
      const a = generateCodeVerifier();
      const b = generateCodeVerifier();
      expect(a).not.toBe(b);
    });
  });

  describe("generateCodeChallenge", () => {
    it("ProducesSha256Base64UrlOfVerifier", () => {
      const verifier = generateCodeVerifier();
      const challenge = generateCodeChallenge(verifier);
      const expected = createHash("sha256")
        .update(verifier)
        .digest("base64url");
      expect(challenge).toBe(expected);
    });

    it("ContainsOnlyBase64UrlCharacters", () => {
      const challenge = generateCodeChallenge(generateCodeVerifier());
      expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it("IsDeterministicForSameVerifier", () => {
      const verifier = generateCodeVerifier();
      expect(generateCodeChallenge(verifier)).toBe(
        generateCodeChallenge(verifier)
      );
    });
  });

  describe("generateState", () => {
    it("ReturnsNonEmptyString", () => {
      const state = generateState();
      expect(state.length).toBeGreaterThan(0);
    });

    it("ContainsOnlyBase64UrlCharacters", () => {
      const state = generateState();
      expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it("GeneratesUniqueValuesEachCall", () => {
      const a = generateState();
      const b = generateState();
      expect(a).not.toBe(b);
    });
  });

  describe("storePendingSession + consumePendingSession", () => {
    it("StoresAndRetrievesCodeVerifier", () => {
      const state = generateState();
      const verifier = generateCodeVerifier();
      storePendingSession(state, verifier);
      const result = consumePendingSession(state);
      expect(result).toBe(verifier);
    });

    it("ConsumesSessionOnFirstRead", () => {
      const state = generateState();
      storePendingSession(state, generateCodeVerifier());
      consumePendingSession(state);
      // Second read should return null
      expect(consumePendingSession(state)).toBeNull();
    });

    it("ReturnsNullForUnknownState", () => {
      expect(consumePendingSession("nonexistent-state")).toBeNull();
    });

    it("EvictsOldestEntryWhenAtCapacity", () => {
      const states: string[] = [];
      for (let i = 0; i < 10; i++) {
        const state = `state-${i}`;
        states.push(state);
        storePendingSession(state, generateCodeVerifier());
      }
      expect(pendingSessionCount()).toBe(10);

      // Adding an 11th should evict the first
      storePendingSession("state-11", generateCodeVerifier());
      expect(pendingSessionCount()).toBe(10);
      // First entry should have been evicted
      expect(consumePendingSession("state-0")).toBeNull();
    });

    it("PrunesExpiredEntriesOnGet", () => {
      const state = generateState();
      storePendingSession(state, generateCodeVerifier());

      // Manually backdating the session by patching internal timing
      // We do this by using Date.now mock
      const realDateNow = Date.now;
      const futureTime = realDateNow() + 11 * 60 * 1000; // 11 minutes later
      vi.spyOn(Date, "now").mockReturnValue(futureTime);

      const result = consumePendingSession(state);
      expect(result).toBeNull();

      vi.spyOn(Date, "now").mockRestore();
    });
  });
});
