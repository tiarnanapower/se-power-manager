// Tax: classes, zones, rates and settings (store-wide). Import is additive: zones and rates are matched
// by name, tax classes by name, and nothing is removed. BigCommerce's default zone can't be re-targeted.
import type { BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";
import { asRecord, attempt, describe, emptyResult, key, pick, positiveInt, readAll, records, text, type JsonRecord, type SectionFile, type SectionResult } from "@/lib/samples/sections/shared";

export interface TaxData {
  settings: JsonRecord | null;
  zones: JsonRecord[];
  rates: JsonRecord[];
  classes: JsonRecord[];
}

export async function captureTax(client: BcRestApiClient): Promise<SectionFile<TaxData>> {
  const warnings: string[] = [];
  const settings = await attempt("Tax settings", warnings, async () => asRecord(asRecord((await client.get<unknown>("/v3/tax/settings")).data)?.data), null as JsonRecord | null);
  const zones = await attempt("Tax zones", warnings, () => readAll(client, "/v3/tax/zones"), [] as JsonRecord[]);
  const rates = await attempt("Tax rates", warnings, () => readAll(client, "/v3/tax/rates"), [] as JsonRecord[]);
  const classes = await attempt("Tax classes", warnings, () => readAll(client, "/v2/tax_classes"), [] as JsonRecord[]);

  return { data: { settings, zones, rates, classes }, warnings };
}

const isDefaultZone = (zone: JsonRecord) => positiveInt(zone.id) === 1 || key(zone.name) === "default zone";

export async function importTax(client: BcRestApiClient, file: TaxData): Promise<SectionResult> {
  const result = emptyResult();
  const targetZones = await readAll(client, "/v3/tax/zones");
  const zoneMap = new Map<number, number>();

  for (const source of file.zones) {
    const sourceId = positiveInt(source.id);
    const name = text(source.name);

    if (!sourceId || !name) continue;

    const defaultZone = isDefaultZone(source);
    const target = defaultZone ? (targetZones.find((zone) => positiveInt(zone.id) === 1) ?? targetZones.find((zone) => key(zone.name) === "default zone")) : targetZones.find((zone) => key(zone.name) === key(name));
    let targetId = positiveInt(target?.id);

    if (targetId) zoneMap.set(sourceId, targetId);

    try {
      const { id: _id, ...body } = source;

      if (defaultZone) {
        // The default zone's targeting belongs to BigCommerce and must not be echoed back in an update.
        for (const field of ["shopper_target_settings", "enabled", "locations", "customer_groups", "customer_group_ids"]) delete body[field];
      }

      const payload = [{ ...(targetId ? { id: targetId } : {}), ...body }];
      const { data } = targetId ? await client.put<unknown>("/v3/tax/zones", { body: payload }) : await client.post<unknown>("/v3/tax/zones", { body: payload });

      if (!targetId) targetId = positiveInt(records(asRecord(data)?.data)[0]?.id);
      if (targetId) zoneMap.set(sourceId, targetId);

      if (target) result.updated += 1;
      else result.created += 1;
    } catch (error) {
      result.warnings.push(`Tax zone ${name}: ${describe(error)}`);
    }
  }

  const targetRates = await readAll(client, "/v3/tax/rates");
  const targetClasses = await readAll(client, "/v2/tax_classes").catch(() => [] as JsonRecord[]);

  for (const source of file.rates) {
    const targetZoneId = zoneMap.get(positiveInt(source.tax_zone_id) ?? 0);
    const name = text(source.name);

    if (!targetZoneId || !name) {
      result.skipped += 1;
      continue;
    }

    const target = targetRates.find((rate) => positiveInt(rate.tax_zone_id) === targetZoneId && key(rate.name) === key(name));
    const targetId = positiveInt(target?.id);
    const classRates = records(source.class_rates).flatMap((entry) => {
      const sourceClass = file.classes.find((taxClass) => Number(taxClass.id) === Number(entry.tax_class_id));
      const mapped = positiveInt(targetClasses.find((taxClass) => key(taxClass.name) === key(sourceClass?.name))?.id) ?? (Number(entry.tax_class_id) === 0 ? 0 : undefined);

      return mapped === undefined ? [] : [{ tax_class_id: mapped, rate: Number(entry.rate) || 0 }];
    });

    try {
      const payload = [{ ...(targetId ? { id: targetId } : {}), ...pick(source, ["name", "enabled", "priority"]), tax_zone_id: targetZoneId, class_rates: classRates }];

      if (targetId) await client.put("/v3/tax/rates", { body: payload });
      else await client.post("/v3/tax/rates", { body: payload });

      if (target) result.updated += 1;
      else result.created += 1;
    } catch (error) {
      result.warnings.push(`Tax rate ${name}: ${describe(error)}`);
    }
  }

  if (file.settings) {
    const settings: JsonRecord = JSON.parse(JSON.stringify(file.settings));
    const display = asRecord(settings.price_display_settings);

    // An older capture used a boolean here; the API now takes a strategy name.
    if (display && "show_inclusive_in_control_panel" in display) {
      const legacy = display.show_inclusive_in_control_panel;

      delete display.show_inclusive_in_control_panel;
      display.control_panel_price_display_strategy ??= legacy ? "INCLUSIVE" : "EXCLUSIVE";
    }

    for (const field of ["guest_shopper_tax_zone_id", "store_tax_zone_id"]) {
      const mapped = zoneMap.get(positiveInt(settings[field]) ?? 0);

      if (mapped) settings[field] = mapped;
    }

    try {
      await client.put("/v3/tax/settings", { body: settings });
      result.updated += 1;
    } catch (error) {
      result.warnings.push(`Tax settings: ${describe(error)}`);
    }
  }

  return result;
}
