// Server-only: the copilot's tools. Read tools query the store; the two draft_*
// tools only PROPOSE a change: nothing is written until the person confirms
// the draft card in the UI. The model never sees the store token.
import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getRestApiClient } from "@/lib/bc-api-client/get-rest-api-client";
import { V3ListResponse } from "@/lib/bc-api-client/rest-client/types";
import { CACHE_PROFILE_NONE } from "@/lib/cache/cache-profiles";
import { type Draft, type DraftPreview, applyPatch, compileCreate, createSpecSchema, diffSummaries, patchSchema, summarize } from "@/lib/copilot/draft-spec";
import type { ToolDefinition } from "@/lib/copilot/portkey";
import { describeAudience } from "@/lib/promo-calendar/audience-filter";
import { findConflicts } from "@/lib/promo-calendar/conflicts";
import { addUtcDays } from "@/lib/promo-calendar/dates";
import { toCalendarPromotion } from "@/lib/promo-calendar/from-promotion";
import { findCoverageGaps } from "@/lib/promo-calendar/gaps";
import { type CalendarData, loadCalendar } from "@/lib/promo-calendar/load-calendar";
import type { CalendarPromotion, LifecycleState } from "@/lib/promo-calendar/types";
import { fetchPromotion } from "@/lib/promotions/promotions-api";
import { cleanText, riskWarnings } from "@/lib/copilot/guard";
import { signDraft } from "@/lib/copilot/draft-token";
import { parseInZone } from "@/lib/promo-calendar/zone";
import type { Promotion } from "@/lib/promotions/types";

export interface ToolContext {
  storeHash: string | undefined;
  now: Date;
  calendar(): Promise<CalendarData>;
}

export interface DraftProposal {
  id: string;
  // Server signature over this exact draft; Apply is refused without it.
  token: string;
  draft: Draft;
  preview: DraftPreview;
}

export interface ChoiceSet {
  question: string;
  multiple: boolean;
  options: Array<{ label: string; prompt: string }>;
}

export interface ToolOutcome {
  result: unknown;
  proposal?: DraftProposal;
  choices?: ChoiceSet;
}

const choicesSchema = z.object({
  question: z.string().trim().min(1).max(160),
  multiple: z.boolean().optional(),
  options: z.array(z.object({ label: z.string().trim().min(1).max(70), prompt: z.string().trim().min(1).max(400) })).min(2).max(5),
});

export function createToolContext(storeHash: string | undefined, now: Date): ToolContext {
  let calendar: Promise<CalendarData> | undefined;

  return { storeHash, now, calendar: () => (calendar ??= loadCalendar(storeHash)) };
}

const STATES = ["live", "scheduled", "ended", "exhausted", "disabled", "invalid"] as const;
const MAX_LIST = 60;

const listArgs = z.object({
  state: z.enum(STATES).optional(),
  query: z.string().max(100).optional(),
  group_id: z.number().int().optional(),
  active_from: z.string().optional(),
  active_to: z.string().optional(),
});
const idArgs = z.object({ id: z.number().int().positive() });
const gapArgs = z.object({ days: z.number().int().min(1).max(365).default(90) });
const catalogArgs = z.object({ kind: z.enum(["category", "brand", "product"]), query: z.string().trim().min(1).max(100) });

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "list_promotions",
      description: "List the store's promotions (compact). Use to answer what is running, scheduled or ended, and for any filtering by status, name, audience or dates.",
      parameters: {
        type: "object",
        properties: {
          state: { type: "string", enum: [...STATES], description: "Lifecycle state filter." },
          query: { type: "string", description: "Case-insensitive match on the promotion name." },
          group_id: { type: "integer", description: "Only promotions that apply to this customer group id." },
          active_from: { type: "string", description: "ISO date: only promotions active on or after this." },
          active_to: { type: "string", description: "ISO date: only promotions active on or before this." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_promotion",
      description: "Get one promotion's full detail (rules, audience, schedule, messages) by id.",
      parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: { name: "list_customer_groups", description: "List the store's customer groups (id and name).", parameters: { type: "object", properties: {}, additionalProperties: false } },
  },
  {
    type: "function",
    function: {
      name: "find_coverage_gaps",
      description: "Find runs of days with no automatic promotion open to every shopper.",
      parameters: { type: "object", properties: { days: { type: "integer", description: "Look-ahead window in days (default 90)." } }, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: { name: "find_conflicts", description: "Find automatic promotions that overlap in time, audience and channel.", parameters: { type: "object", properties: {}, additionalProperties: false } },
  },
  {
    type: "function",
    function: {
      name: "search_catalog",
      description: "Look up category, brand or product ids by name, needed to target a promotion at items.",
      parameters: {
        type: "object",
        properties: { kind: { type: "string", enum: ["category", "brand", "product"] }, query: { type: "string" } },
        required: ["kind", "query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "draft_create_promotion",
      description:
        "Propose a NEW promotion. Nothing is saved: the person reviews a draft card and must confirm. It is always created disabled. Supported rewards: percent or amount off the order, percent or amount off specific items, free shipping. Dates are the store's local time as YYYY-MM-DDTHH:mm with no offset (for example 2026-11-27T00:00).",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Internal name." },
          displayName: { type: "string", description: "Name shoppers see (optional)." },
          redemption: { type: "string", enum: ["AUTOMATIC", "COUPON"], description: "Default AUTOMATIC. COUPON requires couponCode." },
          couponCode: { type: "string" },
          reward: {
            type: "object",
            description: "kind is one of percent_off_order, amount_off_order, percent_off_items, amount_off_items, free_shipping.",
            properties: {
              kind: { type: "string", enum: ["percent_off_order", "amount_off_order", "percent_off_items", "amount_off_items", "free_shipping"] },
              percent: { type: "number", description: "1-100, for percent_* kinds." },
              amount: { type: "number", description: "Currency amount, for amount_* kinds." },
              minSpend: { type: "number", description: "Optional minimum cart spend." },
              target: {
                type: "object",
                description: "Required for *_off_items kinds. Ids from search_catalog.",
                properties: {
                  categoryIds: { type: "array", items: { type: "integer" } },
                  brandIds: { type: "array", items: { type: "integer" } },
                  productIds: { type: "array", items: { type: "integer" } },
                },
              },
            },
            required: ["kind"],
          },
          targetLabel: { type: "string", description: "Human label for the item target, e.g. 'Winter category'. Display only." },
          start: { type: ["string", "null"], description: "ISO start, or null to start as soon as enabled." },
          end: { type: ["string", "null"], description: "ISO end, or null for no end date." },
          groupIds: { type: "array", items: { type: "integer" }, description: "Customer group ids it applies to; empty = everyone." },
          excludedGroupIds: { type: "array", items: { type: "integer" } },
          channelIds: { type: "array", items: { type: "integer" }, description: "Empty = all channels." },
          stackable: { type: "boolean", description: "Can combine with other promotions (default true)." },
          maxUses: { type: "integer" },
          messages: {
            type: "object",
            description: "Optional storefront banner copy.",
            properties: { upsell: { type: "string" }, eligible: { type: "string" }, applied: { type: "string" } },
          },
        },
        required: ["name", "reward"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "draft_update_promotion",
      description:
        "Propose a change to an EXISTING promotion. Nothing is saved until the person confirms. Changeable: name, displayName, start, end, status (ENABLED or DISABLED), groupIds, excludedGroupIds, stackable, maxUses, percent (simple percentage promotions only).",
      parameters: {
        type: "object",
        properties: {
          id: { type: "integer" },
          patch: {
            type: "object",
            properties: {
              name: { type: "string" },
              displayName: { type: "string" },
              start: { type: ["string", "null"] },
              end: { type: ["string", "null"] },
              status: { type: "string", enum: ["ENABLED", "DISABLED"] },
              groupIds: { type: "array", items: { type: "integer" } },
              excludedGroupIds: { type: "array", items: { type: "integer" } },
              stackable: { type: "boolean" },
              maxUses: { type: ["integer", "null"] },
              percent: { type: "number" },
            },
          },
        },
        required: ["id", "patch"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "offer_choices",
      description:
        "Show the person clickable buttons instead of asking in text. Use it whenever you suggest ideas to pick from, or need them to choose between options. Each option has a short button label and a full instruction (prompt) that is sent back as their next message when clicked, e.g. 'Draft a 15% off storewide promotion for Black Friday weekend 2026-11-27 to 2026-11-29'. Set multiple=true when more than one may be picked. After calling it, write one short line and stop; do not repeat the options in text.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "One short line, e.g. 'Which should I draft?'" },
          multiple: { type: "boolean" },
          options: { type: "array", items: { type: "object", properties: { label: { type: "string" }, prompt: { type: "string" } }, required: ["label", "prompt"], additionalProperties: false } },
        },
        required: ["question", "options"],
        additionalProperties: false,
      },
    },
  },
];

export const TOOL_LABELS: Record<string, string> = {
  list_promotions: "Reading promotions",
  get_promotion: "Opening a promotion",
  list_customer_groups: "Checking customer groups",
  find_coverage_gaps: "Looking for gaps",
  find_conflicts: "Checking for overlaps",
  search_catalog: "Searching the catalog",
  draft_create_promotion: "Drafting a promotion",
  draft_update_promotion: "Drafting a change",
  offer_choices: "Preparing options",
};

function summarizeForModel(promotion: CalendarPromotion, names: Map<number, string>) {
  return {
    id: promotion.id,
    name: promotion.displayName,
    type: promotion.redemption,
    state: promotion.state,
    reward: promotion.discountSummary,
    starts: promotion.start?.toISOString() ?? null,
    ends: promotion.end?.toISOString() ?? null,
    audience: describeAudience(promotion.audience, names),
    channels: promotion.channelIds.length === 0 ? "all" : promotion.channelIds,
    stackable: promotion.stackable,
  };
}

async function groupNameMap(ctx: ToolContext): Promise<Map<number, string>> {
  return new Map((await ctx.calendar()).groups.map((group) => [group.id, group.name]));
}

// Warnings shown on the draft card: overlaps the change would create.
async function overlapWarnings(ctx: ToolContext, candidate: Promotion, replacingId?: number): Promise<string[]> {
  const calendar = await ctx.calendar();
  const hypotheticalId = replacingId ?? -1;
  const hypothetical = toCalendarPromotion({ ...candidate, id: hypotheticalId, status: candidate.status === "DISABLED" && replacingId === undefined ? "ENABLED" : candidate.status }, ctx.now);

  if (!hypothetical) return [];

  const others = calendar.promotions.filter((promotion) => promotion.id !== replacingId);

  const hits = findConflicts([...others, hypothetical]).filter((conflict) => conflict.promotionIds.includes(hypotheticalId));

  if (hits.length <= 2) return hits.map((conflict) => conflict.message);

  const names = [...new Set(hits.flatMap((conflict) => conflict.promotionIds).filter((id) => id !== hypotheticalId))]
    .map((id) => others.find((promotion) => promotion.id === id)?.displayName ?? others.find((promotion) => promotion.id === id)?.name)
    .filter((name): name is string => Boolean(name));

  return [`Overlaps ${names.length} other automatic promotions (${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}). Shoppers may get more than one discount.`];
}

async function draftCreate(args: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  const spec = createSpecSchema.parse(args);
  const { timeZone } = await ctx.calendar();
  const compiled = compileCreate(spec, timeZone);
  const names = await groupNameMap(ctx);
  const lines = diffSummaries(null, summarize(compiled, names, { targetLabel: spec.targetLabel, timeZone }));
  const warnings = await overlapWarnings(ctx, compiled);

  if (spec.redemption === "COUPON") lines.splice(1, 0, { label: "Coupon code", before: "", after: spec.couponCode ?? "" });
  if (spec.start && parseInZone(spec.start, timeZone).getTime() < ctx.now.getTime()) warnings.push("The start date is in the past, so it will apply immediately once enabled.");

  const draft: Draft = { type: "create", spec };
  warnings.push(...riskWarnings(compiled));

  const proposal: DraftProposal = { id: randomUUID(), token: signDraft(ctx.storeHash, draft), draft, preview: { title: `New promotion: ${spec.displayName || spec.name}`, lines, warnings } };

  return {
    result: { ok: true, draftId: proposal.id, status: "Shown to the person for confirmation. NOT saved yet.", willCreateAsDisabled: true, warnings },
    proposal,
  };
}

async function draftUpdate(args: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  const { id } = idArgs.parse(args);
  const patch = patchSchema.parse((args as { patch?: unknown }).patch);
  const current = await fetchPromotion(id, ctx.storeHash);
  const { timeZone } = await ctx.calendar();
  const next = applyPatch(current, patch, timeZone);
  const names = await groupNameMap(ctx);
  const lines = diffSummaries(summarize(current, names, { timeZone }), summarize(next, names, { timeZone }));

  if (lines.length === 0) throw new Error("That change would not alter anything.");

  const warnings = await overlapWarnings(ctx, next, id);

  if (patch.status === "ENABLED") warnings.unshift("Enabling this makes it apply to shoppers straight away (subject to its dates).");

  const draft: Draft = { type: "update", id, patch };
  const before = new Set(riskWarnings(current));

  warnings.push(...riskWarnings(next).filter((warning) => !before.has(warning)));

  const proposal: DraftProposal = { id: randomUUID(), token: signDraft(ctx.storeHash, draft), draft, preview: { title: `Change "${current.display_name || current.name}"`, lines, warnings } };

  return { result: { ok: true, draftId: proposal.id, status: "Shown to the person for confirmation. NOT saved yet.", warnings }, proposal };
}

async function searchCatalog(args: unknown, ctx: ToolContext) {
  const { kind, query } = catalogArgs.parse(args);
  const apiClient = await getRestApiClient(ctx.storeHash);
  const config = {
    category: { path: "/v3/catalog/categories", params: { "name:like": query, limit: 10, include_fields: "id,name" } },
    brand: { path: "/v3/catalog/brands", params: { "name:like": query, limit: 10, include_fields: "id,name" } },
    product: { path: "/v3/catalog/products", params: { keyword: query, limit: 10, include_fields: "id,name,sku" } },
  }[kind];
  const { data } = await apiClient.get<V3ListResponse<{ id: number; name: string; sku?: string }>>(config.path, { params: config.params, cache: { profile: CACHE_PROFILE_NONE } });

  return { kind, matches: (data?.data ?? []).map((item) => ({ id: item.id, name: item.name, ...(item.sku && { sku: item.sku }) })) };
}

export async function executeTool(name: string, rawArguments: string, ctx: ToolContext): Promise<ToolOutcome> {
  const args: unknown = rawArguments ? JSON.parse(rawArguments) : {};

  switch (name) {
    case "list_promotions": {
      const filter = listArgs.parse(args);
      const calendar = await ctx.calendar();
      const names = await groupNameMap(ctx);
      const needle = filter.query?.toLowerCase();
      const from = filter.active_from ? new Date(filter.active_from) : null;
      const to = filter.active_to ? new Date(filter.active_to) : null;
      const matches = calendar.promotions.filter(
        (p) =>
          (!filter.state || p.state === (filter.state as LifecycleState)) &&
          (!needle || p.displayName.toLowerCase().includes(needle) || p.name.toLowerCase().includes(needle)) &&
          (filter.group_id === undefined || (p.audience.hasSegments || (!p.audience.excludedGroupIds.includes(filter.group_id) && (p.audience.everyone || p.audience.groupIds.includes(filter.group_id))))) &&
          (!from || !p.end || p.end >= from) &&
          (!to || !p.start || p.start <= to),
      );

      return { result: { total: matches.length, showing: Math.min(matches.length, MAX_LIST), promotions: matches.slice(0, MAX_LIST).map((p) => summarizeForModel(p, names)) } };
    }
    case "get_promotion": {
      const { id } = idArgs.parse(args);
      const promotion = await fetchPromotion(id, ctx.storeHash);
      const { rules, customer, notifications, schedule } = promotion;

      return { result: { id, name: promotion.name, display_name: promotion.display_name, status: promotion.status, redemption_type: promotion.redemption_type, start_date: promotion.start_date, end_date: promotion.end_date, schedule, customer, can_be_used_with_other_promotions: promotion.can_be_used_with_other_promotions, max_uses: promotion.max_uses, current_uses: promotion.current_uses, channels: promotion.channels, rules, notifications } };
    }
    case "list_customer_groups":
      return { result: { groups: (await ctx.calendar()).groups } };
    case "find_coverage_gaps": {
      const { days } = gapArgs.parse(args);
      const calendar = await ctx.calendar();

      return { result: { gaps: findCoverageGaps(calendar.promotions, ctx.now, addUtcDays(ctx.now, days)).map((gap) => ({ from: gap.from.toISOString().slice(0, 10), to: gap.to.toISOString().slice(0, 10), days: gap.days })) } };
    }
    case "find_conflicts":
      return { result: { conflicts: (await ctx.calendar()).conflicts.map((c) => ({ severity: c.severity, promotionIds: c.promotionIds, message: c.message })) } };
    case "search_catalog":
      return { result: await searchCatalog(args, ctx) };
    case "offer_choices": {
      const parsed = choicesSchema.parse(args);

      return {
        result: { ok: true, status: "Shown as clickable buttons. Wait for the person to click." },
        choices: { question: cleanText(parsed.question, 160), multiple: parsed.multiple ?? false, options: parsed.options.map((o) => ({ label: cleanText(o.label, 70), prompt: cleanText(o.prompt, 400) })) },
      };
    }
    case "draft_create_promotion":
      return draftCreate(args, ctx);
    case "draft_update_promotion":
      return draftUpdate(args, ctx);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
