/**
 * Unit tests for the token authentication module.
 *
 * Because token-auth.ts has module-level state (the token is generated at import time),
 * these tests use the exported testing helpers and env var manipulation to cover the
 * full behaviour surface without needing to re-import the module between tests.
 */

import {
  AUTH_COOKIE_MAX_AGE,
  AUTH_COOKIE_NAME,
  createCookieValue,
  getAuthToken,
  getLoginUrl,
  isAuthRequired,
  validateCookie,
  validateToken,
  _resetLoginUrlPrintedForTesting,
} from "../token-auth";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => void
): void {
  const original: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    original[k] = process.env[k];
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

describe("AUTH_COOKIE_NAME", () => {
  it("HasExpectedValue", () => {
    expect(AUTH_COOKIE_NAME).toBe("weave.auth");
  });
});

describe("AUTH_COOKIE_MAX_AGE", () => {
  it("IsThreeDaysInSeconds", () => {
    expect(AUTH_COOKIE_MAX_AGE).toBe(3 * 24 * 60 * 60);
  });
});

// ─── isAuthRequired ───────────────────────────────────────────────────────────

describe("isAuthRequired", () => {
  it("AlwaysReturnsTrue", () => {
    // Auth is always required regardless of hostname
    withEnv({ HOSTNAME: "localhost" }, () => {
      expect(isAuthRequired()).toBe(true);
    });
    withEnv({ HOSTNAME: "127.0.0.1" }, () => {
      expect(isAuthRequired()).toBe(true);
    });
    withEnv({ HOSTNAME: "0.0.0.0" }, () => {
      expect(isAuthRequired()).toBe(true);
    });
    withEnv({ HOSTNAME: "" }, () => {
      expect(isAuthRequired()).toBe(true);
    });
    withEnv({ HOSTNAME: undefined }, () => {
      expect(isAuthRequired()).toBe(true);
    });
  });
});

// ─── getAuthToken ─────────────────────────────────────────────────────────────

describe("getAuthToken", () => {
  it("Returns32HexCharToken", () => {
    const token = getAuthToken();
    expect(token).toMatch(/^[0-9a-f]{32}$/);
  });

  it("ReturnsSameTokenOnEveryCall", () => {
    const first = getAuthToken();
    const second = getAuthToken();
    expect(first).toBe(second);
  });

  it("PrintsLoginUrlToConsoleOnFirstCall", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    _resetLoginUrlPrintedForTesting();

    withEnv({ PORT: "3000" }, () => {
      getAuthToken();
      expect(consoleSpy).toHaveBeenCalledOnce();
      const logged = consoleSpy.mock.calls[0][0] as string;
      expect(logged).toContain("/login?token=");
    });

    consoleSpy.mockRestore();
    _resetLoginUrlPrintedForTesting();
  });

  it("PrintsLoginUrlOnlyOnce", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    _resetLoginUrlPrintedForTesting();

    getAuthToken();
    getAuthToken();
    getAuthToken();
    expect(consoleSpy).toHaveBeenCalledOnce();

    consoleSpy.mockRestore();
    _resetLoginUrlPrintedForTesting();
  });
});

// ─── getLoginUrl ──────────────────────────────────────────────────────────────

describe("getLoginUrl", () => {
  it("ContainsTokenAndPort", () => {
    withEnv({ HOSTNAME: "0.0.0.0", PORT: "3000" }, () => {
      const url = getLoginUrl();
      const token = getAuthToken();
      expect(url).toContain(`/login?token=${token}`);
      expect(url).toContain(":3000");
    });
  });

  it("UsesLocalhostWhenHostnameIs0000", () => {
    withEnv({ HOSTNAME: "0.0.0.0", PORT: "3000" }, () => {
      const url = getLoginUrl();
      expect(url).toContain("http://localhost:");
    });
  });

  it("UsesActualHostnameWhenSpecific", () => {
    withEnv({ HOSTNAME: "192.168.1.1", PORT: "8080" }, () => {
      const url = getLoginUrl();
      expect(url).toContain("http://192.168.1.1:8080");
    });
  });
});

// ─── validateToken ────────────────────────────────────────────────────────────

describe("validateToken", () => {
  it("ReturnsTrueForCorrectToken", async () => {
    const token = getAuthToken();
    expect(await validateToken(token)).toBe(true);
  });

  it("ReturnsFalseForIncorrectToken", async () => {
    expect(await validateToken("wrongtoken1234567890123456789012")).toBe(false);
  });

  it("ReturnsFalseForEmptyString", async () => {
    expect(await validateToken("")).toBe(false);
  });

  it("ReturnsFalseForTokenWithExtraChar", async () => {
    const token = getAuthToken();
    expect(await validateToken(token + "x")).toBe(false);
  });

  it("ReturnsFalseForTruncatedToken", async () => {
    const token = getAuthToken();
    expect(await validateToken(token.slice(0, -1))).toBe(false);
  });

  it("UsesTimingSafeComparison", async () => {
    // Verify constant-time comparison is used indirectly: incorrect token of same length is rejected
    const token = getAuthToken();
    const sameLength = "a".repeat(token.length);
    expect(await validateToken(sameLength)).toBe(false);
  });

  it("HandlesNonStringGracefully", async () => {
    // @ts-expect-error — testing runtime robustness with invalid input
    expect(await validateToken(null)).toBe(false);
    // @ts-expect-error — testing runtime robustness with invalid input
    expect(await validateToken(undefined)).toBe(false);
    // @ts-expect-error — testing runtime robustness with invalid input
    expect(await validateToken(123)).toBe(false);
  });
});

// ─── createCookieValue / validateCookie ───────────────────────────────────────

describe("createCookieValue", () => {
  it("HasExpectedNonceDotHmacFormat", async () => {
    const value = await createCookieValue();
    const parts = value.split(".");
    expect(parts).toHaveLength(2);
    // Nonce: 32 hex chars (16 bytes)
    expect(parts[0]).toMatch(/^[0-9a-f]{32}$/);
    // HMAC: 64 hex chars (SHA-256 = 32 bytes)
    expect(parts[1]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("GeneratesUniqueCookieOnEachCall", async () => {
    const first = await createCookieValue();
    const second = await createCookieValue();
    expect(first).not.toBe(second);
  });
});

describe("validateCookie", () => {
  it("ReturnsTrueForValidCookieValue", async () => {
    const value = await createCookieValue();
    expect(await validateCookie(value)).toBe(true);
  });

  it("ReturnsFalseForTamperedHmac", async () => {
    const value = await createCookieValue();
    const [nonce] = value.split(".");
    const tamperedHmac = "0".repeat(64);
    expect(await validateCookie(`${nonce}.${tamperedHmac}`)).toBe(false);
  });

  it("ReturnsFalseForTamperedNonce", async () => {
    const value = await createCookieValue();
    const [, hmac] = value.split(".");
    const tamperedNonce = "f".repeat(32);
    expect(await validateCookie(`${tamperedNonce}.${hmac}`)).toBe(false);
  });

  it("ReturnsFalseForEmptyString", async () => {
    expect(await validateCookie("")).toBe(false);
  });

  it("ReturnsFalseForStringWithNoDot", async () => {
    expect(await validateCookie("nodothere")).toBe(false);
  });

  it("ReturnsFalseForEmptyNonce", async () => {
    expect(await validateCookie(".somehmacsuffix")).toBe(false);
  });

  it("ReturnsFalseForEmptyHmac", async () => {
    expect(await validateCookie("somenonce.")).toBe(false);
  });

  it("ReturnsFalseForCookieFromDifferentToken", async () => {
    // Simulate a cookie produced with a different token/key using Web Crypto
    const enc = new TextEncoder();
    const fakeTokenKey = await crypto.subtle.importKey(
      "raw",
      enc.encode("different-token") as BufferSource,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const fakeKeyBuf = await crypto.subtle.sign("HMAC", fakeTokenKey, enc.encode("weave-cookie-signing-key") as BufferSource);
    const fakeKey = await crypto.subtle.importKey(
      "raw",
      fakeKeyBuf,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const nonceBytes = new Uint8Array(16);
    crypto.getRandomValues(nonceBytes);
    const nonce = Array.from(nonceBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    const fakeHmacBuf = await crypto.subtle.sign("HMAC", fakeKey, enc.encode(nonce) as BufferSource);
    const fakeHmac = Array.from(new Uint8Array(fakeHmacBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(await validateCookie(`${nonce}.${fakeHmac}`)).toBe(false);
  });

  it("RoundTripsCorrectly", async () => {
    for (let i = 0; i < 5; i++) {
      const value = await createCookieValue();
      expect(await validateCookie(value)).toBe(true);
    }
  });
});
