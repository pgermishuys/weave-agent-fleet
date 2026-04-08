import { vi } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/server/process-manager", () => ({
  _recoveryComplete: Promise.resolve(),
}));

vi.mock("@/lib/server/opencode-client", () => ({
  ensureInstanceForSession: vi.fn(),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { POST } from "@/app/api/sessions/[id]/command/route";
import * as openCodeClient from "@/lib/server/opencode-client";

const mockEnsureInstanceForSession = vi.mocked(openCodeClient.ensureInstanceForSession);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeContext(id = "sess-1") {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/sessions/sess-1/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeInvalidJsonRequest() {
  return new NextRequest("http://localhost/api/sessions/sess-1/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "not-json{{{",
  });
}

function makeMockClient() {
  return {
    session: {
      command: vi.fn().mockResolvedValue(undefined),
    },
  };
}

function makeInstanceResult(client: ReturnType<typeof makeMockClient>) {
  return {
    instance: { id: "inst-1", status: "running", directory: "/tmp/proj" },
    client,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/sessions/[id]/command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for invalid JSON body", async () => {
    const req = makeInvalidJsonRequest();
    const res = await POST(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/invalid json/i);
  });

  it("returns 400 when instanceId is missing", async () => {
    const req = makeRequest({ command: "compact" });
    const res = await POST(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/instanceId/i);
  });

  it("returns 400 when instanceId is not a string", async () => {
    const req = makeRequest({ instanceId: 123, command: "compact" });
    const res = await POST(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/instanceId/i);
  });

  it("returns 400 when command is missing", async () => {
    const req = makeRequest({ instanceId: "inst-1" });
    const res = await POST(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/command/i);
  });

  it("returns 400 when command is empty string", async () => {
    const req = makeRequest({ instanceId: "inst-1", command: "" });
    const res = await POST(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/command/i);
  });

  it("returns 400 when command is whitespace only", async () => {
    const req = makeRequest({ instanceId: "inst-1", command: "   " });
    const res = await POST(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/command/i);
  });

  it("returns 404 when instance not found", async () => {
    mockEnsureInstanceForSession.mockRejectedValue(new Error("Instance not found"));

    const req = makeRequest({ instanceId: "bad-inst", command: "compact" });
    const res = await POST(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toMatch(/instance not found/i);
  });

  it("returns 200 with success response on valid command", async () => {
    const client = makeMockClient();
    mockEnsureInstanceForSession.mockResolvedValue(makeInstanceResult(client) as never);

    const req = makeRequest({ instanceId: "inst-1", command: "compact" });
    const res = await POST(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.sessionId).toBe("sess-1");
  });

  it("calls session.command() with command name and empty arguments when no args provided", async () => {
    const client = makeMockClient();
    mockEnsureInstanceForSession.mockResolvedValue(makeInstanceResult(client) as never);

    const req = makeRequest({ instanceId: "inst-1", command: "compact" });
    await POST(req, makeContext());

    expect(client.session.command).toHaveBeenCalledWith({
      sessionID: "sess-1",
      command: "compact",
      arguments: "",
    });
  });

  it("calls session.command() with command name and arguments", async () => {
    const client = makeMockClient();
    mockEnsureInstanceForSession.mockResolvedValue(makeInstanceResult(client) as never);

    const req = makeRequest({
      instanceId: "inst-1",
      command: "plan",
      args: "build a widget",
    });
    await POST(req, makeContext());

    expect(client.session.command).toHaveBeenCalledWith({
      sessionID: "sess-1",
      command: "plan",
      arguments: "build a widget",
    });
  });

  it("trims command whitespace", async () => {
    const client = makeMockClient();
    mockEnsureInstanceForSession.mockResolvedValue(makeInstanceResult(client) as never);

    const req = makeRequest({ instanceId: "inst-1", command: "  compact  " });
    await POST(req, makeContext());

    expect(client.session.command).toHaveBeenCalledWith({
      sessionID: "sess-1",
      command: "compact",
      arguments: "",
    });
  });

  it("passes agent through to session.command()", async () => {
    const client = makeMockClient();
    mockEnsureInstanceForSession.mockResolvedValue(makeInstanceResult(client) as never);

    const req = makeRequest({
      instanceId: "inst-1",
      command: "compact",
      agent: "code",
    });
    await POST(req, makeContext());

    expect(client.session.command).toHaveBeenCalledWith({
      sessionID: "sess-1",
      command: "compact",
      arguments: "",
      agent: "code",
    });
  });

  it("passes model as providerID/modelID string to session.command()", async () => {
    const client = makeMockClient();
    mockEnsureInstanceForSession.mockResolvedValue(makeInstanceResult(client) as never);

    const req = makeRequest({
      instanceId: "inst-1",
      command: "compact",
      model: { providerID: "anthropic", modelID: "claude-sonnet-4-5" },
    });
    await POST(req, makeContext());

    expect(client.session.command).toHaveBeenCalledWith({
      sessionID: "sess-1",
      command: "compact",
      arguments: "",
      model: "anthropic/claude-sonnet-4-5",
    });
  });

  it("passes both agent and model together", async () => {
    const client = makeMockClient();
    mockEnsureInstanceForSession.mockResolvedValue(makeInstanceResult(client) as never);

    const req = makeRequest({
      instanceId: "inst-1",
      command: "plan",
      args: "build widget",
      agent: "code",
      model: { providerID: "openai", modelID: "gpt-4o" },
    });
    await POST(req, makeContext());

    expect(client.session.command).toHaveBeenCalledWith({
      sessionID: "sess-1",
      command: "plan",
      arguments: "build widget",
      agent: "code",
      model: "openai/gpt-4o",
    });
  });

  it("returns 200 even when session.command() rejects (fire-and-forget)", async () => {
    const client = {
      session: {
        command: vi.fn().mockRejectedValue(new Error("SDK error")),
      },
    };
    mockEnsureInstanceForSession.mockResolvedValue(makeInstanceResult(client) as never);

    const req = makeRequest({ instanceId: "inst-1", command: "compact" });
    const res = await POST(req, makeContext());
    const body = await res.json();

    // Fire-and-forget: the route returns 200 immediately;
    // the rejection is caught by .catch() and logged, not surfaced.
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("uses session ID from route params, not request body", async () => {
    const client = makeMockClient();
    mockEnsureInstanceForSession.mockResolvedValue(makeInstanceResult(client) as never);

    const req = makeRequest({ instanceId: "inst-1", command: "compact" });
    await POST(req, makeContext("custom-session-id"));

    expect(client.session.command).toHaveBeenCalledWith(
      expect.objectContaining({ sessionID: "custom-session-id" }),
    );
  });
});
