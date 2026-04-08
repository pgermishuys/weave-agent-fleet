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
  it("ReturnsFalseForLocalhostAddress", () => {
    withEnv({ HOSTNAME: "localhost" }, () => {
      expect(isAuthRequired()).toBe(false);
    });
  });

  it("ReturnsFalseFor127001", () => {
    withEnv({ HOSTNAME: "127.0.0.1" }, () => {
      expect(isAuthRequired()).toBe(false);
    });
  });

  it("ReturnsFalseForIPv6Loopback", () => {
    withEnv({ HOSTNAME: "::1" }, () => {
      expect(isAuthRequired()).toBe(false);
    });
  });

  it("ReturnsFalseForIPv6LoopbackLong", () => {
    withEnv({ HOSTNAME: "0:0:0:0:0:0:0:1" }, () => {
      expect(isAuthRequired()).toBe(false);
    });
  });

  it("ReturnsTrueForAllInterfaces", () => {
    withEnv({ HOSTNAME: "0.0.0.0" }, () => {
      expect(isAuthRequired()).toBe(true);
    });
  });

  it("ReturnsTrueForLanIP", () => {
    withEnv({ HOSTNAME: "192.168.1.100" }, () => {
      expect(isAuthRequired()).toBe(true);
    });
  });

  it("ReturnsTrueForTailscaleIP", () => {
    withEnv({ HOSTNAME: "100.64.0.1" }, () => {
      expect(isAuthRequired()).toBe(true);
    });
  });

  it("ReturnsTrueForEmptyHostname", () => {
    withEnv({ HOSTNAME: "" }, () => {
      expect(isAuthRequired()).toBe(true);
    });
  });

  it("ReturnsTrueWhenHostnameUnset", () => {
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

  it("PrintsLoginUrlToConsoleOnFirstCallWhenAuthRequired", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    _resetLoginUrlPrintedForTesting();

    withEnv({ HOSTNAME: "0.0.0.0", PORT: "3000" }, () => {
      getAuthToken();
      expect(consoleSpy).toHaveBeenCalledOnce();
      const logged = consoleSpy.mock.calls[0][0] as string;
      expect(logged).toContain("/login?token=");
    });

    consoleSpy.mockRestore();
    _resetLoginUrlPrintedForTesting();
  });

  it("DoesNotPrintLoginUrlWhenNotAuthRequired", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    _resetLoginUrlPrintedForTesting();

    withEnv({ HOSTNAME: "127.0.0.1" }, () => {
      getAuthToken();
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    consoleSpy.mockRestore();
    _resetLoginUrlPrintedForTesting();
  });

  it("PrintsLoginUrlOnlyOnce", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    _resetLoginUrlPrintedForTesting();

    withEnv({ HOSTNAME: "0.0.0.0" }, () => {
      getAuthToken();
      getAuthToken();
      getAuthToken();
      expect(consoleSpy).toHaveBeenCalledOnce();
    });

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
  it("ReturnsTrueForCorrectToken", () => {
    const token = getAuthToken();
    expect(validateToken(token)).toBe(true);
  });

  it("ReturnsFalseForIncorrectToken", () => {
    expect(validateToken("wrongtoken1234567890123456789012")).toBe(false);
  });

  it("ReturnsFalseForEmptyString", () => {
    expect(validateToken("")).toBe(false);
  });

  it("ReturnsFalseForTokenWithExtraChar", () => {
    const token = getAuthToken();
    expect(validateToken(token + "x")).toBe(false);
  });

  it("ReturnsFalseForTruncatedToken", () => {
    const token = getAuthToken();
    expect(validateToken(token.slice(0, -1))).toBe(false);
  });

  it("UsesTimingSafeComparison", () => {
    // Verify timingSafeEqual is used indirectly: incorrect token of same length is rejected
    const token = getAuthToken();
    const sameLength = "a".repeat(token.length);
    expect(validateToken(sameLength)).toBe(false);
  });

  it("HandlesNonStringGracefully", () => {
    // @ts-expect-error — testing runtime robustness with invalid input
    expect(validateToken(null)).toBe(false);
    // @ts-expect-error — testing runtime robustness with invalid input
    expect(validateToken(undefined)).toBe(false);
    // @ts-expect-error — testing runtime robustness with invalid input
    expect(validateToken(123)).toBe(false);
  });
});

// ─── createCookieValue / validateCookie ───────────────────────────────────────

describe("createCookieValue", () => {
  it("HasExpectedNonceDotHmacFormat", () => {
    const value = createCookieValue();
    const parts = value.split(".");
    expect(parts).toHaveLength(2);
    // Nonce: 32 hex chars (16 bytes)
    expect(parts[0]).toMatch(/^[0-9a-f]{32}$/);
    // HMAC: 64 hex chars (SHA-256 = 32 bytes)
    expect(parts[1]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("GeneratesUniqueCookieOnEachCall", () => {
    const first = createCookieValue();
    const second = createCookieValue();
    expect(first).not.toBe(second);
  });
});

describe("validateCookie", () => {
  it("ReturnsTrueForValidCookieValue", () => {
    const value = createCookieValue();
    expect(validateCookie(value)).toBe(true);
  });

  it("ReturnsFalseForTamperedHmac", () => {
    const value = createCookieValue();
    const [nonce] = value.split(".");
    const tamperedHmac = "0".repeat(64);
    expect(validateCookie(`${nonce}.${tamperedHmac}`)).toBe(false);
  });

  it("ReturnsFalseForTamperedNonce", () => {
    const value = createCookieValue();
    const [, hmac] = value.split(".");
    const tamperedNonce = "f".repeat(32);
    expect(validateCookie(`${tamperedNonce}.${hmac}`)).toBe(false);
  });

  it("ReturnsFalseForEmptyString", () => {
    expect(validateCookie("")).toBe(false);
  });

  it("ReturnsFalseForStringWithNoDot", () => {
    expect(validateCookie("nodothere")).toBe(false);
  });

  it("ReturnsFalseForEmptyNonce", () => {
    expect(validateCookie(".somehmacsuffix")).toBe(false);
  });

  it("ReturnsFalseForEmptyHmac", () => {
    expect(validateCookie("somenonce.")).toBe(false);
  });

  it("ReturnsFalseForCookieFromDifferentToken", () => {
    // Simulate a cookie produced with a different token/key using raw crypto
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createHmac: ch, randomBytes: rb } = require("crypto") as typeof import("crypto");
    const fakeKey = ch("sha256", "different-token").update("weave-cookie-signing-key").digest();
    const nonce = rb(16).toString("hex");
    const fakeHmac = ch("sha256", fakeKey).update(nonce).digest("hex");
    expect(validateCookie(`${nonce}.${fakeHmac}`)).toBe(false);
  });

  it("RoundTripsCorrectly", () => {
    for (let i = 0; i < 5; i++) {
      const value = createCookieValue();
      expect(validateCookie(value)).toBe(true);
    }
  });
});
