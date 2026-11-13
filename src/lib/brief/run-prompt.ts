// The text an SE pastes into Claude in Chrome to fill their own copy of the Makeswift template from the
// brief. It is written as instructions with firm limits, because the builder is a drag-and-drop editor
// and Claude should only change what the brief names.
import type { Brief } from "@/lib/brief/generate";
import { BRAND_SWATCHES, TEXT_STYLES } from "@/lib/brief/template";

const quote = (value: string) => `"${value.replace(/"/g, "'")}"`;

export function buildRunPrompt(brief: Brief, siteUrl?: string): string {
  const lines: string[] = [];
  const colours = brief.brand.colours;
  const swatches = BRAND_SWATCHES.map((name) => ({ name, hex: colours.find((colour) => colour.role === name.toLowerCase())?.hex }));

  lines.push(
    `You are filling in a Makeswift website template with content for ${brief.brand.siteName || "a customer"}.`,
    siteUrl ? `Work only in this Makeswift site, which is my own copy of the template: ${siteUrl}` : "Work only in the Makeswift site I have open, which is my own copy of the template.",
    "",
    "RULES",
    "- Never click Publish, Share, or anything that deletes a page, site or element.",
    "- Change only the text, colours and fonts listed below. Do not add, move, resize or delete elements, and do not change links, spacing or layout.",
    "- The sections are Global components. For each one: select it in the Elements panel by name, click Edit component, change its text, then click Save. If you click Cancel by mistake, start that section again.",
    "- Change the text of each element in place by clicking into it. Keep any capital letters the section already uses. Do not paste formatting.",
    "- If an element isn't where I describe it, or text doesn't fit, stop and tell me what you see. Do not guess.",
    "- When all sections are done, tell me exactly what you changed and what you could not.",
    "",
    "STEP 1. Site colours (Design tab, Colours)",
    ...swatches.map((swatch) => (swatch.hex ? `- Set ${swatch.name} to ${swatch.hex}.` : `- Leave ${swatch.name} unchanged.`)),
  );

  if (brief.brand.fonts.heading || brief.brand.fonts.body) {
    lines.push("", "STEP 2. Text styles (Design tab, Text styles). Only if the font is in Makeswift's font list; otherwise leave it and tell me.");
    for (const style of TEXT_STYLES) {
      const font = style.name === "Body" ? brief.brand.fonts.body : style.name === "Headline" ? brief.brand.fonts.heading : null;

      if (font) lines.push(`- ${style.name} (${style.size}): font ${font}.`);
    }
  }

  lines.push("", "STEP 3. Sections (Content tab, Page). Do them in this order.");

  for (const [index, section] of brief.sections.entries()) {
    const filled = section.fields.filter((field) => field.value);

    if (filled.length === 0) continue;

    lines.push("", `${index + 1}. ${section.element}`);

    if (section.targeted) lines.push(`   Targeted customer groups: ${section.groups.length ? section.groups.join(" and ") : "leave the groups as they are, and tell me which are set"}.`);
    if (section.note) lines.push(`   (${section.note})`);

    for (const field of filled) lines.push(`   - ${field.label}: ${quote(field.value)}`);
  }

  lines.push(
    "",
    "STEP 4. Pictures and videos",
    "- Do not look for or create pictures. I will make them from the briefs and upload them myself. Skip every picture and video.",
  );

  return lines.join("\n");
}
