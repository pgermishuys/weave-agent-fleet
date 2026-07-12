import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./reply/route";
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

// ─── Test Helpers ──────────────────────────────────────────────────────────

function mockSession(overrides: Record<string, any> = {}) {
  return {
    id: "db-session-1",
    opencodeId: "ses_123abc",
    instance_id: "instance-1",
    directory: "/test/dir",
    status: "idle",
    ...overrides,
  };
}

function mockRequest(body: Record<string, any>): Partial<NextRequest> {
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

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/sessions/[id]/questions/[questionId]/reply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Valid answer submission", () => {
    it("successfully submits a single answer", async () => {
      const session = mockSession();
      vi.mocked(dbRepository.getSessionByOpencodeId).mockReturnValue(session as any);
      vi.mocked(opcodeClient.respondToQuestion).mockResolvedValue({
        ok: true,
        status: 200,
        alreadyAnswered: false,
        body: null,
      });

      const req = mockRequest({ answers: [["My Answer"]] }) as NextRequest;
      const ctx = mockRouteContext("ses_123", "que_abc123");

      const response = await POST(req, ctx as any);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(opcodeClient.respondToQuestion).toHaveBeenCalledWith(
        "instance-1",
        "que_abc123",
        [["My Answer"]]
      );
    });
  });

  describe("OpenCode 404 error (question not found)", () => {
    it("returns 200 with alreadyAnswered=true when OpenCode returns 404", async () => {
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
  });

  describe("Answer filtering", () => {
    it("filters out ['skipped'] values", async () => {
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

      expect(opcodeClient.respondToQuestion).toHaveBeenCalledWith(
        "instance-1",
        "que_abc123",
        [["Answer 1"], ["Answer 2"]]
      );
    });
  });

  describe("All answers skipped", () => {
    it("calls rejectQuestion instead of respondToQuestion", async () => {
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

      expect(opcodeClient.rejectQuestion).toHaveBeenCalledWith(
        "instance-1",
        "que_abc123"
      );
      expect(opcodeClient.respondToQuestion).not.toHaveBeenCalled();
      expect(response.status).toBe(200);
    });
  });

  describe("Request validation", () => {
    it("rejects invalid question ID", async () => {
      const req = mockRequest({ answers: [["answer"]] }) as NextRequest;
      const ctx = mockRouteContext("ses_123", "que../../etc/passwd");

      const response = await POST(req, ctx as any);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("Invalid question ID");
    });

    it("returns 404 if session not found", async () => {
      vi.mocked(dbRepository.getSessionByOpencodeId).mockReturnValue(null);

      const req = mockRequest({ answers: [["answer"]] }) as NextRequest;
      const ctx = mockRouteContext("ses_notfound", "que_abc123");

      const response = await POST(req, ctx as any);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toContain("Session not found");
    });
  });
});
