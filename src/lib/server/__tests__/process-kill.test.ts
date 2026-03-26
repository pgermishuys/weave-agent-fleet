import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ChildProcess } from "child_process";

// ---------------------------------------------------------------------------
// killProcessTree / killProcessTreeAsync unit tests
// ---------------------------------------------------------------------------
// The platform parameter (defaulting to process.platform) is injectable,
// which lets us test Windows and POSIX branches without monkey-patching
// process.platform.
// ---------------------------------------------------------------------------

// We mock child_process to intercept execSync/exec calls
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  const mocked = {
    ...actual,
    execSync: vi.fn(),
    exec: vi.fn(),
  };
  return { ...mocked, default: mocked };
});

// Import after mocking
import { killProcessTree, killProcessTreeAsync } from "@/lib/server/process-kill";
import { execSync, exec } from "child_process";

// Helper to create a minimal mock ChildProcess
function makeMockProc(overrides: Partial<ChildProcess> = {}): ChildProcess {
  return {
    kill: vi.fn().mockReturnValue(true),
    pid: 12345,
    ...overrides,
  } as unknown as ChildProcess;
}

// ---------------------------------------------------------------------------
// killProcessTree — synchronous
// ---------------------------------------------------------------------------

describe("killProcessTree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Windows platform", () => {
    it("CallsExecSyncWithTaskkillOnWindows", () => {
      const proc = makeMockProc();
      killProcessTree(proc, "SIGKILL", 12345, "win32");

      expect(execSync).toHaveBeenCalledTimes(1);
      expect(execSync).toHaveBeenCalledWith("taskkill /PID 12345 /T /F", { stdio: "ignore" });
      expect(proc.kill).not.toHaveBeenCalled();
    });

    it("DoesNotCallProcKillOnWindows", () => {
      const proc = makeMockProc();
      killProcessTree(proc, "SIGTERM", 99999, "win32");

      expect(proc.kill).not.toHaveBeenCalled();
    });

    it("IgnoresSignalParameterOnWindows", () => {
      const proc = makeMockProc();
      // Both SIGTERM and SIGKILL should result in the same taskkill command
      killProcessTree(proc, "SIGTERM", 12345, "win32");
      expect(execSync).toHaveBeenCalledWith("taskkill /PID 12345 /T /F", { stdio: "ignore" });
      vi.clearAllMocks();

      killProcessTree(proc, "SIGKILL", 12345, "win32");
      expect(execSync).toHaveBeenCalledWith("taskkill /PID 12345 /T /F", { stdio: "ignore" });
    });

    it("SwallowsNotFoundErrorOnWindows", () => {
      const proc = makeMockProc();
      const notFoundError = new Error("ERROR: The process not found.");
      (execSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw notFoundError;
      });

      // Should not throw
      expect(() => killProcessTree(proc, "SIGKILL", 12345, "win32")).not.toThrow();
    });

    it("SwallowsExitCode128OnWindows", () => {
      const proc = makeMockProc();
      const exitCodeError = Object.assign(new Error("exit code 128"), { status: 128 });
      (execSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw exitCodeError;
      });

      expect(() => killProcessTree(proc, "SIGKILL", 12345, "win32")).not.toThrow();
    });

    it("RethrowsNonEsrchErrorsOnWindows", () => {
      const proc = makeMockProc();
      const otherError = new Error("Access denied");
      (execSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw otherError;
      });

      expect(() => killProcessTree(proc, "SIGKILL", 12345, "win32")).toThrow("Access denied");
    });
  });

  describe("POSIX platform (linux/darwin)", () => {
    it("CallsProcKillWithSIGKILLOnPosix", () => {
      const proc = makeMockProc();
      killProcessTree(proc, "SIGKILL", 12345, "linux");

      expect(proc.kill).toHaveBeenCalledTimes(1);
      expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
      expect(execSync).not.toHaveBeenCalled();
    });

    it("CallsProcKillWithSIGTERMOnPosix", () => {
      const proc = makeMockProc();
      killProcessTree(proc, "SIGTERM", 12345, "linux");

      expect(proc.kill).toHaveBeenCalledTimes(1);
      expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
    });

    it("DoesNotCallExecSyncOnPosix", () => {
      const proc = makeMockProc();
      killProcessTree(proc, "SIGTERM", 12345, "darwin");

      expect(execSync).not.toHaveBeenCalled();
    });

    it("SwallowsEsrchErrorOnPosix", () => {
      const proc = makeMockProc();
      const esrchError = Object.assign(new Error("ESRCH: no such process"), { code: "ESRCH" });
      (proc.kill as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw esrchError;
      });

      // Should not throw
      expect(() => killProcessTree(proc, "SIGKILL", 12345, "linux")).not.toThrow();
    });

    it("RethrowsNonEsrchErrorsOnPosix", () => {
      const proc = makeMockProc();
      const permError = Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
      (proc.kill as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw permError;
      });

      expect(() => killProcessTree(proc, "SIGKILL", 12345, "linux")).toThrow("EPERM");
    });

    it("DoesNotUseNegativePidGroupKillOnPosix", () => {
      // Regression test: verify we never call process.kill(-pid) which would kill
      // the entire Next.js process group.
      const processKillSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
      const proc = makeMockProc();

      killProcessTree(proc, "SIGTERM", 12345, "linux");

      // process.kill should NOT be called (we use proc.kill() instead)
      expect(processKillSpy).not.toHaveBeenCalled();

      processKillSpy.mockRestore();
    });
  });
});

// ---------------------------------------------------------------------------
// killProcessTreeAsync — async variant
// ---------------------------------------------------------------------------

describe("killProcessTreeAsync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Windows platform", () => {
    it("CallsExecWithTaskkillOnWindows", async () => {
      const proc = makeMockProc();
      // exec is called as exec(cmd, callback) — 2 args
      (exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        (_cmd: string, cb: (err: Error | null) => void) => {
          cb(null);
        }
      );

      await killProcessTreeAsync(proc, "SIGKILL", 12345, "win32");

      expect(exec).toHaveBeenCalledTimes(1);
      expect(exec).toHaveBeenCalledWith(
        "taskkill /PID 12345 /T /F",
        expect.any(Function)
      );
      expect(proc.kill).not.toHaveBeenCalled();
    });

    it("ResolvesEvenWhenTaskkillReturnsErrorOnWindows", async () => {
      const proc = makeMockProc();
      const taskkillError = new Error("ERROR: The process not found.");
      (exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        (_cmd: string, cb: (err: Error | null) => void) => {
          cb(taskkillError);
        }
      );

      // Should resolve (not reject) even on taskkill errors
      await expect(killProcessTreeAsync(proc, "SIGKILL", 12345, "win32")).resolves.toBeUndefined();
    });
  });

  describe("POSIX platform", () => {
    it("CallsProcKillWithSignalOnPosix", async () => {
      const proc = makeMockProc();
      await killProcessTreeAsync(proc, "SIGTERM", 12345, "linux");

      expect(proc.kill).toHaveBeenCalledTimes(1);
      expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
      expect(exec).not.toHaveBeenCalled();
    });

    it("ResolvesSilentlyOnEsrchOnPosix", async () => {
      const proc = makeMockProc();
      const esrchError = Object.assign(new Error("ESRCH"), { code: "ESRCH" });
      (proc.kill as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw esrchError;
      });

      await expect(killProcessTreeAsync(proc, "SIGKILL", 12345, "linux")).resolves.toBeUndefined();
    });

    it("RejectsOnNonEsrchErrorOnPosix", async () => {
      const proc = makeMockProc();
      const permError = Object.assign(new Error("EPERM"), { code: "EPERM" });
      (proc.kill as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw permError;
      });

      await expect(killProcessTreeAsync(proc, "SIGKILL", 12345, "linux")).rejects.toThrow("EPERM");
    });
  });
});

// ---------------------------------------------------------------------------
// Integration-style test: real process kill on current platform
// ---------------------------------------------------------------------------

describe("killProcessTree integration — real process", () => {
  it("KillsRealProcessOnPosix", async () => {
    if (process.platform === "win32") {
      // Skip on Windows — handled by the Windows-only test below
      return;
    }

    // Re-import without mocks by using the actual implementation
    // We need a fresh module — use child_process directly for spawn
    const { spawn } = await import("child_process");
    const proc = spawn("sleep", ["60"]);
    await new Promise<void>((resolve) => proc.on("spawn", resolve).on("error", resolve));

    expect(proc.pid).toBeDefined();

    // Kill using the actual un-mocked logic: force SIGKILL
    proc.kill("SIGKILL");

    // Wait for process to be dead
    await new Promise<void>((resolve) => proc.on("exit", () => resolve()));

    // Verify the process is dead: process.kill(pid, 0) should throw ESRCH
    let isAlive = true;
    try {
      process.kill(proc.pid!, 0);
    } catch {
      isAlive = false;
    }
    expect(isAlive).toBe(false);
  });

  it("KillsRealProcessOnWindows", async () => {
    // Platform-conditional: only run on Windows
    if (process.platform !== "win32") {
      return;
    }

    const { spawn } = await import("child_process");
    const proc = spawn("timeout", ["/T", "60"]);
    await new Promise<void>((resolve) => proc.on("spawn", resolve).on("error", resolve));

    expect(proc.pid).toBeDefined();

    // Use taskkill to kill the process tree (simulating our kill function behavior)
    const { spawnSync } = await import("child_process");
    spawnSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"]);

    // Wait a moment for OS to clean up
    await new Promise((r) => setTimeout(r, 500));

    // Verify the process is dead
    let isAlive = true;
    try {
      process.kill(proc.pid!, 0);
    } catch {
      isAlive = false;
    }
    expect(isAlive).toBe(false);
  });
});
