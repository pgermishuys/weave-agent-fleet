/**
 * Login page component tests.
 *
 * Mocks next/navigation (useSearchParams) and global fetch to isolate
 * the component from network and routing infrastructure.
 *
 * Navigation after login uses window.location.href (hard navigation) rather
 * than router.replace (client-side navigation) to avoid race conditions with
 * cookie availability. Tests assert on window.location.href assignments.
 */

import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import React from "react";
import { vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockSearchParamsGet = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: mockSearchParamsGet }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Set up a fetch mock that responds to /api/auth/status and /api/auth/login.
 *
 * @param opts.authRequired   - what /api/auth/status.authRequired returns
 * @param opts.authenticated  - what /api/auth/status.authenticated returns
 * @param opts.loginOk        - whether /api/auth/login returns 200
 */
function mockFetch(opts: {
  authRequired?: boolean;
  authenticated?: boolean;
  loginOk?: boolean;
}) {
  const { authRequired = true, authenticated = false, loginOk = true } = opts;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/auth/status") {
        return {
          ok: true,
          json: async () => ({ authRequired, authenticated }),
        } as Response;
      }
      if (url === "/api/auth/login") {
        return {
          ok: loginOk,
          json: async () => (loginOk ? { ok: true } : { error: "Invalid token" }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${String(url)}`);
    })
  );
}

function mockWindowHistoryReplaceState() {
  vi.stubGlobal(
    "history",
    { replaceState: vi.fn(), state: null, length: 0, scrollRestoration: "auto" }
  );
}

/**
 * Mock window.location so that href assignments are captured.
 * jsdom doesn't support navigation, so we use a spy-able descriptor.
 */
let locationHrefSpy: ReturnType<typeof vi.fn<(url: string) => void>>;

function mockWindowLocation(opts?: { pathname?: string; search?: string; href?: string }) {
  const pathname = opts?.pathname ?? "/login";
  const search = opts?.search ?? "";
  const href = opts?.href ?? `http://localhost:3000${pathname}${search}`;
  locationHrefSpy = vi.fn();

  // Delete the existing location property so we can redefine it
  // @ts-expect-error — jsdom location is not configurable by default
  delete window.location;

  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      pathname,
      search,
      href,
      get _hrefSetter() { return locationHrefSpy; },
    },
  });

  // Make href assignments callable as a setter
  Object.defineProperty(window.location, "href", {
    get: () => href,
    set: (val: string) => locationHrefSpy(val),
    configurable: true,
  });
}

async function renderLoginPage() {
  // Dynamic import so vi.mock() is applied before the module is loaded.
  const { default: LoginPage } = await import("../page");
  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(<LoginPage />);
  });
  return result!;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
  mockSearchParamsGet.mockReturnValue(null);
  mockWindowHistoryReplaceState();
  mockWindowLocation();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LoginPage — auth not required (legacy — auth is always required now)", () => {
  // When authRequired=false comes from the status endpoint, the login page
  // now just shows the form (no redirect). This tests that it doesn't crash.
  it("ShowsLoginFormWhenAuthStatusSaysNotRequired", async () => {
    mockFetch({ authRequired: false });
    await renderLoginPage();
    await waitFor(() => {
      expect(screen.getByLabelText("Access Token")).toBeTruthy();
    });
  });
});

describe("LoginPage — already authenticated", () => {
  it("RedirectsToRootWhenAlreadyAuthenticated", async () => {
    mockFetch({ authRequired: true, authenticated: true });
    await renderLoginPage();
    await waitFor(() => {
      expect(locationHrefSpy).toHaveBeenCalledWith("/");
    });
  });

  it("RedirectsToReturnUrlWhenAlreadyAuthenticated", async () => {
    mockFetch({ authRequired: true, authenticated: true });
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === "returnUrl" ? "/sessions/abc" : null
    );
    await renderLoginPage();
    await waitFor(() => {
      expect(locationHrefSpy).toHaveBeenCalledWith("/sessions/abc");
    });
  });
});

describe("LoginPage — token form rendering", () => {
  it("RendersTokenInputField", async () => {
    mockFetch({ authRequired: true, authenticated: false });
    await renderLoginPage();
    await waitFor(() => expect(screen.queryByRole("status")).toBeFalsy());

    expect(screen.getByLabelText("Access Token")).toBeTruthy();
  });

  it("RendersSignInButton", async () => {
    mockFetch({ authRequired: true, authenticated: false });
    await renderLoginPage();
    await waitFor(() => expect(screen.queryByRole("status")).toBeFalsy());

    expect(screen.getByRole("button", { name: /sign in/i })).toBeTruthy();
  });

  it("SignInButtonDisabledWhenTokenEmpty", async () => {
    mockFetch({ authRequired: true, authenticated: false });
    await renderLoginPage();
    await waitFor(() => expect(screen.queryByRole("status")).toBeFalsy());

    const button = screen.getByRole("button", { name: /sign in/i });
    expect(button).toHaveProperty("disabled", true);
  });

  it("SignInButtonEnabledWhenTokenEntered", async () => {
    mockFetch({ authRequired: true, authenticated: false });
    await renderLoginPage();
    await waitFor(() => expect(screen.queryByRole("status")).toBeFalsy());

    const input = screen.getByLabelText("Access Token");
    await act(async () => {
      fireEvent.change(input, { target: { value: "abc123" } });
    });

    const button = screen.getByRole("button", { name: /sign in/i });
    expect(button).toHaveProperty("disabled", false);
  });
});

describe("LoginPage — manual form submission", () => {
  it("SubmitsTokenAndRedirectsOnSuccess", async () => {
    mockFetch({ authRequired: true, authenticated: false, loginOk: true });
    await renderLoginPage();
    await waitFor(() => expect(screen.queryByRole("status")).toBeFalsy());

    const input = screen.getByLabelText("Access Token");
    await act(async () => {
      fireEvent.change(input, { target: { value: "my-test-token" } });
    });
    await act(async () => {
      fireEvent.submit(input.closest("form")!);
    });

    await waitFor(() => {
      expect(locationHrefSpy).toHaveBeenCalledWith("/");
    });
  });

  it("SubmitsTokenAndRedirectsToReturnUrl", async () => {
    mockFetch({ authRequired: true, authenticated: false, loginOk: true });
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === "returnUrl" ? "/sessions/abc" : null
    );
    await renderLoginPage();
    await waitFor(() => expect(screen.queryByRole("status")).toBeFalsy());

    const input = screen.getByLabelText("Access Token");
    await act(async () => {
      fireEvent.change(input, { target: { value: "my-test-token" } });
    });
    await act(async () => {
      fireEvent.submit(input.closest("form")!);
    });

    await waitFor(() => {
      expect(locationHrefSpy).toHaveBeenCalledWith("/sessions/abc");
    });
  });

  it("ShowsErrorOnInvalidToken", async () => {
    mockFetch({ authRequired: true, authenticated: false, loginOk: false });
    await renderLoginPage();
    await waitFor(() => expect(screen.queryByRole("status")).toBeFalsy());

    const input = screen.getByLabelText("Access Token");
    await act(async () => {
      fireEvent.change(input, { target: { value: "wrong-token" } });
    });
    await act(async () => {
      fireEvent.submit(input.closest("form")!);
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
    expect(screen.getByRole("alert").textContent).toContain("Invalid token");
  });

  it("ClearsErrorWhenUserEditsTokenAfterFailure", async () => {
    mockFetch({ authRequired: true, authenticated: false, loginOk: false });
    await renderLoginPage();
    await waitFor(() => expect(screen.queryByRole("status")).toBeFalsy());

    const input = screen.getByLabelText("Access Token");
    await act(async () => {
      fireEvent.change(input, { target: { value: "wrong-token" } });
      fireEvent.submit(input.closest("form")!);
    });
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());

    // Now edit the token — error should clear
    await act(async () => {
      fireEvent.change(input, { target: { value: "new-token" } });
    });
    expect(screen.queryByRole("alert")).toBeFalsy();
  });
});

describe("LoginPage — auto-submit from URL token", () => {
  it("AutoSubmitsTokenFromUrlParam", async () => {
    mockFetch({ authRequired: true, authenticated: false, loginOk: true });
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === "token" ? "url-token-value" : null
    );
    await renderLoginPage();

    await waitFor(() => {
      expect(locationHrefSpy).toHaveBeenCalledWith("/");
    });
    // Verify login was called with the URL token
    const fetchMock = vi.mocked(global.fetch);
    const loginCall = fetchMock.mock.calls.find(
      ([url]) => url === "/api/auth/login"
    );
    expect(loginCall).toBeTruthy();
  });

  it("ShowsErrorWhenAutoSubmittedUrlTokenIsInvalid", async () => {
    mockFetch({ authRequired: true, authenticated: false, loginOk: false });
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === "token" ? "bad-url-token" : null
    );
    await renderLoginPage();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
  });

  it("StripsTokenFromUrlAfterAutoSubmit", async () => {
    mockFetch({ authRequired: true, authenticated: false, loginOk: true });
    mockWindowLocation({
      pathname: "/login",
      search: "?token=abc",
      href: "http://localhost:3000/login?token=abc",
    });
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === "token" ? "url-token-value" : null
    );
    await renderLoginPage();

    await waitFor(() => {
      // history.replaceState should have been called to strip the token
      expect((history.replaceState as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    });
  });
});

describe("LoginPage — returnUrl open redirect protection", () => {
  it("RedirectsToRootForAbsoluteReturnUrl", async () => {
    // Use authenticated: true to trigger the redirect path (getSafeReturnUrl)
    mockFetch({ authRequired: true, authenticated: true });
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === "returnUrl" ? "https://evil.com/steal" : null
    );
    await renderLoginPage();
    await waitFor(() => {
      expect(locationHrefSpy).toHaveBeenCalledWith("/");
    });
  });

  it("RedirectsToRootForProtocolRelativeReturnUrl", async () => {
    mockFetch({ authRequired: true, authenticated: true });
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === "returnUrl" ? "//evil.com/steal" : null
    );
    await renderLoginPage();
    await waitFor(() => {
      expect(locationHrefSpy).toHaveBeenCalledWith("/");
    });
  });

  it("AllowsValidRelativeReturnUrl", async () => {
    mockFetch({ authRequired: true, authenticated: true });
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === "returnUrl" ? "/sessions/abc-123" : null
    );
    await renderLoginPage();
    await waitFor(() => {
      expect(locationHrefSpy).toHaveBeenCalledWith("/sessions/abc-123");
    });
  });
});
