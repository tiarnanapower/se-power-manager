// The Makeswift home page template the SEs build on, as the brief sees it: which sections it has, what
// text each one holds, and which pictures and videos each one needs. It was read from the template's own
// Elements panel, so the names match what an SE sees in Makeswift. Pure data, shared by the AI prompt,
// the page and the "Run in Claude" instructions.

export type Audience = "b2c" | "b2b";

export interface FieldSpec {
  key: string;
  label: string;
  // What belongs here, in words the model can follow.
  hint: string;
  // A soft length limit in characters, so text fits the design.
  max: number;
}

export interface ImageSpec {
  key: string;
  label: string;
  // Pixels, as the picture is shown in the template.
  size: string;
  purpose: string;
  // Text sits on top of the picture, so part of it must stay calm and uncluttered.
  textOver?: boolean;
}

export interface VideoSpec {
  key: string;
  label: string;
  length: string;
  purpose: string;
}

export interface SectionSpec {
  id: string;
  title: string;
  // The element's name in Makeswift's Elements panel.
  element: string;
  audience?: Audience;
  // Customer Group Slots only show to the groups chosen on them.
  targeted?: boolean;
  note?: string;
  fields: FieldSpec[];
  images: ImageSpec[];
  videos: VideoSpec[];
}

const text = (key: string, label: string, max: number, hint: string): FieldSpec => ({ key, label, max, hint });

const slotFields = (tone: string): FieldSpec[] => [
  text("headline", "Headline", 40, `A short headline that greets this audience (${tone}). Shown in capitals.`),
  text("bullet1", "Benefit 1", 60, "A concrete benefit or perk for this audience."),
  text("bullet2", "Benefit 2", 60, "A second concrete benefit."),
  text("bullet3", "Benefit 3", 60, "A third concrete benefit."),
  text("bullet4", "Benefit 4", 60, "A fourth concrete benefit."),
  text("button", "Button text", 24, "A short call to action."),
];

export const TEMPLATE_NAME = "Home Furnishings home page";

export const SECTIONS: SectionSpec[] = [
  {
    id: "imageBanner",
    title: "Image Banner",
    element: "Image Banner",
    note: "The full-width hero. Text is centred on the picture, under a dark overlay.",
    fields: [
      text("kicker", "Small label above the headline", 30, "A short tagline or category in capitals, for example the brand's positioning."),
      text("headline", "Headline", 40, "The big headline. Punchy, no more than six words."),
      text("body", "Body text", 160, "One or two sentences that say what the business offers and why it is different."),
      text("button", "Button text", 24, "A short call to action, such as Explore the collection."),
    ],
    images: [{ key: "background", label: "Background picture", size: "1920 x 850", purpose: "A wide, atmospheric hero picture that shows the brand's world.", textOver: true }],
    videos: [],
  },
  {
    id: "featuredCategories",
    title: "Featured Categories",
    element: "Featured Categories",
    note: "Three category tiles with a picture, a title and two short lines each. Use the customer's real top categories.",
    fields: [
      text("eyebrow", "Small heading", 40, "A short line above the main heading, in capitals."),
      text("heading", "Main heading", 50, "A heading for the three categories, in capitals."),
      text("cat1Title", "Category 1 title", 30, "The customer's first main category."),
      text("cat1Line1", "Category 1, line 1", 40, "A short selling line."),
      text("cat1Line2", "Category 1, line 2", 40, "A second short line."),
      text("cat2Title", "Category 2 title", 30, "The customer's second main category."),
      text("cat2Line1", "Category 2, line 1", 40, "A short selling line."),
      text("cat2Line2", "Category 2, line 2", 40, "A second short line."),
      text("cat3Title", "Category 3 title", 30, "The customer's third main category."),
      text("cat3Line1", "Category 3, line 1", 40, "A short selling line."),
      text("cat3Line2", "Category 3, line 2", 40, "A second short line."),
    ],
    images: [1, 2, 3].map((n) => ({ key: `cat${n}`, label: `Category ${n} picture`, size: "960 x 540", purpose: `A picture that represents category ${n}.` })),
    videos: [],
  },
  {
    id: "b2cSlot",
    title: "B2C Customer Group Slot",
    element: "B2C Customer Group Slot",
    audience: "b2c",
    targeted: true,
    note: "Shown only to the customer groups chosen on the slot. The text is real text on top of a background picture, so keep one side of the picture calm.",
    fields: slotFields("a warm welcome for a returning consumer or member"),
    images: [{ key: "background", label: "Background picture", size: "1600 x 900", purpose: "A premium lifestyle picture. One side must stay dark and calm so text is readable.", textOver: true }],
    videos: [],
  },
  {
    id: "b2cVideo",
    title: "B2C Video Banner",
    element: "B2C Video Banner",
    audience: "b2c",
    fields: [
      text("eyebrow", "Small label", 30, "A short label in capitals."),
      text("headline", "Headline", 50, "A headline that tells a craftsmanship, quality or brand story."),
      text("button", "Button text", 24, "A short call to action, such as Learn more."),
    ],
    images: [],
    videos: [{ key: "clip", label: "Background video", length: "8 to 15 seconds, loops", purpose: "A silent looping brand film for the consumer audience." }],
  },
  {
    id: "bestSellers",
    title: "Best Sellers",
    element: "Best Sellers",
    note: "The products come from the store itself, so import them first. Only the heading is text.",
    fields: [text("heading", "Heading", 30, "A heading for the product carousel, such as Best Sellers.")],
    images: [],
    videos: [],
  },
  {
    id: "b2bSlot",
    title: "B2B Customer Group Slot",
    element: "B2B Customer Group Slot",
    audience: "b2b",
    targeted: true,
    note: "Shown only to the customer groups chosen on the slot. The text is real text on top of a background picture, so keep one side of the picture calm.",
    fields: slotFields("a trade or business buyer: pricing, terms, account perks"),
    images: [{ key: "background", label: "Background picture", size: "1600 x 900", purpose: "A professional, business-focused picture. One side must stay dark and calm so text is readable.", textOver: true }],
    videos: [],
  },
  {
    id: "b2bVideo",
    title: "B2B Video Banner",
    element: "B2B Video Banner",
    audience: "b2b",
    fields: [
      text("headline", "Headline", 50, "A headline about serving businesses and trade buyers."),
      text("body", "Body text", 200, "One or two sentences about trade and volume offerings."),
      text("benefit1Title", "Benefit 1 title", 30, "A trade benefit, such as quality or pricing."),
      text("benefit1Text", "Benefit 1 text", 110, "One sentence in quotation style."),
      text("benefit2Title", "Benefit 2 title", 30, "A second trade benefit."),
      text("benefit2Text", "Benefit 2 text", 110, "One sentence."),
      text("benefit3Title", "Benefit 3 title", 30, "A third trade benefit, such as logistics."),
      text("benefit3Text", "Benefit 3 text", 110, "One sentence."),
      text("button1", "Button 1 text", 24, "For example Explore Trade Program."),
      text("button2", "Button 2 text", 24, "For example Open a B2B Account."),
    ],
    images: [],
    videos: [{ key: "clip", label: "Background video", length: "8 to 15 seconds, loops", purpose: "A silent looping film for business buyers: offices, warehouses, delivery, teams." }],
  },
  {
    id: "videoScroller",
    title: "Video Scroller",
    element: "Video Scroller",
    note: "A video that plays as the visitor scrolls. No text.",
    fields: [],
    images: [],
    videos: [{ key: "clip", label: "Scroll-driven video", length: "5 to 10 seconds", purpose: "A single smooth shot that reads well when scrubbed forwards, such as a slow reveal or camera move." }],
  },
  {
    id: "shopTheLook",
    title: "Shop the look",
    element: "Shop the look",
    note: "One scene with clickable hotspots on five products. The labels are the product names.",
    fields: [1, 2, 3, 4, 5].map((n) => text(`hotspot${n}`, `Hotspot ${n} label`, 24, "The name of one product visible in the scene, matching a real product in the store.")),
    images: [{ key: "scene", label: "Scene picture", size: "1600 x 1000", purpose: "A styled scene in which five different products are clearly visible and separate from each other." }],
    videos: [],
  },
  {
    id: "signUp",
    title: "Sign-up",
    element: "Sign-up",
    fields: [
      text("heading", "Heading", 40, "An email sign-up heading that names the offer."),
      text("body", "Body text", 120, "One sentence that says what subscribers get."),
      text("placeholder", "Email field text", 30, "The prompt inside the email box."),
      text("button", "Button text", 20, "A short button label."),
    ],
    images: [],
    videos: [],
  },
];

export const BRAND_SWATCHES = ["Primary", "Secondary", "Tertiary", "Neutral"] as const;
export const TEXT_STYLES = [
  { name: "Headline", size: "42px", use: "Headings. The template uses a serif here." },
  { name: "Secondary Title", size: "20px", use: "Sub-headings." },
  { name: "Body", size: "18px", use: "Paragraph text. The template uses Plus Jakarta Sans." },
] as const;

export function sectionsFor(audiences: Audience[]): SectionSpec[] {
  return SECTIONS.filter((section) => !section.audience || audiences.includes(section.audience));
}

// Every field, picture and video a brief for these audiences needs, by full key ("imageBanner.headline").
export function slotsFor(audiences: Audience[]) {
  const sections = sectionsFor(audiences);

  return {
    fields: sections.flatMap((section) => section.fields.map((field) => ({ ...field, full: `${section.id}.${field.key}`, section }))),
    images: sections.flatMap((section) => section.images.map((image) => ({ ...image, full: `${section.id}.${image.key}`, section }))),
    videos: sections.flatMap((section) => section.videos.map((video) => ({ ...video, full: `${section.id}.${video.key}`, section }))),
  };
}
