import { NextRequest, NextResponse } from "next/server";
import {
  getGoogleChatToken,
  googleChatFetch,
} from "../../../_lib/google-chat-fetch";
import type { GoogleChatMember } from "@/integrations/google-chat/types";

const VALID_ID = /^[a-zA-Z0-9_-]+$/;

interface ListMembersResponse {
  memberships?: GoogleChatMember[];
  nextPageToken?: string;
}

/** GET /api/integrations/google-chat/spaces/[spaceId]/members — list space members */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> }
): Promise<NextResponse> {
  const { spaceId } = await params;

  if (!VALID_ID.test(spaceId)) {
    return NextResponse.json({ error: "Invalid spaceId" }, { status: 400 });
  }

  const token = await getGoogleChatToken();
  if (!token) {
    return NextResponse.json(
      { error: "Google Chat not connected" },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(request.url);

  const result = await googleChatFetch<ListMembersResponse>(
    `/spaces/${spaceId}/members`,
    token,
    {
      params: {
        pageSize: searchParams.get("pageSize") ?? undefined,
        pageToken: searchParams.get("pageToken") ?? undefined,
      },
    }
  );

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.data, { status: 200 });
}
