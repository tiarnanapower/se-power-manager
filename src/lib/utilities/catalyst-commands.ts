// The terminal commands the Deploy Catalyst Storefront page hands out. Kept in one place so a change
// to the Catalyst CLI is a one-line edit, and free of UI code so it can be tested.
export type Edition = "b2b" | "b2c";

export const EDITIONS: { id: Edition; label: string; ghRef: string; blurb: string }[] = [
  { id: "b2b", label: "B2B", ghRef: "@bigcommerce/catalyst-b2b-makeswift@latest", blurb: "Catalyst with Makeswift and the B2B Edition storefront features." },
  { id: "b2c", label: "B2C", ghRef: "@bigcommerce/catalyst-makeswift@latest", blurb: "Catalyst with Makeswift for a standard business-to-consumer storefront." },
];

export interface CollaborativeInput {
  repo: string;
  branch: string;
  projectName: string;
}

export type BuildResult = { ok: true; command: string } | { ok: false; errors: string[]; preview: string };

// "owner/repo", a github.com web address, or an SSH address, as owner and repo.
export function parseRepo(input: string): { owner: string; repo: string } | undefined {
  const match = input.trim().match(/^(?:https:\/\/github\.com\/|git@github\.com:)?([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/);

  return match && match[2] !== "." && match[2] !== ".." ? { owner: match[1], repo: match[2] } : undefined;
}

// Letters, numbers and . _ - /, which is enough for real branch names and safe to paste into a shell.
export function isBranchName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(value) && !value.includes("..") && !value.includes("//") && !/[./]$/.test(value) && !value.endsWith(".lock");
}

export const isProjectName = (value: string): boolean => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);

export function baseCommand(edition: Edition, projectName?: string): string {
  const { ghRef } = EDITIONS.find((entry) => entry.id === edition)!;

  return `corepack enable pnpm && pnpm create @bigcommerce/catalyst@latest --gh-ref ${ghRef} --hosting bigcommerce${projectName ? ` --project-name ${projectName}` : ""}`;
}

// Without `collaborative` it is the plain command. With it, the project name is fixed so the next steps
// know which folder to go into, then the new project (which the CLI has already made a git repo of)
// is pointed at the shared repo and pushed on its own branch.
export function buildCommand(edition: Edition, collaborative?: CollaborativeInput): BuildResult {
  if (!collaborative) return { ok: true, command: baseCommand(edition) };

  const errors: string[] = [];
  const repo = parseRepo(collaborative.repo);
  const branch = collaborative.branch.trim();
  const name = collaborative.projectName.trim();

  if (!repo) errors.push("Enter the destination GitHub repo as owner/name, or paste its address.");
  if (!isBranchName(branch)) errors.push("Enter a branch name using letters, numbers, dots, dashes and slashes.");
  if (!isProjectName(name)) errors.push("Give the project folder a lower-case name using letters, numbers, dashes and underscores.");

  const lines = (url: string, branchName: string, folder: string) => [
    `${baseCommand(edition, folder)} &&`,
    `cd ${folder} &&`,
    `git remote add origin ${url} &&`,
    `git checkout -b ${branchName} &&`,
    `git push -u origin ${branchName}`,
  ].join("\n");

  if (errors.length > 0 || !repo) {
    return { ok: false, errors, preview: lines("https://github.com/OWNER/REPO.git", isBranchName(branch) ? branch : "BRANCH", isProjectName(name) ? name : "PROJECT-NAME") };
  }

  return { ok: true, command: lines(`https://github.com/${repo.owner}/${repo.repo}.git`, branch, name) };
}

// How each collaborative field stands, so the page can say "needed" for an empty one and only call a
// value an error once something has been typed that can't be used.
export type FieldState = { state: "ok" } | { state: "empty" } | { state: "invalid"; message: string };

export function checkCollaborative(input: CollaborativeInput): Record<keyof CollaborativeInput, FieldState> {
  const check = (value: string, valid: boolean, message: string): FieldState => (value.trim() === "" ? { state: "empty" } : valid ? { state: "ok" } : { state: "invalid", message });

  return {
    repo: check(input.repo, parseRepo(input.repo) !== undefined, "That isn't a GitHub repo. Use owner/name, or paste the repo's address."),
    branch: check(input.branch, isBranchName(input.branch.trim()), "Branch names can use letters, numbers, dots, dashes and slashes, with no spaces."),
    projectName: check(input.projectName, isProjectName(input.projectName.trim()), "Use lower-case letters, numbers, dashes and underscores, with no spaces."),
  };
}

// A folder name taken from the repo's name, so the person doesn't have to invent one.
export function suggestProjectName(repoInput: string): string {
  const name = (parseRepo(repoInput)?.repo ?? "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[-_]+|[-_]+$/g, "");

  return isProjectName(name) ? name : "";
}
