// The custom B2B channel is a Catalyst app that lives in a GitHub repo.
import "server-only";
import { getBigGearConfigOrThrow } from "@/lib/big-gear/config";
import { AppError } from "@/lib/errors/app-error";

export interface CatalystRepoInfo {
  fullName: string;
  defaultBranch: string;
  isPrivate: boolean;
  pushedAt: string | null;
  htmlUrl: string;
}

interface GithubRepoResponse {
  full_name: string;
  default_branch: string;
  private: boolean;
  pushed_at: string | null;
  html_url: string;
}

// Read-only. A private repo needs GITHUB_TOKEN with read access to contents.
export async function getCatalystRepoInfo(): Promise<CatalystRepoInfo> {
  const { b2bRepo, githubToken } = getBigGearConfigOrThrow();

  if (!b2bRepo || !/^[\w.-]+\/[\w.-]+$/.test(b2bRepo)) {
    throw new AppError("VALIDATION", "Set BIG_GEAR_B2B_REPO to the Catalyst repo as owner/repo.");
  }

  const response = await fetch(`https://api.github.com/repos/${b2bRepo}`, {
    headers: { Accept: "application/vnd.github+json", ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}) },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new AppError("UPSTREAM_API", `GitHub returned ${response.status} for ${b2bRepo}. Check the repo name and GITHUB_TOKEN.`, { status: response.status });
  }

  const repo = (await response.json()) as GithubRepoResponse;

  return { fullName: repo.full_name, defaultBranch: repo.default_branch, isPrivate: repo.private, pushedAt: repo.pushed_at, htmlUrl: repo.html_url };
}
