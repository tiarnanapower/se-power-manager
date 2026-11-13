import { describe, expect, it } from "vitest";
import { extractBrand } from "@/lib/brief/brand";
import { assembleBrief, buildCopyMessages, buildVisualMessages, parseJson } from "@/lib/brief/generate";
import { buildRunPrompt } from "@/lib/brief/run-prompt";
import { sectionsFor, slotsFor } from "@/lib/brief/template";

const brand = extractBrand(`<title>Fine Oak</title><meta name="theme-color" content="#1a6b4a">`, "https://fineoak.example/", ".a{color:#d97706}.a2{color:#d97706}.b{color:#1a6b4a}");
const digest = { url: "https://fineoak.example/", title: "Fine Oak", meta: {}, jsonLd: [], text: "Oak tables and chairs, made in Devon.", images: [] };

describe("the template", () => {
  it("shows B2C and B2B slots only for the audiences chosen", () => {
    expect(sectionsFor(["b2c"]).map((section) => section.id)).toContain("b2cSlot");
    expect(sectionsFor(["b2c"]).map((section) => section.id)).not.toContain("b2bSlot");
    expect(sectionsFor(["b2b"]).map((section) => section.id)).toContain("b2bVideo");
    expect(sectionsFor(["b2c", "b2b"]).filter((section) => section.targeted)).toHaveLength(2);
  });
});

describe("asking the model", () => {
  it("lists every field for the chosen audiences, and mentions the customer groups", () => {
    const messages = buildCopyMessages({ digest, brand, audiences: ["b2b"], groups: { b2b: ["Trade"] } });
    const prompt = messages[1].content;

    expect(prompt).toContain("imageBanner.headline");
    expect(prompt).toContain("b2bSlot.bullet4");
    expect(prompt).not.toContain("b2cSlot.headline");
    expect(prompt).toContain("customer groups: Trade");
  });

  it("asks for a brief for each picture and video, saying which pictures carry text", () => {
    const prompt = buildVisualMessages({ digest, brand, audiences: ["b2c"], groups: {} })[1].content;

    expect(prompt).toContain("b2cSlot.background | Background picture | 1600 x 900 px");
    expect(prompt).toContain("| YES");
    expect(prompt).toContain("videoScroller.clip");
  });

  it("reads JSON even when it comes in a code fence, and gives nothing for rubbish", () => {
    expect(parseJson("```json\n{\"a\":1}\n```")).toEqual({ a: 1 });
    expect(parseJson("not json")).toBeNull();
    expect(parseJson(null)).toBeNull();
  });
});

describe("assembling the brief", () => {
  const slots = slotsFor(["b2c"]);
  const copy = { voice: { tagline: "Built to last", tone: "warm" }, fields: { "imageBanner.headline": "Furniture built to last", "made.up.key": "ignored", "b2cSlot.button": 5 } };
  const visual = { images: { "imageBanner.background": { prompt: "A sunlit oak showroom", alt: "Oak showroom" } }, videos: { "b2cVideo.clip": { shots: ["Wide shot", "", "Detail"], keywords: ["oak workshop"] } } };

  it("fills the template's own slots, blanks what the model left out, and drops anything unknown", () => {
    const brief = assembleBrief({ url: digest.url, brand, audiences: ["b2c"], groups: { b2c: ["Guest Consumer", "VIP"] }, copy, visual });
    const banner = brief.sections.find((section) => section.id === "imageBanner");
    const slot = brief.sections.find((section) => section.id === "b2cSlot");

    expect(banner?.fields.find((field) => field.key === "headline")?.value).toBe("Furniture built to last");
    expect(banner?.fields.find((field) => field.key === "kicker")?.value).toBe("");
    expect(banner?.images[0]).toMatchObject({ prompt: "A sunlit oak showroom", alt: "Oak showroom", size: "1920 x 850", textOver: true });
    expect(slot?.groups).toEqual(["Guest Consumer", "VIP"]);
    expect(slot?.fields.find((field) => field.key === "button")?.value).toBe("5");
    expect(brief.sections.find((section) => section.id === "b2cVideo")?.videos[0].shots).toEqual(["Wide shot", "Detail"]);
    expect(JSON.stringify(brief)).not.toContain("ignored");
    expect(brief.sections.flatMap((section) => section.fields)).toHaveLength(slots.fields.length);
    expect(brief.voice.tagline).toBe("Built to last");
  });

  it("warns when a half of the answer is unusable", () => {
    const brief = assembleBrief({ url: digest.url, brand, audiences: ["b2c"], groups: {}, copy: null, visual });

    expect(brief.warnings.join(" ")).toContain("text couldn't be written");
    expect(brief.sections[0].images[0].prompt).toBe("A sunlit oak showroom");
  });
});

describe("the Run in Claude prompt", () => {
  const brief = assembleBrief({ url: digest.url, brand, audiences: ["b2c"], groups: { b2c: ["VIP - Gold"] }, copy: { fields: { "imageBanner.headline": "Built to last", "b2cSlot.headline": "Welcome back" } }, visual: {} });
  const prompt = buildRunPrompt(brief, "https://app.makeswift.com/copy");

  it("is firm about not publishing or changing anything else", () => {
    expect(prompt).toContain("Never click Publish");
    expect(prompt).toContain("Do not add, move, resize or delete elements");
    expect(prompt).toContain("https://app.makeswift.com/copy");
  });

  it("tells Claude to use Claude in Chrome and never sign in", () => {
    expect(prompt).toContain("Claude in Chrome browser tools");
    expect(prompt).toContain("Never type a password");
  });

  it("names the colours, the sections in order, the text and the targeted groups", () => {
    expect(prompt).toContain("Set Primary to #1A6B4A.");
    expect(prompt).toContain("1. Image Banner");
    expect(prompt).toContain('- Headline: "Built to last"');
    expect(prompt).toContain("Targeted customer groups: VIP - Gold.");
    expect(prompt).toContain("Skip every picture and video");
  });

  it("leaves out sections that have no text", () => {
    expect(prompt).not.toContain("Video Scroller");
  });
});
