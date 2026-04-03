import { NextRequest, NextResponse } from "next/server";
import {
  getGoogleChatToken,
  googleChatFetch,
} from "../../../../_lib/google-chat-fetch";
import type { GoogleChatMessage } from "@/integrations/google-chat/types";

const VALID_ID = /^[a-zA-Z0-9_-]+$/;

/** GET /api/integrations/google-chat/spaces/[spaceId]/messages/[messageId] — get a single message */
export async function GET(
  _request: NextRequest,
  {
    params,
  }: { params: Promise<{ spaceId: string; messageId: string }> }
): Promise<NextResponse> {
  const { spaceId, messageId } = await params;

  if (!VALID_ID.test(spaceId)) {
    return NextResponse.json({ error: "Invalid spaceId" }, { status: 400 });
  }
  if (!VALID_ID.test(messageId)) {
    return NextResponse.json({ error: "Invalid messageId" }, { status: 400 });
  }

  const token = await getGoogleChatToken();
  if (!token) {
    return NextResponse.json(
      { error: "Google Chat not connected" },
      { status: 401 }
    );
  }

  const result = await googleChatFetch<GoogleChatMessage>(
    `/spaces/${spaceId}/messages/${messageId}`,
    token
  );

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.data, { status: 200 });
}
