import { NextRequest, NextResponse } from "next/server";
import { getGitHubToken, githubFetch } from "../../../../../../_lib/github-fetch";
import type {
  GitHubPullRequest,
  GitHubCheckSuitesResponse,
  GitHubCheckSuite,
  PrStatusResponse,
} from "@/integrations/github/types";

// GET /api/integrations/github/repos/[owner]/[repo]/pulls/[number]/status
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

  // Fetch PR details first — we need head.sha for check suites
  const prResult = await githubFetch<GitHubPullRequest>(
    `/repos/${owner}/${repo}/pulls/${number}`,
    token
  );

  if (prResult.error) {
    return NextResponse.json(
      { error: prResult.error },
      { status: prResult.status }
    );
  }

  const pr = prResult.data!;

  // Fetch check suites for the head commit
  const checksResult = await githubFetch<GitHubCheckSuitesResponse>(
    `/repos/${owner}/${repo}/commits/${pr.head.sha}/check-suites`,
    token
  );

  // Gracefully degrade if checks can't be fetched (e.g. missing checks:read scope)
  const suites: GitHubCheckSuite[] =
    checksResult.error ? [] : (checksResult.data?.check_suites ?? []);
  const totalCount = checksResult.error ? 0 : (checksResult.data?.total_count ?? 0);

  const checksStatus = deriveChecksStatus(suites, totalCount);

  const response: PrStatusResponse = {
    number: pr.number,
    title: pr.title,
    // GitHub REST API only returns "open" | "closed" — derive merged from merged_at
    state: pr.state === "merged" ? "closed" : (pr.state as "open" | "closed"),
    merged: pr.merged_at !== null,
    draft: pr.draft,
    checksStatus,
    headRef: pr.head.ref,
    url: pr.html_url,
  };

  return NextResponse.json(response, { status: 200 });
}

function deriveChecksStatus(
  suites: GitHubCheckSuite[],
  totalCount: number
): PrStatusResponse["checksStatus"] {
  if (totalCount === 0 || suites.length === 0) return "none";

  // Any suite still running → "running"
  const hasRunning = suites.some(
    (s) => s.status === "queued" || s.status === "in_progress"
  );
  if (hasRunning) return "running";

  // All completed — check conclusions
  const allPassing = suites.every(
    (s) =>
      s.conclusion === "success" ||
      s.conclusion === "neutral" ||
      s.conclusion === "skipped"
  );
  return allPassing ? "success" : "failure";
}
