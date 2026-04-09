import { NextRequest, NextResponse } from "next/server";
import {
  getGitHubToken,
  githubFetch,
} from "../../../../../../_lib/github-fetch";
import type {
  GitHubIssue,
  IssueStatusResponse,
} from "@/integrations/github/types";

// GET /api/integrations/github/repos/[owner]/[repo]/issues/[number]/status
export async function GET(
  _request: NextRequest,
  {
    params,
  }: { params: Promise<{ owner: string; repo: string; number: string }> }
): Promise<NextResponse> {
  const token = getGitHubToken();
  if (!token) {
    return NextResponse.json(
      { error: "GitHub not connected" },
      { status: 401 }
    );
  }

  const { owner, repo, number } = await params;

  const issueResult = await githubFetch<GitHubIssue>(
    `/repos/${owner}/${repo}/issues/${number}`,
    token
  );

  if (issueResult.error) {
    return NextResponse.json(
      { error: issueResult.error },
      { status: issueResult.status }
    );
  }

  const issue = issueResult.data!;

  const response: IssueStatusResponse = {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    labels: issue.labels.map((l) => ({ name: l.name, color: l.color })),
    url: issue.html_url,
    rateLimitRemaining: issueResult.rateLimitRemaining,
    rateLimitReset: issueResult.rateLimitReset,
  };

  return NextResponse.json(response, { status: 200 });
}
