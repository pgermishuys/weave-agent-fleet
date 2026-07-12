import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "../route";
import type { NextRequest } from "next/server";
import * as opcodeClient from "@/lib/server/opencode-client";
import * as dbRepository from "@/lib/server/db-repository";

// ─── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("@/lib/server/opencode-client");
vi.mock("@/lib/server/db-repository");
vi.mock("@/lib/server/logger", () => ({
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

// ─── Helpers ───────────────────────────────────────────────────────────────

function mockSession(overrides = {}) {
  return {
    id: "db-session-1",
    opencodeId: "ses_123abc",
    instance_id: "instance-1",
    directory: "/test/dir",
    status: "idle",
    ...overrides,
  };
}

function mockRequest(body: Record<string, unknown>): Partial<NextRequest> {
  return {
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Partial<NextRequest>;
}

function mockRouteContext(sessionId: string, questionId: string) {
  return {
    params: Promise.resolve({
      id: sessionId,
      questionId,
    }),
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("POST /api/sessions/[id]/questions/[questionId]/reply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Request validation", () => {
    it("rejects invalid questionId (contains special characters)", async () => {
      const req = mockRequest({ answers: [["answer"]] }) as NextRequest;
      const ctx = mockRouteContext("ses_123", "que../../etc/passwd");

      const response = await POST(req, ctx as any);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("Invalid question ID");
    });

    it("rejects malformed JSON", async () => {
      const req = {
        json: vi.fn().mockRejectedValue(new SyntaxError("Invalid JSON")),
      } as unknown as NextRequest;
      const ctx = mockRouteContext("ses_123", "que_abc123");

      const response = await POST(req, ctx as any);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("Invalid JSON");
    });

    it("rejects missing answers array", async () => {
      const req = mockRequest({ somethingElse: "value" }) as NextRequest;
      const ctx = mockRouteContext("ses_123", "que_abc123");

      const response = await POST(req, ctx as any);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("answers must be string[][]");
    });

    it("rejects answers that is not an array", async () => {
      const req = mockRequest({ answers: "not an array" }) as NextRequest;
      const ctx = mockRouteContext("ses_123", "que_abc123");

      const response = await POST(req, ctx as any);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("answers must be string[][]");
    });

    it("rejects answers with non-string elements", async () => {
      const req = mockRequest({ answers: [[123]] }) as NextRequest;
      const ctx = mockRouteContext("ses_123", "que_abc123");

      const response = await POST(req, ctx as any);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("answers must be string[][]");
    });
  });

  describe("Session lookup", () => {
    it("returns 404 if session not found in DB", async () => {
      vi.mocked(dbRepository.getSessionByOpencodeId).mockReturnValue(null);

      const req = mockRequest({ answers: [["answer"]] }) as NextRequest;
      const ctx = mockRouteContext("ses_notfound", "que_abc123");

      const response = await POST(req, ctx as any);
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toContain("Session not found");
    });
  });

  describe("All answers skipped", () => {
    it("calls rejectQuestion when all answers are ['skipped']", async () => {
      const session = mockSession();
      vi.mocked(dbRepository.getSessionByOpencodeId).mockReturnValue(session as any);
      vi.mocked(opcodeClient.rejectQuestion).mockResolvedValue({
        ok: true,
        status: 200,
        alreadyAnswered: false,
        body: null,
      });

      const req = mockRequest({ answers: [["skipped"]] }) as NextRequest;
      const ctx = mockRouteContext("ses_123", "que_abc123");

      const response = await POST(req, ctx as any);

      expect(response.status).toBe(200);
      expect(opcodeClient.rejectQuestion).toHaveBeenCalledWith(
        "instance-1",
        "que_abc123"
      );
      expect(opcodeClient.respondToQuestion).not.toHaveBeenCalled();
    });

    it("returns 200 with alreadyAnswered=true if rejectQuestion returns 404", async () => {
      const session = mockSession();
      vi.mocked(dbRepository.getSessionByOpencodeId).mockReturnValue(session as any);
      vi.mocked(opcodeClient.rejectQuestion).mockResolvedValue({
        ok: false,
        status: 404,
        alreadyAnswered: true,
        body: JSON.stringify({
          _tag: "QuestionNotFoundError",
          message: "Question not found",
        }),
      });

      const req = mockRequest({ answers: [["skipped"]] }) as NextRequest;
      const ctx = mockRouteContext("ses_123", "que_abc123");

      const response = await POST(req, ctx as any);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.ok).toBe(false);
      expect(data.alreadyAnswered).toBe(true);
      expect(data.status).toBe(404);
    });
  });

  describe("Mixed answers (some answered, some skipped)", () => {
    it("filters out ['skipped'] and sends answered values to respondToQuestion", async () => {
      const session = mockSession();
      vi.mocked(dbRepository.getSessionByOpencodeId).mockReturnValue(session as any);
      vi.mocked(opcodeClient.respondToQuestion).mockResolvedValue({
        ok: true,
        status: 200,
        alreadyAnswered: false,
        body: null,
      });

      const req = mockRequest({
        answers: [["Answer 1"], ["skipped"], ["Answer 2"]],
      }) as NextRequest;
      const ctx = mockRouteContext("ses_123", "que_abc123");

      const response = await POST(req, ctx as any);

      expect(response.status).toBe(200);
      expect(opcodeClient.respondToQuestion).toHaveBeenCalledWith(
        "instance-1",
        "que_abc123",
        [["Answer 1"], ["Answer 2"]]
      );
    });

    it("returns 200 with ok=true on successful respondToQuestion", async () => {
      const session = mockSession();
      vi.mocked(dbRepository.getSessionByOpencodeId).mockReturnValue(session as any);
      vi.mocked(opcodeClient.respondToQuestion).mockResolvedValue({
        ok: true,
        status: 200,
        alreadyAnswered: false,
        body: null,
      });

      const req = mockRequest({ answers: [["My answer"]] }) as NextRequest;
      const ctx = mockRouteContext("ses_123", "que_abc123");

      const response = await POST(req, ctx as any);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.ok).toBe(true);
    });
  });

  describe("OpenCode errors", () => {
    it("returns 200 with alreadyAnswered=true if respondToQuestion returns 404", async () => {
      const session = mockSession();
      vi.mocked(dbRepository.getSessionByOpencodeId).mockReturnValue(session as any);
      vi.mocked(opcodeClient.respondToQuestion).mockResolvedValue({
        ok: false,
        status: 404,
        alreadyAnswered: true,
        body: JSON.stringify({
          _tag: "QuestionNotFoundError",
          requestID: "que_abc123",
          message: "Question request not found: que_abc123",
        }),
      });

      const req = mockRequest({ answers: [["Answer"]] }) as NextRequest;
      const ctx = mockRouteContext("ses_123", "que_abc123");

      const response = await POST(req, ctx as any);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.ok).toBe(false);
      expect(data.alreadyAnswered).toBe(true);
      expect(data.status).toBe(404);
    });

    it("returns 409 status when question already answered (409 Conflict)", async () => {
      const session = mockSession();
      vi.mocked(dbRepository.getSessionByOpencodeId).mockReturnValue(session as any);
      vi.mocked(opcodeClient.respondToQuestion).mockResolvedValue({
        ok: false,
        status: 409,
        alreadyAnswered: true,
        body: JSON.stringify({ message: "Question already answered" }),
      });

      const req = mockRequest({ answers: [["Answer"]] }) as NextRequest;
      const ctx = mockRouteContext("ses_123", "que_abc123");

      const response = await POST(req, ctx as any);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.status).toBe(409);
      expect(data.alreadyAnswered).toBe(true);
    });

    it("returns 500 for other OpenCode errors", async () => {
      const session = mockSession();
      vi.mocked(dbRepository.getSessionByOpencodeId).mockReturnValue(session as any);
      vi.mocked(opcodeClient.respondToQuestion).mockResolvedValue({
        ok: false,
        status: 500,
        alreadyAnswered: false,
        body: JSON.stringify({ message: "Internal Server Error" }),
      });

      const req = mockRequest({ answers: [["Answer"]] }) as NextRequest;
      const ctx = mockRouteContext("ses_123", "que_abc123");

      const response = await POST(req, ctx as any);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it("returns 502 Bad Gateway for network errors (status 0)", async () => {
      const session = mockSession();
      vi.mocked(dbRepository.getSessionByOpencodeId).mockReturnValue(session as any);
      vi.mocked(opcodeClient.respondToQuestion).mockResolvedValue({
        ok: false,
        status: 0,
        alreadyAnswered: false,
        body: null,
      });

      const req = mockRequest({ answers: [["Answer"]] }) as NextRequest;
      const ctx = mockRouteContext("ses_123", "que_abc123");

      const response = await POST(req, ctx as any);

      expect(response.status).toBe(502);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });
  });

  describe("Complete answer scenarios", () => {
    it("handles multiple-choice answers correctly", async () => {
      const session = mockSession();
      vi.mocked(dbRepository.getSessionByOpencodeId).mockReturnValue(session as any);
      vi.mocked(opcodeClient.respondToQuestion).mockResolvedValue({
        ok: true,
        status: 200,
        alreadyAnswered: false,
        body: null,
      });

      const req = mockRequest({
        answers: [["Option A", "Option B"], ["Custom Answer"]],
      }) as NextRequest;
      const ctx = mockRouteContext("ses_123", "que_abc123");

      const response = await POST(req, ctx as any);

      expect(response.status).toBe(200);
      expect(opcodeClient.respondToQuestion).toHaveBeenCalledWith(
        "instance-1",
        "que_abc123",
        [["Option A", "Option B"], ["Custom Answer"]]
      );
    });

    it("handles empty string answers", async () => {
      const session = mockSession();
      vi.mocked(dbRepository.getSessionByOpencodeId).mockReturnValue(session as any);
      vi.mocked(opcodeClient.respondToQuestion).mockResolvedValue({
        ok: true,
        status: 200,
        alreadyAnswered: false,
        body: null,
      });

      const req = mockRequest({ answers: [[""]] }) as NextRequest;
      const ctx = mockRouteContext("ses_123", "que_abc123");

      const response = await POST(req, ctx as any);

      expect(response.status).toBe(200);
      expect(opcodeClient.respondToQuestion).toHaveBeenCalledWith(
        "instance-1",
        "que_abc123",
        [[""]]
      );
    });
  });
});
