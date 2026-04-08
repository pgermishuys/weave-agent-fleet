/**
 * Login page component tests.
 *
 * Mocks next/navigation (useSearchParams, useRouter) and global fetch to isolate
 * the component from network and routing infrastructure.
 */

import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import React from "react";
import { vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRouterReplace = vi.fn();
const mockSearchParamsGet = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockRouterReplace }),
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
  mockRouterReplace.mockReset();
  mockSearchParamsGet.mockReturnValue(null);
  mockWindowHistoryReplaceState();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LoginPage — auth not required", () => {
  it("RedirectsToRootWhenAuthNotRequired", async () => {
    mockFetch({ authRequired: false });
    await renderLoginPage();
    await waitFor(() => {
      expect(mockRouterReplace).toHaveBeenCalledWith("/");
    });
  });

  it("RedirectsToReturnUrlWhenAuthNotRequired", async () => {
    mockFetch({ authRequired: false });
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === "returnUrl" ? "/sessions/abc" : null
    );
    await renderLoginPage();
    await waitFor(() => {
      expect(mockRouterReplace).toHaveBeenCalledWith("/sessions/abc");
    });
  });
});

describe("LoginPage — already authenticated", () => {
  it("RedirectsToRootWhenAlreadyAuthenticated", async () => {
    mockFetch({ authRequired: true, authenticated: true });
    await renderLoginPage();
    await waitFor(() => {
      expect(mockRouterReplace).toHaveBeenCalledWith("/");
    });
  });

  it("RedirectsToReturnUrlWhenAlreadyAuthenticated", async () => {
    mockFetch({ authRequired: true, authenticated: true });
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === "returnUrl" ? "/sessions/abc" : null
    );
    await renderLoginPage();
    await waitFor(() => {
      expect(mockRouterReplace).toHaveBeenCalledWith("/sessions/abc");
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
      expect(mockRouterReplace).toHaveBeenCalledWith("/");
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
      expect(mockRouterReplace).toHaveBeenCalledWith("/sessions/abc");
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
      expect(mockRouterReplace).toHaveBeenCalledWith("/");
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
    // Simulate window.location.search containing token=
    Object.defineProperty(window, "location", {
      value: { href: "http://localhost:3000/login?token=abc", search: "?token=abc" },
      writable: true,
      configurable: true,
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
    mockFetch({ authRequired: false });
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === "returnUrl" ? "https://evil.com/steal" : null
    );
    await renderLoginPage();
    await waitFor(() => {
      expect(mockRouterReplace).toHaveBeenCalledWith("/");
    });
  });

  it("RedirectsToRootForProtocolRelativeReturnUrl", async () => {
    mockFetch({ authRequired: false });
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === "returnUrl" ? "//evil.com/steal" : null
    );
    await renderLoginPage();
    await waitFor(() => {
      expect(mockRouterReplace).toHaveBeenCalledWith("/");
    });
  });

  it("AllowsValidRelativeReturnUrl", async () => {
    mockFetch({ authRequired: false });
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === "returnUrl" ? "/sessions/abc-123" : null
    );
    await renderLoginPage();
    await waitFor(() => {
      expect(mockRouterReplace).toHaveBeenCalledWith("/sessions/abc-123");
    });
  });
});
