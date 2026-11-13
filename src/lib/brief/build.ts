// Server-only: fetches the customer's site and its stylesheets, reads the brand, and asks the model for the
// copy and the picture and video briefs in two requests at once.
import "server-only";
import { AppError } from "@/lib/errors/app-error";
import { chatCompletion, isAiConfigured } from "@/lib/ai/portkey";
import { digestPage } from "@/lib/import/page-digest";
import { fetchPage } from "@/lib/import/safe-fetch";
import { extractBrand, inlineStyles, stylesheetLinks } from "@/lib/brief/brand";
import { assembleBrief, briefProblem, buildCopyMessages, buildVisualMessages, parseJson, type Brief } from "@/lib/brief/generate";
import type { Audience } from "@/lib/brief/template";

const MAX_CSS = 600_000;

export async function buildBrief(rawUrl: string, audiences: Audience[], groups: Partial<Record<Audience, string[]>>): Promise<Brief> {
  if (!isAiConfigured()) throw new AppError("VALIDATION", "The AI gateway isn't configured.", { detail: "The AI gateway isn't configured. Add PORTKEY_API_KEY to the server environment." });

  const { url, html } = await fetchPage(rawUrl);
  const digest = digestPage(html, url);

  if (!digest.text) throw new AppError("VALIDATION", "No readable content.", { detail: "That page has no readable text. It may load its content with JavaScript, so try another page of the site." });

  const warnings: string[] = [];
  const sheets = await Promise.allSettled(stylesheetLinks(html, url).map((link) => fetchPage(link)));
  const css = [inlineStyles(html), ...sheets.flatMap((sheet) => (sheet.status === "fulfilled" ? [sheet.value.html] : []))].join("\n").slice(0, MAX_CSS);

  if (sheets.length > 0 && sheets.every((sheet) => sheet.status === "rejected")) warnings.push("The site's stylesheets couldn't be read, so colours and fonts may be incomplete. Check them against the site.");

  const brand = extractBrand(html, url, css);

  if (brand.colours.filter((colour) => colour.role !== "neutral").length < 2) warnings.push("Few brand colours could be read from this site's stylesheets, so check the site and set the colours by hand.");
  if (!brand.logo) warnings.push("No logo image was found (it may be drawn inline). Download it from the site.");

  const input = { digest, brand, audiences, groups };
  const [copy, visual] = await Promise.allSettled([
    chatCompletion({ messages: buildCopyMessages(input), json: true, maxTokens: 6000 }),
    chatCompletion({ messages: buildVisualMessages(input), json: true, maxTokens: 7000 }),
  ]);

  if (copy.status === "rejected" && visual.status === "rejected") throw new AppError("UPSTREAM_API", "AI request failed.", { detail: briefProblem(copy.reason) });

  return assembleBrief({
    url,
    brand,
    audiences,
    groups,
    copy: copy.status === "fulfilled" ? parseJson(copy.value.content) : null,
    visual: visual.status === "fulfilled" ? parseJson(visual.value.content) : null,
    warnings,
  });
}
