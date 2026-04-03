import { NextRequest, NextResponse } from "next/server";
import {
  getGoogleChatToken,
  googleChatFetch,
} from "../_lib/google-chat-fetch";
import type { GoogleChatSpace } from "@/integrations/google-chat/types";

interface ListSpacesResponse {
  spaces?: GoogleChatSpace[];
  nextPageToken?: string;
}

/** GET /api/integrations/google-chat/spaces — list the user's spaces */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = await getGoogleChatToken();
  if (!token) {
    return NextResponse.json(
      { error: "Google Chat not connected" },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(request.url);

  const result = await googleChatFetch<ListSpacesResponse>("/spaces", token, {
    params: {
      pageSize: searchParams.get("pageSize") ?? undefined,
      pageToken: searchParams.get("pageToken") ?? undefined,
      filter: searchParams.get("filter") ?? undefined,
    },
  });

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.data, { status: 200 });
}
