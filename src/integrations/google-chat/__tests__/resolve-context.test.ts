import { describe, it, expect, vi, beforeEach } from "vitest";

// We test the parseGoogleChatUrl logic indirectly via resolveContext,
// and directly test resolveContext behaviour with mocked fetch.

// We need to import the manifest after setting up mocks
vi.stubGlobal("fetch", vi.fn());

describe("resolveContext", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  async function getResolveContext() {
    // Re-import to pick up fresh module state
    const mod = await import("../manifest");
    return mod.googleChatManifest.resolveContext!;
  }

  describe("Non-matching URLs", () => {
    it("ReturnsNullForNonGoogleChatUrl", async () => {
      const resolveContext = await getResolveContext();
      const result = await resolveContext("https://github.com/foo/bar");
      expect(result).toBeNull();
    });

    it("ReturnsNullForEmptyString", async () => {
      const resolveContext = await getResolveContext();
      const result = await resolveContext("");
      expect(result).toBeNull();
    });

    it("ReturnsNullForInvalidUrl", async () => {
      const resolveContext = await getResolveContext();
      const result = await resolveContext("not-a-url");
      expect(result).toBeNull();
    });

    it("ReturnsNullForGoogleChatUrlWithInvalidSpaceId", async () => {
      const resolveContext = await getResolveContext();
      const result = await resolveContext(
        "https://chat.google.com/room/../etc/passwd"
      );
      expect(result).toBeNull();
    });
  });

  describe("Space URL resolution", () => {
    it("ResolvesChatsGoogleComRoomUrl", async () => {
      const fetchMock = vi.mocked(fetch);
      const space = {
        name: "spaces/AAAA",
        displayName: "Engineering",
        spaceType: "SPACE",
        spaceDetails: { description: "Eng discussion" },
      };
      const messages = {
        messages: [
          {
            sender: { displayName: "Alice" },
            text: "Hello!",
            createTime: "2024-01-01T10:00:00Z",
          },
        ],
      };

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => space,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => messages,
        } as Response);

      const resolveContext = await getResolveContext();
      const result = await resolveContext("https://chat.google.com/room/AAAA");

      expect(result).not.toBeNull();
      expect(result!.type).toBe("google-chat-space");
      expect(result!.title).toBe("Engineering");
      expect(result!.body).toContain("Eng discussion");
      expect(result!.body).toContain("Alice: Hello!");
      expect(result!.metadata.spaceName).toBe("spaces/AAAA");
      expect(result!.metadata.spaceType).toBe("SPACE");
    });

    it("ResolvesMailGoogleComChatSpaceUrl", async () => {
      const fetchMock = vi.mocked(fetch);
      const space = {
        name: "spaces/BBBB",
        displayName: "Sales",
        spaceType: "SPACE",
      };

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => space,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: [] }),
        } as Response);

      const resolveContext = await getResolveContext();
      const result = await resolveContext(
        "https://mail.google.com/mail/u/0/#chat/space/BBBB"
      );

      expect(result).not.toBeNull();
      expect(result!.type).toBe("google-chat-space");
      expect(result!.title).toBe("Sales");
    });

    it("ReturnsNullWhenSpaceApiFails", async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: "Unauthorized" }),
      } as Response);

      const resolveContext = await getResolveContext();
      const result = await resolveContext("https://chat.google.com/room/AAAA");

      expect(result).toBeNull();
    });

    it("ReturnsNullWhenFetchThrows", async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockRejectedValueOnce(new Error("Network error"));

      const resolveContext = await getResolveContext();
      const result = await resolveContext("https://chat.google.com/room/AAAA");

      expect(result).toBeNull();
    });

    it("HandlesSpaceWithoutDescription", async () => {
      const fetchMock = vi.mocked(fetch);
      const space = {
        name: "spaces/CCCC",
        displayName: "Team DM",
        spaceType: "DIRECT_MESSAGE",
      };

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => space,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: [] }),
        } as Response);

      const resolveContext = await getResolveContext();
      const result = await resolveContext("https://chat.google.com/room/CCCC");

      expect(result).not.toBeNull();
      expect(result!.body).toBe("");
    });

    it("HandlesSpaceWithQueryParams", async () => {
      const fetchMock = vi.mocked(fetch);
      const space = {
        name: "spaces/DDDD",
        displayName: "Marketing",
        spaceType: "SPACE",
      };

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => space,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: [] }),
        } as Response);

      const resolveContext = await getResolveContext();
      const result = await resolveContext(
        "https://chat.google.com/room/DDDD?utm_source=notification"
      );

      expect(result).not.toBeNull();
      expect(result!.type).toBe("google-chat-space");
    });
  });

  describe("Message URL resolution", () => {
    it("ResolvesMessagePermalinkUrl", async () => {
      const fetchMock = vi.mocked(fetch);
      const message = {
        name: "spaces/AAAA/messages/MSGID",
        text: "This is important",
        sender: { displayName: "Bob", name: "users/123" },
        createTime: "2024-01-02T09:00:00Z",
        thread: { name: "spaces/AAAA/threads/THR1" },
        replyCount: 3,
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => message,
      } as Response);

      const resolveContext = await getResolveContext();
      const result = await resolveContext(
        "https://chat.google.com/room/AAAA/MSGID"
      );

      expect(result).not.toBeNull();
      expect(result!.type).toBe("google-chat-message");
      expect(result!.title).toBe("Message from Bob");
      expect(result!.body).toBe("This is important");
      expect(result!.metadata.sender).toBe("Bob");
      expect(result!.metadata.replyCount).toBe(3);
      expect(result!.metadata.messageName).toBe("spaces/AAAA/messages/MSGID");
    });

    it("ReturnsNullWhenMessageApiFails", async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as Response);

      const resolveContext = await getResolveContext();
      const result = await resolveContext(
        "https://chat.google.com/room/AAAA/MSGID"
      );

      expect(result).toBeNull();
    });
  });
});
