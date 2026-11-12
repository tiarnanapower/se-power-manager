import { describe, expect, it } from "vitest";
import { buildCommand, isBranchName, parseRepo } from "@/lib/utilities/catalyst-commands";

describe("buildCommand", () => {
  it("gives the plain B2B command, with hosting", () => {
    expect(buildCommand("b2b")).toEqual({ ok: true, command: "corepack enable pnpm && pnpm create @bigcommerce/catalyst@latest --gh-ref @bigcommerce/catalyst-b2b-makeswift@latest --hosting bigcommerce" });
  });

  it("gives the plain B2C command, with hosting too", () => {
    expect(buildCommand("b2c")).toEqual({ ok: true, command: "corepack enable pnpm && pnpm create @bigcommerce/catalyst@latest --gh-ref @bigcommerce/catalyst-makeswift@latest --hosting bigcommerce" });
  });

  it("adds the project folder and the git steps for the collaborative repo", () => {
    const result = buildCommand("b2c", { repo: "https://github.com/acme/demo-store.git", branch: "feature/new-header", projectName: "acme-demo" });

    expect(result).toEqual({
      ok: true,
      command: [
        "corepack enable pnpm && pnpm create @bigcommerce/catalyst@latest --gh-ref @bigcommerce/catalyst-makeswift@latest --hosting bigcommerce --project-name acme-demo &&",
        "cd acme-demo &&",
        "git remote add origin https://github.com/acme/demo-store.git &&",
        "git checkout -b feature/new-header &&",
        "git push -u origin feature/new-header",
      ].join("\n"),
    });
  });

  it("explains what is missing and shows a placeholder preview", () => {
    const result = buildCommand("b2b", { repo: "", branch: "", projectName: "" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(3);
      expect(result.preview).toContain("https://github.com/OWNER/REPO.git");
    }
  });

  it("refuses anything that could add shell commands", () => {
    expect(buildCommand("b2c", { repo: "acme/demo", branch: "x; rm -rf ~", projectName: "ok" }).ok).toBe(false);
    expect(buildCommand("b2c", { repo: "acme/demo", branch: "main", projectName: "a b" }).ok).toBe(false);
    expect(buildCommand("b2c", { repo: "acme/demo$(id)", branch: "main", projectName: "ok" }).ok).toBe(false);
  });
});

describe("parseRepo", () => {
  it("accepts owner/name, web and SSH addresses", () => {
    for (const input of ["acme/demo", "https://github.com/acme/demo", "https://github.com/acme/demo.git", "git@github.com:acme/demo.git", " acme/demo/ "]) {
      expect(parseRepo(input)).toEqual({ owner: "acme", repo: "demo" });
    }
  });

  it("rejects other hosts and malformed input", () => {
    for (const input of ["", "acme", "https://gitlab.com/acme/demo", "acme/demo/extra", "-acme/demo"]) expect(parseRepo(input)).toBeUndefined();
  });
});

describe("isBranchName", () => {
  it("allows normal names and rejects odd ones", () => {
    expect(isBranchName("main")).toBe(true);
    expect(isBranchName("feature/x-1.2")).toBe(true);
    for (const bad of ["", "-x", "a..b", "a b", "a/", "a.lock", "a//b"]) expect(isBranchName(bad)).toBe(false);
  });
});
