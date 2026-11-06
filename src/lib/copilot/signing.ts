// Signed tokens that tie an Apply click to what the copilot actually
// proposed. A browser (or anything pretending to be one) can't invent a draft:
// the server only applies drafts it signed for this store, recently.
import { createHmac, timingSafeEqual } from "node:crypto";

export const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

// Stable JSON (sorted keys) so the same draft always serialises identically.
export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;

  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? "null";
}

const mac = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest("base64url");

export function signPayload(purpose: string, storeHash: string | undefined, subject: unknown, secret: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ p: purpose, h: storeHash ?? "", s: canonicalize(subject), t: now })).toString("base64url");

  return `${body}.${mac(secret, body)}`;
}

export function verifyPayload(token: unknown, purpose: string, storeHash: string | undefined, subject: unknown, secret: string, now = Date.now()): boolean {
  if (typeof token !== "string") return false;

  const [body, signature, ...rest] = token.split(".");

  if (!body || !signature || rest.length > 0) return false;

  const expected = mac(secret, body);

  if (expected.length !== signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return false;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as { p?: string; h?: string; s?: string; t?: number };

    return payload.p === purpose && payload.h === (storeHash ?? "") && payload.s === canonicalize(subject) && typeof payload.t === "number" && now - payload.t >= 0 && now - payload.t <= TOKEN_TTL_MS;
  } catch {
    return false;
  }
}
