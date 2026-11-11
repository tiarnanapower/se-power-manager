// Shipping: zones and their methods (store-wide). Import is additive: zones are matched by name,
// methods by name and type, and nothing is removed.
import type { BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";
import { asRecord, attempt, describe, emptyResult, key, pick, positiveInt, readAll, records, text, type JsonRecord, type SectionFile, type SectionResult } from "@/lib/samples/sections/shared";

export interface ShippingData {
  zones: JsonRecord[];
  // Zone id (as text) -> that zone's methods.
  methods: Record<string, JsonRecord[]>;
}

const ZONE_FIELDS = ["name", "type", "enabled", "free_shipping", "handling_fees", "locations"] as const;
const METHOD_FIELDS = ["name", "type", "enabled", "handling_fees", "settings"] as const;

export async function captureShipping(client: BcRestApiClient): Promise<SectionFile<ShippingData>> {
  const warnings: string[] = [];
  const zones = await attempt("Shipping zones", warnings, () => readAll(client, "/v2/shipping/zones"), [] as JsonRecord[]);
  const methods: Record<string, JsonRecord[]> = {};

  for (const zone of zones) {
    const id = positiveInt(zone.id);

    if (id) methods[String(id)] = await attempt(`Methods for zone ${text(zone.name)}`, warnings, () => readAll(client, `/v2/shipping/zones/${id}/methods`), [] as JsonRecord[]);
  }

  return { data: { zones, methods }, warnings };
}

function zoneBody(source: JsonRecord, creating: boolean): JsonRecord {
  const body = pick(source, ZONE_FIELDS);

  if (!creating) delete body.type;

  if (key(source.type) === "global") delete body.locations;
  else body.locations = records(source.locations).map(({ id: _id, ...location }) => location);

  return body;
}

export async function importShipping(client: BcRestApiClient, file: ShippingData): Promise<SectionResult> {
  const result = emptyResult();
  const targetZones = await readAll(client, "/v2/shipping/zones");

  for (const source of file.zones) {
    const sourceId = positiveInt(source.id);
    const name = text(source.name);

    if (!sourceId || !name) continue;

    const isGlobal = key(source.type) === "global";
    const target = targetZones.find((zone) => (isGlobal ? key(zone.type) === "global" : key(zone.name) === key(name)));
    let targetId = positiveInt(target?.id);

    try {
      // A store's global zone can't be changed, only filled with methods.
      if (!(targetId && isGlobal)) {
        const { data } = targetId
          ? await client.put<JsonRecord>(`/v2/shipping/zones/${targetId}`, { body: zoneBody(source, false) })
          : await client.post<JsonRecord>("/v2/shipping/zones", { body: zoneBody(source, true) });

        targetId ??= positiveInt(asRecord(data)?.id);

        if (target) result.updated += 1;
        else result.created += 1;
      } else {
        result.skipped += 1;
      }

      if (!targetId) continue;

      const targetMethods = await readAll(client, `/v2/shipping/zones/${targetId}/methods`);

      for (const method of file.methods[String(sourceId)] ?? []) {
        const methodName = text(method.name);

        if (!methodName) continue;

        const existing = targetMethods.find((candidate) => key(candidate.name) === key(methodName) && key(candidate.type) === key(method.type));
        const existingId = positiveInt(existing?.id);

        try {
          // Existing methods keep their channel assignments; new ones get the store's default.
          if (existingId) await client.put(`/v2/shipping/zones/${targetId}/methods/${existingId}`, { body: pick(method, METHOD_FIELDS) });
          else await client.post(`/v2/shipping/zones/${targetId}/methods`, { body: pick(method, METHOD_FIELDS) });

          if (existingId) result.updated += 1;
          else result.created += 1;
        } catch (error) {
          result.warnings.push(`Shipping method ${methodName} in ${name}: ${describe(error)}`);
        }
      }
    } catch (error) {
      result.warnings.push(`Shipping zone ${name}: ${describe(error)}`);
    }
  }

  return result;
}
