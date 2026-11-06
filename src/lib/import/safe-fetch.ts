// Fetches a customer web page for scraping. The URL comes from a user, so it
// must never reach the server's own network: only public http(s) hosts are
// requested, every redirect is re-checked, and the body is size-capped.
import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError } from "@/lib/errors/app-error";

const MAX_BYTES = 3_000_000;
const MAX_REDIRECTS = 4;
const TIMEOUT_MS = 15_000;

export function isPrivateAddress(address: string): boolean {
  if (address.includes(":")) {
    const lower = address.toLowerCase();

    if (lower.startsWith("::ffff:")) return isPrivateAddress(lower.slice(7));

    return lower === "::1" || lower === "::" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb");
  }

  const [a, b] = address.split(".").map(Number);

  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new AppError("VALIDATION", "That doesn't look like a web address.", { detail: "That doesn't look like a web address." });
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") throw new AppError("VALIDATION", "Only http and https addresses can be scraped.", { detail: "Only http and https addresses can be scraped." });

  const host = url.hostname.replace(/^\[|\]$/g, "");
  const blocked = new AppError("VALIDATION", "That address isn't a public website.", { detail: "That address isn't a public website." });

  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) throw blocked;

  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((entry) => entry.address);

  if (addresses.length === 0) throw new AppError("VALIDATION", "Couldn't find that website.", { detail: "Couldn't find that website." });
  if (addresses.some(isPrivateAddress)) throw blocked;

  return url;
}

export async function fetchPage(raw: string): Promise<{ url: string; html: string }> {
  let url = await assertPublicUrl(raw);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response: Response;

    try {
      response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "user-agent": "Mozilla/5.0 (compatible; SEPowerManager/1.0)", accept: "text/html,application/xhtml+xml" },
        cache: "no-store",
      });
    } catch {
      throw new AppError("UPSTREAM_API", "Couldn't load that page.", { detail: "Couldn't load that page. The site may be blocking automated requests." });
    }

    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      url = await assertPublicUrl(new URL(response.headers.get("location") as string, url).toString());
      continue;
    }

    if (!response.ok) throw new AppError("UPSTREAM_API", `The site answered ${response.status}.`, { detail: `The site answered ${response.status}. It may block automated requests.` });

    const type = response.headers.get("content-type") ?? "";

    if (type && !/html|xml|text/i.test(type)) throw new AppError("VALIDATION", "That address isn't a web page.", { detail: "That address isn't a web page." });

    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;

    while (reader) {
      const { done, value } = await reader.read();

      if (done) break;

      size += value.byteLength;
      chunks.push(value);

      if (size > MAX_BYTES) {
        await reader.cancel();
        break;
      }
    }

    return { url: url.toString(), html: Buffer.concat(chunks).toString("utf8") };
  }

  throw new AppError("UPSTREAM_API", "Too many redirects.", { detail: "That page redirected too many times." });
}
