"use server";

import { z } from "zod";
import type { BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";
import { type Outcome, runStoreAction } from "@/lib/actions/run-action";
import { finishPickLists } from "@/lib/catalog/pick-lists";
import { restoreProducts, type RestoreBatchResult } from "@/lib/catalog/operations";
import { captureB2b, importB2b, type B2bCompany } from "@/lib/samples/sections/b2b";
import type { SectionResult } from "@/lib/samples/sections/shared";
import { importCustomRoles, importOrders, importQuotes, listSourceOrders, listSourceQuotes, readCustomRoles, readSourceOrders, readSourceQuotes } from "@/lib/wawaweewa/b2b-extras";
import { planSource, readSourceProducts, type SourcePlan } from "@/lib/wawaweewa/source";
import { getWawaweewaB2bClient, getWawaweewaClient } from "@/lib/wawaweewa/config";

// Actions behind Wawaweewa. The source store's token stays on the server: the browser only ever sees what
// was read from it, a few products or companies at a time, so no single request is large or slow.

const refs = z.array(z.tuple([z.number().int(), z.object({ sku: z.string().nullable(), name: z.string() })])).max(100_000);
const ids = (max: number) => z.array(z.number().int().positive()).min(1).max(max);
const short = z.string().max(400);
const company = z.object({
  companyName: short, companyEmail: short, companyPhone: short, addressLine1: short, addressLine2: short, city: short, state: short, country: short, zipCode: short,
  users: z.array(z.object({ firstName: short, lastName: short, email: short, phoneNumber: short, role: z.number().int().min(0).max(9), roleName: short.optional() })).max(500),
});

export async function planWawaweewaAction(storeHash: unknown): Promise<Outcome<{ plan: SourcePlan }>> {
  return runStoreAction(storeHash, "planWawaweewaAction", async () => ({ plan: await planSource(getWawaweewaClient()) }));
}

export async function importWawaweewaBatchAction(storeHash: unknown, input: unknown): Promise<Outcome<{ batch: RestoreBatchResult }>> {
  const parsed = z.object({ ids: ids(10), refs, offset: z.number().int().min(0), total: z.number().int().min(0).max(100_000) }).safeParse(input);

  if (!parsed.success) return { ok: false, message: "Invalid request." };

  return runStoreAction(storeHash, "importWawaweewaBatchAction", async (ctx) => {
    const { ids: wanted, refs: sourceRefs, offset, total } = parsed.data;
    const products = await readSourceProducts(getWawaweewaClient(), wanted, sourceRefs);
    // Pictures stay on the source store's CDN, which BigCommerce fetches from directly.
    const batch = await restoreProducts(ctx, { label: "the Wawaweewa source store", total, offset, products, packId: null, activityKind: "wawaweewa.import" });

    batch.done = batch.nextOffset >= total;

    return { batch };
  });
}

// Pick lists point at other products, so they are linked once every product exists.
export async function finishWawaweewaPickListsAction(storeHash: unknown, input: unknown): Promise<Outcome<{ created: number; warnings: { name: string; detail: string }[] }>> {
  const parsed = z.object({ ids: ids(20), refs }).safeParse(input);

  if (!parsed.success) return { ok: false, message: "Invalid request." };

  return runStoreAction(storeHash, "finishWawaweewaPickListsAction", async (ctx) => {
    const products = await readSourceProducts(getWawaweewaClient(), parsed.data.ids, parsed.data.refs);
    const result = await finishPickLists(ctx.client, products);

    return { created: result.done, warnings: result.warnings };
  });
}

export async function planWawaweewaB2bAction(storeHash: unknown): Promise<Outcome<{ companies: B2bCompany[]; warnings: string[] }>> {
  return runStoreAction(storeHash, "planWawaweewaB2bAction", async (ctx) => {
    const captured = await captureB2b(ctx.client, { b2b: async () => getWawaweewaB2bClient() });

    // The "quotes, orders and roles aren't included" note is a snapshot caveat: Wawaweewa has its own checkboxes for those.
    return { companies: (captured.data as { companies: B2bCompany[] }).companies, warnings: captured.warnings.filter((warning) => !warning.startsWith("Quotes, orders and custom roles")) };
  });
}

export async function importWawaweewaB2bAction(storeHash: unknown, input: unknown): Promise<Outcome<{ result: SectionResult }>> {
  const parsed = z.object({ companies: z.array(company).min(1).max(5) }).safeParse(input);

  if (!parsed.success) return { ok: false, message: "Invalid request." };

  return runStoreAction(storeHash, "importWawaweewaB2bAction", async (ctx) => {
    const result = await importB2b(ctx.client, { companies: parsed.data.companies }, { b2b: ctx.b2b });

    await ctx.data.logActivity({
      storeHash: ctx.storeHash,
      userEmail: ctx.userEmail,
      kind: "wawaweewa.import-b2b",
      summary: `Imported B2B companies from the Wawaweewa source store: ${result.created} created, ${result.skipped} skipped${result.warnings.length ? `, ${result.warnings.length} warnings` : ""}.`,
      status: result.warnings.length ? "partial" : "success",
    });

    return { result };
  });
}

// B2B Edition on the store being imported into.
async function destinationB2b(ctx: { b2b?: () => Promise<BcRestApiClient> }): Promise<BcRestApiClient> {
  if (!ctx.b2b) throw new Error("B2B Edition isn't available for this store.");

  return ctx.b2b();
}

// Custom roles are few, so they are read and created in one request.
export async function importWawaweewaRolesAction(storeHash: unknown): Promise<Outcome<{ result: SectionResult }>> {
  return runStoreAction(storeHash, "importWawaweewaRolesAction", async (ctx) => {
    const result = await importCustomRoles(await destinationB2b(ctx), await readCustomRoles(getWawaweewaB2bClient()));

    await ctx.data.logActivity({ storeHash: ctx.storeHash, userEmail: ctx.userEmail, kind: "wawaweewa.import-roles", summary: `Imported custom B2B roles from the Wawaweewa source store: ${result.created} created, ${result.skipped} skipped.`, status: result.warnings.length ? "partial" : "success" });

    return { result };
  });
}

export async function planWawaweewaQuotesAction(storeHash: unknown): Promise<Outcome<{ ids: number[] }>> {
  return runStoreAction(storeHash, "planWawaweewaQuotesAction", async () => ({ ids: (await listSourceQuotes(getWawaweewaB2bClient())).map((quote) => quote.id) }));
}

export async function importWawaweewaQuotesAction(storeHash: unknown, input: unknown): Promise<Outcome<{ result: SectionResult }>> {
  const parsed = z.object({ ids: ids(5) }).safeParse(input);

  if (!parsed.success) return { ok: false, message: "Invalid request." };

  return runStoreAction(storeHash, "importWawaweewaQuotesAction", async (ctx) => {
    const quotes = await readSourceQuotes(getWawaweewaB2bClient(), parsed.data.ids);
    const result = await importQuotes({ b2b: await destinationB2b(ctx), store: ctx.client }, quotes);

    await ctx.data.logActivity({ storeHash: ctx.storeHash, userEmail: ctx.userEmail, kind: "wawaweewa.import-quotes", summary: `Imported B2B quotes from the Wawaweewa source store: ${result.created} created, ${result.skipped} skipped${result.warnings.length ? `, ${result.warnings.length} warnings` : ""}.`, status: result.warnings.length ? "partial" : "success" });

    return { result };
  });
}

export async function planWawaweewaOrdersAction(storeHash: unknown): Promise<Outcome<{ ids: number[] }>> {
  return runStoreAction(storeHash, "planWawaweewaOrdersAction", async () => ({ ids: (await listSourceOrders(getWawaweewaB2bClient())).map((order) => order.id) }));
}

export async function importWawaweewaOrdersAction(storeHash: unknown, input: unknown): Promise<Outcome<{ result: SectionResult }>> {
  const parsed = z.object({ ids: ids(5) }).safeParse(input);

  if (!parsed.success) return { ok: false, message: "Invalid request." };

  return runStoreAction(storeHash, "importWawaweewaOrdersAction", async (ctx) => {
    const orders = await readSourceOrders(getWawaweewaClient(), parsed.data.ids);
    const result = await importOrders({ b2b: await destinationB2b(ctx), store: ctx.client }, orders);

    await ctx.data.logActivity({ storeHash: ctx.storeHash, userEmail: ctx.userEmail, kind: "wawaweewa.import-orders", summary: `Imported orders from the Wawaweewa source store: ${result.created} created, ${result.skipped} skipped${result.warnings.length ? `, ${result.warnings.length} warnings` : ""}.`, status: result.warnings.length ? "partial" : "success" });

    return { result };
  });
}
