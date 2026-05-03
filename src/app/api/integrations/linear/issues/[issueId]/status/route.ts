import { NextRequest, NextResponse } from "next/server";
import { getIntegrationConfig } from "@/lib/server/integration-store";
import type { LinearIssueStatusResponse } from "@/integrations/linear/types";

export type { LinearIssueStatusResponse };

interface RouteContext {
  params: Promise<{ issueId: string }>;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function getLinearToken(): string | null {
  const config = getIntegrationConfig("linear");
  if (!config?.token || typeof config.token !== "string") return null;
  return config.token;
}

// ─── Route ────────────────────────────────────────────────────────────────────

/**
 * GET /api/integrations/linear/issues/[issueId]/status
 *
 * Fetches issue status from the Linear GraphQL API.
 * `issueId` is the human-readable issue identifier (e.g. "TEAM-123").
 * Linear's `issueByIdentifier` query accepts identifiers directly.
 */
export async function GET(
  _req: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const token = getLinearToken();
  if (!token) {
    return NextResponse.json(
      { error: "Linear integration not configured" },
      { status: 401 }
    );
  }

  const { issueId } = await context.params;
  // issueId is the human-readable identifier (e.g. "TEAM-123")
  const identifier = decodeURIComponent(issueId);

  const query = `
    query GetIssueByIdentifier($identifier: String!) {
      issueByIdentifier(identifier: $identifier) {
        id
        identifier
        title
        url
        state {
          name
          type
          color
        }
      }
    }
  `;

  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables: { identifier } }),
  });

  const rateLimitRemaining = response.headers.get(
    "X-RateLimit-Requests-Remaining"
  );
  const rateLimitReset = response.headers.get("X-RateLimit-Requests-Reset");

  if (!response.ok) {
    return NextResponse.json(
      { error: `Linear API error: ${response.status}` },
      { status: response.status }
    );
  }

  interface LinearGraphQLResponse {
    data?: {
      issueByIdentifier?: {
        id: string;
        identifier: string;
        title: string;
        url: string;
        state: {
          name: string;
          type: string;
          color: string;
        };
      };
    };
    errors?: Array<{ message: string }>;
  }

  const json = (await response.json()) as LinearGraphQLResponse;

  if (json.errors?.length) {
    return NextResponse.json(
      { error: json.errors[0].message },
      { status: 400 }
    );
  }

  const issue = json.data?.issueByIdentifier;
  if (!issue) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  const result: LinearIssueStatusResponse = {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    url: issue.url,
    state: {
      name: issue.state.name,
      type: issue.state.type as LinearIssueStatusResponse["state"]["type"],
      color: issue.state.color,
    },
    ...(rateLimitRemaining !== null && {
      rateLimitRemaining: parseInt(rateLimitRemaining, 10),
    }),
    ...(rateLimitReset !== null && {
      rateLimitReset: parseInt(rateLimitReset, 10),
    }),
  };

  return NextResponse.json(result);
}
