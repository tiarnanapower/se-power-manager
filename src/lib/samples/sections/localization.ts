// Localization: each channel's languages (and which is the default), and the translations of products
// for them. Import adds missing languages to the matching channel (found by name), makes the chosen
// language the default, and writes product translations (products are found by SKU, so import the
// catalog first). Uses the GraphQL Admin API. A channel can have at most five languages.
import type { BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";
import { asRecord, attempt, describe, emptyResult, gql, key, positiveInt, productIdsBySku, readAll, records, text, type JsonRecord, type SectionFile, type SectionResult } from "@/lib/samples/sections/shared";

export interface LocalizationData {
  channels: { name: string; locales: { code: string; status: string; isDefault: boolean }[] }[];
  translations: { channel: string; locale: string; products: { sku: string; fields: Record<string, string> }[] }[];
  // Every language code used, and the one the first channel has as its default.
  languages: string[];
  defaultLanguage: string;
}

const LOCALES = `query($channelId: ID!) { store { locales(input: { channelId: $channelId }) { edges { node { code status isDefault } } } } }`;
const TRANSLATIONS = `query($channelId: ID!, $localeId: ID!, $after: String) {
  store { translations(filters: { resourceType: PRODUCTS, channelId: $channelId, localeId: $localeId }, first: 50, after: $after) {
    edges { node { resourceId fields { fieldName translation } } cursor }
    pageInfo { hasNextPage endCursor }
  } }
}`;
const ADD_LOCALE = `mutation($input: AddLocaleInput!) { locale { addLocale(input: $input) { locale { code } errors { ... on Error { message } } } } }`;
const UPDATE_LOCALE = `mutation($input: UpdateLocaleInput!) { locale { updateLocale(input: $input) { locale { code } errors { ... on Error { message } } } } }`;
const UPDATE_TRANSLATIONS = `mutation($input: UpdateTranslationsInput!) { translation { updateTranslations(input: $input) { errors { ... on Error { message } } } } }`;

const channelRef = (id: number) => `bc/store/channel/${id}`;
const edges = (value: unknown): JsonRecord[] => records(asRecord(value)?.edges).map((edge) => asRecord(edge.node) ?? {});
const mutationErrors = (data: JsonRecord, group: string, name: string): string[] => records(asRecord(asRecord(data[group])?.[name])?.errors).map((error) => text(error.message));

export async function captureLocalization(client: BcRestApiClient): Promise<SectionFile<LocalizationData>> {
  const warnings: string[] = [];
  const channels = await attempt("Channels", warnings, () => readAll(client, "/v3/channels"), [] as JsonRecord[]);
  const products = await attempt("Products", warnings, () => readAll(client, "/v3/catalog/products", { include_fields: "id,sku" }), [] as JsonRecord[]);
  const skuOf = new Map(products.map((product) => [positiveInt(product.id) ?? 0, text(product.sku)]));
  const data: LocalizationData = { channels: [], translations: [], languages: [], defaultLanguage: "" };

  for (const channel of channels) {
    const id = positiveInt(channel.id);

    if (!id) continue;

    const locales = await attempt(`Languages of ${text(channel.name)}`, warnings, async () => edges(asRecord((await gql(client, LOCALES, { channelId: channelRef(id) })).store)?.locales).map((node) => ({ code: text(node.code), status: text(node.status) || "ACTIVE", isDefault: node.isDefault === true })), [] as LocalizationData["channels"][number]["locales"]);

    if (locales.length === 0) continue;

    data.channels.push({ name: text(channel.name), locales });

    for (const locale of locales.filter((entry) => !entry.isDefault)) {
      const entries: LocalizationData["translations"][number]["products"] = [];

      await attempt(`Translations for ${text(channel.name)} (${locale.code})`, warnings, async () => {
        let after: string | undefined;

        for (let page = 0; page < 200; page += 1) {
          const store = asRecord((await gql(client, TRANSLATIONS, { channelId: channelRef(id), localeId: `bc/store/locale/${locale.code}`, after })).store);
          const connection = asRecord(store?.translations);

          for (const node of edges(connection)) {
            const productId = Number(text(node.resourceId).split("/").pop());
            const sku = skuOf.get(productId);
            const fields: Record<string, string> = {};

            for (const field of records(node.fields)) if (text(field.translation)) fields[text(field.fieldName)] = String(field.translation);

            if (sku && Object.keys(fields).length > 0) entries.push({ sku, fields });
          }

          const info = asRecord(connection?.pageInfo);

          if (info?.hasNextPage !== true) break;

          after = text(info.endCursor);
        }
      }, undefined);

      if (entries.length > 0) data.translations.push({ channel: text(channel.name), locale: locale.code, products: entries });
    }
  }

  data.languages = [...new Set(data.channels.flatMap((channel) => channel.locales.map((locale) => locale.code)))];
  data.defaultLanguage = data.channels[0]?.locales.find((locale) => locale.isDefault)?.code ?? data.languages[0] ?? "";

  return { data, warnings };
}

export async function importLocalization(client: BcRestApiClient, file: LocalizationData, extras: { defaultLanguage?: string } = {}): Promise<SectionResult> {
  const result = emptyResult();
  const targetChannels = await readAll(client, "/v3/channels").catch((error) => {
    result.warnings.push(`Channels: ${describe(error)}`);

    return [] as JsonRecord[];
  });
  const chosenDefault = extras.defaultLanguage || file.defaultLanguage;

  for (const source of file.channels ?? []) {
    const target = targetChannels.find((channel) => key(channel.name) === key(source.name));
    const targetId = positiveInt(target?.id);

    if (!targetId) {
      result.warnings.push(`Channel ${source.name}: no channel with that name in this store, so its languages were skipped.`);
      continue;
    }

    const have = await attempt(`Languages of ${source.name}`, result.warnings, async () => edges(asRecord((await gql(client, LOCALES, { channelId: channelRef(targetId) })).store)?.locales).map((node) => text(node.code)), [] as string[]);

    for (const locale of source.locales) {
      try {
        if (!have.includes(locale.code)) {
          const added = await gql(client, ADD_LOCALE, { input: { channelId: channelRef(targetId), code: locale.code, status: locale.status === "ACTIVE" ? "ACTIVE" : "INACTIVE" } });
          const errors = mutationErrors(added, "locale", "addLocale");

          if (errors.length > 0) throw new Error(errors.join("; "));

          result.created += 1;
        } else {
          result.skipped += 1;
        }

        if (locale.code === chosenDefault) {
          const updated = await gql(client, UPDATE_LOCALE, { input: { channelId: channelRef(targetId), code: locale.code, status: "ACTIVE", isDefault: true } });
          const errors = mutationErrors(updated, "locale", "updateLocale");

          if (errors.length > 0) throw new Error(errors.join("; "));

          result.updated += 1;
        }
      } catch (error) {
        result.warnings.push(`Language ${locale.code} on ${source.name}: ${describe(error)}`);
      }
    }
  }

  const ids = await productIdsBySku(client, (file.translations ?? []).flatMap((entry) => entry.products.map((product) => product.sku))).catch((error) => {
    result.warnings.push(`Finding products: ${describe(error)}`);

    return new Map<string, number>();
  });

  for (const set of file.translations ?? []) {
    const channelId = positiveInt(targetChannels.find((channel) => key(channel.name) === key(set.channel))?.id);

    if (!channelId) continue;

    const entities = set.products.flatMap((product) => {
      const id = ids.get(product.sku);

      return id ? [{ resourceId: `bc/store/product/${id}`, fields: Object.entries(product.fields).map(([fieldName, value]) => ({ fieldName, value })) }] : [];
    });

    if (entities.length < set.products.length) result.warnings.push(`${set.channel} (${set.locale}): ${set.products.length - entities.length} products skipped because their SKU isn't in this store. Import the catalog first.`);

    for (let start = 0; start < entities.length; start += 20) {
      try {
        const sent = await gql(client, UPDATE_TRANSLATIONS, { input: { resourceType: "PRODUCTS", channelId: channelRef(channelId), localeId: `bc/store/locale/${set.locale}`, entities: entities.slice(start, start + 20) } });
        const errors = mutationErrors(sent, "translation", "updateTranslations");

        if (errors.length > 0) throw new Error(errors.join("; "));

        result.updated += Math.min(20, entities.length - start);
      } catch (error) {
        result.warnings.push(`Translations for ${set.channel} (${set.locale}): ${describe(error)}`);
      }
    }
  }

  return result;
}
