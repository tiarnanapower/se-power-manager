// B2B Edition: companies and their users, through the B2B Edition API (a different host from the store
// API). Import adds companies the store doesn't have (matched by name) with their admin and other
// users. Quotes, orders and custom roles are not copied. Needs a store whose token can use the B2B API.
import type { BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";
import { asRecord, attempt, describe, emptyResult, key, positiveInt, records, text, type JsonRecord, type SectionExtras, type SectionFile, type SectionResult } from "@/lib/samples/sections/shared";

export interface B2bUser {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  // 0 admin, 1 senior buyer, 2 junior buyer.
  role: number;
}

export interface B2bCompany {
  companyName: string;
  companyEmail: string;
  companyPhone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  country: string;
  zipCode: string;
  users: B2bUser[];
}

export interface B2bData {
  companies: B2bCompany[];
}

const UNREACHABLE = "B2B Edition couldn't be reached with this store's token. The store needs B2B Edition, and the app needs permission to use it.";

// Why a B2B request failed, in words that say what to check. The status is BigCommerce's own answer.
export function b2bProblem(error: unknown, store: "source" | "your" = "source"): string {
  const status = (error as { status?: number })?.status;
  const said = (error as { detail?: unknown })?.detail;
  const why = typeof said === "string" && said ? ` B2B Edition said: "${said}".` : "";

  if ((status === 401 || status === 403) && store === "your") return `Your store's B2B Edition refused the app's token (HTTP ${status}), so nothing could be created there. The app needs the B2B Edition scope (modify) and your store needs B2B Edition switched on. After adding the scope to the app, reinstall or re-authorise it on this store.${why}`;
  if (status === 401 || status === 403) return `B2B Edition refused the token (HTTP ${status}). Check the token belongs to this store, can use B2B Edition, and that B2B Edition's API access is switched on for the store.${why}`;
  if (status === 404) return `B2B Edition answered "not found" (HTTP 404). This store may not have B2B Edition.${why}`;
  if (status) return `B2B Edition answered HTTP ${status}.${why}`;

  return `B2B Edition couldn't be reached (${describe(error)}).`;
}

// The B2B API pages with limit and offset, and wraps rows in { data: [...] }.
async function readB2b(client: BcRestApiClient, path: string, params: Record<string, string | number> = {}): Promise<JsonRecord[]> {
  const rows: JsonRecord[] = [];

  for (let offset = 0; offset < 100_000; ) {
    const { data } = await client.get<unknown>(path, { params: { ...params, limit: 250, offset } });
    const body = asRecord(data);
    const page = records(Array.isArray(data) ? data : body?.data);

    rows.push(...page);
    offset += page.length;

    const total = Number(asRecord(asRecord(body?.meta)?.pagination)?.totalCount ?? 0);

    if (page.length < 250 || (total > 0 && offset >= total)) break;
  }

  return rows;
}

const first = (row: JsonRecord, ...names: string[]): string => {
  for (const name of names) if (text(row[name])) return text(row[name]);

  return "";
};

export async function captureB2b(_client: BcRestApiClient, extras: SectionExtras = {}): Promise<SectionFile<B2bData>> {
  const warnings: string[] = [];

  if (!extras.b2b) return { data: { companies: [] }, warnings: [UNREACHABLE] };

  const b2b = await extras.b2b();
  let rows: JsonRecord[];

  try {
    rows = await readB2b(b2b, "/companies");
  } catch (error) {
    return { data: { companies: [] }, warnings: [b2bProblem(error)] };
  }

  const companies: B2bCompany[] = [];

  for (const row of rows) {
    const id = positiveInt(row.companyId ?? row.id);
    const name = first(row, "companyName", "name");

    if (!id || !name) continue;

    const users = await attempt(`Users of ${name}`, warnings, () => readB2b(b2b, "/users", { companyId: id }), [] as JsonRecord[]);

    companies.push({
      companyName: name,
      companyEmail: first(row, "companyEmail", "email"),
      companyPhone: first(row, "companyPhone", "phoneNumber", "phone"),
      addressLine1: first(row, "addressLine1"),
      addressLine2: first(row, "addressLine2"),
      city: first(row, "city"),
      state: first(row, "state"),
      country: first(row, "country"),
      zipCode: first(row, "zipCode"),
      users: users.map((user) => ({ firstName: first(user, "firstName"), lastName: first(user, "lastName"), email: first(user, "email"), phoneNumber: first(user, "phoneNumber", "phone"), role: Number(user.role ?? 2) })),
    });
  }

  warnings.push("Quotes, orders and custom roles aren't included.");

  return { data: { companies }, warnings };
}

export async function importB2b(_client: BcRestApiClient, file: B2bData, extras: SectionExtras = {}): Promise<SectionResult> {
  const result = emptyResult();

  if (!extras.b2b) {
    result.warnings.push(UNREACHABLE);

    return result;
  }

  const b2b = await extras.b2b();
  const existing = await readB2b(b2b, "/companies").catch((error) => {
    result.warnings.push(b2bProblem(error, "your"));

    return null;
  });

  if (!existing) return result;

  for (const company of file.companies ?? []) {
    if (existing.some((row) => key(first(row, "companyName", "name")) === key(company.companyName))) {
      result.skipped += 1;
      continue;
    }

    // A company is created together with its administrator.
    const admin = company.users.find((user) => user.role === 0) ?? company.users[0];

    if (!admin) {
      result.warnings.push(`Company ${company.companyName}: no users in the sample, so it can't be created (a company needs an administrator).`);
      continue;
    }

    try {
      const { data } = await b2b.post<unknown>("/companies", {
        body: {
          companyName: company.companyName,
          companyEmail: company.companyEmail || admin.email,
          companyPhone: company.companyPhone || admin.phoneNumber || "0000000000",
          addressLine1: company.addressLine1,
          addressLine2: company.addressLine2,
          city: company.city,
          state: company.state,
          country: company.country,
          zipCode: company.zipCode,
          adminFirstName: admin.firstName,
          adminLastName: admin.lastName,
          adminEmail: admin.email,
          adminPhoneNumber: admin.phoneNumber,
        },
      });
      const body = asRecord(data);
      const companyId = positiveInt(asRecord(body?.data)?.companyId ?? asRecord(body?.data)?.id ?? body?.companyId);

      result.created += 1;

      for (const user of company.users.filter((candidate) => candidate !== admin)) {
        if (!companyId) {
          result.warnings.push(`Users of ${company.companyName}: the new company's id wasn't returned, so its other users were skipped.`);
          break;
        }

        try {
          await b2b.post("/users", { body: { companyId, email: user.email, firstName: user.firstName, lastName: user.lastName, phoneNumber: user.phoneNumber, role: user.role } });
          result.created += 1;
        } catch (error) {
          result.warnings.push(`User ${user.email} of ${company.companyName}: ${describe(error)}`);
        }
      }
    } catch (error) {
      result.warnings.push(`Company ${company.companyName}: ${describe(error)}`);
    }
  }

  return result;
}
